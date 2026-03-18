import { useEffect, useMemo, useRef } from "react";
import { useDropzone } from "react-dropzone";
import "./parsers";
import { useConversationStore } from "./stores/conversation-store";
import { useUIStore } from "./stores/ui-store";
import { useUrlStore } from "./stores/url-store";
import type { InsightsTab } from "./stores/url-store";
import type { WorkflowState } from "./workflow/types";
import { getDefaultDimension, getAllComponents } from "./workflow/dimensions";
import type { ConversationComponentData } from "./components/ComponentComparisonView";
import { aggregateComponentTokens } from "./aggregation";
import { ConversationList } from "./components/ConversationList";
import { ConversationView } from "./components/ConversationView";
import { AISummary } from "./components/AISummary";
import { Card } from "./components/ui/card";
import { PromptEditorDialog } from "./components/PromptEditorDialog";
import { Clock, Loader2, Upload, AlertCircle, Star, Github } from "lucide-react";
import { cn } from "./lib/utils";
import { DEFAULT_SEGMENTATION_THRESHOLD } from "./segmentation";
import { loadPresetIndex, loadPreset } from "./lib/preset-loader";
import { PresetSelector } from "./components/PresetSelector";
import { UrlImport } from "./components/UrlImport";
import { createFileValidator, SUPPORTED_EXTENSIONS_TEXT } from "./lib/file-formats";
import { fetchFileFromUrl } from "./lib/url-fetch";
import {
  navigateToId,
  reprocessComponents,
  applyPrompt,
  applyComponents,
  applySegmentationPrompt,
  applySummaryPrompt,
  applyAnalysisPrompt,
  applyColoringPrompt,
  generateAnalysis,
  generateSummary,
} from "./hooks/useWorkflowActions";

export default function App() {
  // ---- Stores ----
  const conversations = useConversationStore((s) => s.conversations);
  const {
    processPendingGroups,
    processFileDrop,
  } = useConversationStore();

  const ui = useUIStore();

  // ---- URL state ----
  const selectedId = useUrlStore((s) => s.conversationId);
  const insightsTab = useUrlStore((s) => s.insightsTab);
  const isSidebarCollapsed = useUrlStore((s) => s.sidebarCollapsed);
  const isInsightsPanelCollapsed = useUrlStore((s) => s.insightsCollapsed);
  const importUrl = useUrlStore((s) => s.importUrl);

  // ---- Derived state ----
  const groups = useConversationStore((s) => s.groups);
  const selectedGroup = selectedId ? groups[selectedId] : undefined;

  // Build group display data: virtual conversation + origin map from member files
  const groupDisplayData = useMemo(() => {
    if (!selectedGroup) return null;

    const memberConvs = selectedGroup.fileIds
      .map((fid) => conversations.find((c) => c.id === fid))
      .filter((c): c is WorkflowState => !!c?.conversation);

    if (memberConvs.length === 0) return null;

    const allMessages: import("./schema").Message[] = [];
    const originMap: Record<string, import("./schema").OriginInfo> = {};

    for (const conv of memberConvs) {
      if (!conv.conversation) continue;
      for (const msg of conv.conversation.messages) {
        const newMsgId = `${conv.id}-${msg.id}`;
        const newParts = msg.parts.map((part) => {
          const newPartId = `${conv.id}-${part.id}`;
          originMap[newPartId] = { conversationId: conv.id, filename: conv.filename, title: conv.title };
          return { ...part, id: newPartId };
        });
        originMap[newMsgId] = { conversationId: conv.id, filename: conv.filename, title: conv.title };
        allMessages.push({ ...msg, id: newMsgId, parts: newParts } as import("./schema").Message);
      }
    }

    // Merge dimensions
    const mergedDims: Record<string, import("./component-types").DimensionData> = {};
    for (const conv of memberConvs) {
      if (!conv.dimensions) continue;
      for (const [dimName, dim] of Object.entries(conv.dimensions)) {
        if (!mergedDims[dimName]) {
          mergedDims[dimName] = { name: dimName, components: [], componentMapping: {}, componentTimeline: [], componentColors: {} };
        }
        const merged = mergedDims[dimName]!;
        for (const c of dim.components) {
          if (!merged.components.includes(c)) merged.components.push(c);
        }
        for (const [partId, component] of Object.entries(dim.componentMapping)) {
          merged.componentMapping[`${conv.id}-${partId}`] = component;
        }
        Object.assign(merged.componentColors, dim.componentColors);
      }
    }

    // Merge static components
    const staticComponentsSet = new Set<string>();
    const staticMapping: Record<string, string> = {};
    for (const conv of memberConvs) {
      if (conv.staticComponents) conv.staticComponents.forEach((c) => staticComponentsSet.add(c));
      if (conv.staticMapping) {
        for (const [partId, component] of Object.entries(conv.staticMapping)) {
          staticMapping[`${conv.id}-${partId}`] = component;
        }
      }
    }

    const virtualState: WorkflowState = {
      id: selectedGroup.id,
      filename: selectedGroup.name,
      title: selectedGroup.title,
      status: "success",
      conversation: { messages: allMessages },
      dimensions: Object.keys(mergedDims).length > 0 ? mergedDims : undefined,
      staticComponents: [...staticComponentsSet],
      staticMapping,
      aiSummary: selectedGroup.aiSummary,
      analysis: selectedGroup.analysis,
      customSummaryPrompt: selectedGroup.customSummaryPrompt,
      customAnalysisPrompt: selectedGroup.customAnalysisPrompt,
    };

    return { virtualState, originMap };
  }, [selectedGroup, conversations]);

  const selectedConversation = useMemo((): WorkflowState | undefined => {
    if (conversations.length === 0 && !groupDisplayData) return undefined;
    if (groupDisplayData) return groupDisplayData.virtualState;
    return conversations.find((conv) => conv.id === selectedId) ?? conversations[0];
  }, [conversations, selectedId, groupDisplayData]);

  const memberComponentData = useMemo((): ConversationComponentData[] | undefined => {
    if (!selectedGroup) return undefined;

    return selectedGroup.fileIds
      .map((fileId) => {
        const conv = conversations.find((c) => c.id === fileId);
        const defaultDim = conv ? getDefaultDimension(conv) : undefined;
        if (!conv?.conversation || !defaultDim?.componentMapping) return null;

        const { componentTokens, totalTokens } = aggregateComponentTokens(
          conv.conversation,
          defaultDim.componentMapping,
        );

        let turnCount = 0;
        let firstTimestamp: Date | undefined;
        let lastTimestamp: Date | undefined;
        const messageComponents: string[] = [];

        for (const message of conv.conversation.messages) {
          if (message.role === "user") turnCount++;
          if (message.timestamp) {
            const ts = new Date(message.timestamp);
            if (!isNaN(ts.getTime())) {
              if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
              if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
            }
          }
          let messageComponent = "other";
          for (const part of message.parts) {
            const component = defaultDim.componentMapping[part.id];
            if (component) {
              if (messageComponent === "other") messageComponent = component;
              break;
            }
          }
          messageComponents.push(messageComponent);
        }

        const durationMs =
          firstTimestamp && lastTimestamp
            ? lastTimestamp.getTime() - firstTimestamp.getTime()
            : undefined;

        const result: ConversationComponentData = {
          id: fileId,
          filename: conv.filename,
          componentTokens,
          totalTokens,
          turnCount,
          messageCount: conv.conversation.messages.length,
          durationMs,
          messageComponents,
        };
        if (conv.title) result.title = conv.title;
        return result;
      })
      .filter((data): data is ConversationComponentData => data !== null);
  }, [selectedGroup, conversations]);

  const memberWorkflowStates = useMemo(() => {
    if (!selectedGroup) return undefined;
    return selectedGroup.fileIds
      .map((fileId) => {
        const conv = conversations.find((c) => c.id === fileId);
        const dim = conv ? getDefaultDimension(conv) : undefined;
        if (!conv?.conversation || !dim?.componentMapping) return null;
        return {
          id: fileId,
          filename: conv.filename,
          title: conv.title,
          conversation: conv.conversation,
          componentMapping: dim.componentMapping,
          dimensions: conv.dimensions,
        };
      })
      .filter((state): state is NonNullable<typeof state> => state !== null);
  }, [selectedGroup, conversations]);

  // ---- Preset loading ----
  useEffect(() => {
    loadPresetIndex().then(ui.setAvailablePresets);
  }, []);

  useEffect(() => {
    if (ui.selectedPresetId) {
      ui.setIsPresetLoading(true);
      ui.setPresetError(null);
      loadPreset(ui.selectedPresetId)
        .then((preset) => {
          ui.setLoadedPreset(preset);
          ui.setIsPresetLoading(false);
        })
        .catch((error) => {
          console.error("Failed to load preset:", error);
          ui.setPresetError(error.message);
          ui.setLoadedPreset(null);
          ui.setIsPresetLoading(false);
        });
    } else {
      ui.setLoadedPreset(null);
      ui.setPresetError(null);
    }
  }, [ui.selectedPresetId]);

  // ---- Effects ----

  // Ensure selection is valid
  useEffect(() => {
    if (conversations.length === 0) {
      if (!importUrl) navigateToId(null);
      return;
    }
    const [firstConversation] = conversations;
    if (!firstConversation) {
      navigateToId(null);
      return;
    }
    if (!selectedId) {
      navigateToId(firstConversation.id);
      return;
    }
    if (!conversations.some((conv) => conv.id === selectedId)) {
      // Don't reset if this is a group or a pending group from session import
      if (useConversationStore.getState().groups[selectedId]) return;
      const pendingGroups = useConversationStore.getState().pendingSessionImport?.groups;
      if (pendingGroups?.some((g) => g.id === selectedId)) return;
      navigateToId(firstConversation.id);
    }
  }, [conversations, selectedId]);

  // Process pending groups from session import
  useEffect(() => {
    processPendingGroups();
  }, [conversations]);

  // Switch to analysis tab when analysis starts streaming
  useEffect(() => {
    if (selectedConversation?.status === "processing" && selectedConversation.step === "analysis") {
      useUrlStore.getState().setInsightsTab("analysis");
    }
  }, [selectedConversation?.status, selectedConversation?.step]);

  // Debug: Expose current conversation to window
  useEffect(() => {
    if (import.meta.env.DEV && selectedConversation?.conversation) {
      const conversationWithComponents = {
        ...selectedConversation.conversation,
        messages: selectedConversation.conversation.messages.map((msg) => ({
          ...msg,
          parts: msg.parts.map((part) => ({
            ...part,
            component: getDefaultDimension(selectedConversation)?.componentMapping[part.id],
          })),
        })),
      };
      (window as any).__debug = {
        conversation: conversationWithComponents,
        summary: selectedConversation.summary,
        msg: (index: number) => conversationWithComponents.messages[index],
        part: (msgIndex: number, partIndex: number) =>
          conversationWithComponents.messages[msgIndex]?.parts[partIndex],
        componentComparison: memberComponentData,
        componentColors: getDefaultDimension(selectedConversation)?.componentColors,
      };
    }
  }, [selectedConversation, memberComponentData]);

  // URL auto-import
  const importInProgressRef = useRef(false);
  useEffect(() => {
    if (!importUrl || importInProgressRef.current) return;
    if (conversations.length > 0) return;

    importInProgressRef.current = true;
    ui.setIsUrlImporting(true);

    fetchFileFromUrl(importUrl).then((result) => {
      if (result.success) {
        handleFileDrop([result.file]);
      } else {
        ui.setImportError(result.error);
      }
      ui.setIsUrlImporting(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importUrl]);

  // ---- Handlers ----

  const handleFileDrop = async (files: File[]) => {
    await processFileDrop(files, ui.loadedPreset);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFileDrop,
    validator: createFileValidator(),
    multiple: true,
    noClick: conversations.length > 0,
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header Banner */}
      <header className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 px-6 py-4 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2 text-slate-700">
            <a href="https://nilenso.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity">
              <img src={`${import.meta.env.BASE_URL}nilenso-logo.svg`} alt="Nilenso" className="h-5 w-auto" />
            </a>
            <span className="font-normal text-slate-400">/</span>
            <a href="https://github.com/nilenso/context-viewer" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 transition-colors">context-viewer</a>
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Upload conversation logs to analyze their structure and token usage
          </p>
        </div>
        <a
          href="https://github.com/nilenso/context-viewer"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <Github className="h-4 w-4" />
          <Star className="h-3.5 w-3.5" />
          <span>Star</span>
        </a>
      </header>

      <div className="space-y-6 px-6">
        {conversations.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col">
            <PresetSelector
              presets={ui.availablePresets}
              selectedPresetId={ui.selectedPresetId}
              onSelectPreset={ui.setSelectedPresetId}
              isLoading={ui.isPresetLoading}
            />

            {ui.presetError && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                <strong>Failed to load preset:</strong> {ui.presetError}
              </div>
            )}

            {ui.isUrlImporting ? (
              <div className="min-h-[calc(100vh-18rem)] border-2 border-dashed rounded-lg flex items-center justify-center border-border">
                <div className="text-center p-12">
                  <Loader2 className="h-20 w-20 mx-auto mb-6 text-muted-foreground/50 animate-spin" />
                  <h2 className="text-2xl font-semibold text-muted-foreground mb-3">Importing from URL...</h2>
                  <p className="text-sm text-muted-foreground break-all max-w-lg">{importUrl}</p>
                </div>
              </div>
            ) : (
              <div
                {...getRootProps()}
                className={cn(
                  "min-h-[calc(100vh-18rem)] border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors",
                  isDragActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-accent/50",
                )}
              >
                <input {...getInputProps()} />
                <div className="text-center p-12">
                  {ui.importError ? (
                    <>
                      <AlertCircle className="h-20 w-20 mx-auto mb-6 text-destructive/50" />
                      <h2 className="text-2xl font-semibold text-destructive mb-3">Import failed</h2>
                      <p className="text-sm text-destructive mb-2">{ui.importError}</p>
                      <p className="text-xs text-muted-foreground break-all max-w-lg mb-6">{importUrl}</p>
                      <p className="text-muted-foreground mb-2">Drop conversation files here or click to browse</p>
                    </>
                  ) : (
                    <>
                      <Upload className="h-20 w-20 mx-auto mb-6 text-muted-foreground/50" />
                      <h2 className="text-2xl font-semibold text-muted-foreground mb-3">
                        {isDragActive ? "Drop files here" : "Drop conversation files here"}
                      </h2>
                      <p className="text-muted-foreground mb-2">or click to browse</p>
                    </>
                  )}

                  <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <UrlImport onFileImported={(file) => handleFileDrop([file])} />
                  </div>

                  <p className="text-sm text-muted-foreground mt-4">Accepts {SUPPORTED_EXTENSIONS_TEXT} files</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Main Content */
          <div
            className={cn(
              "grid gap-6 transition-all duration-300",
              isSidebarCollapsed && isInsightsPanelCollapsed
                ? "grid-cols-[48px_1fr_48px]"
                : isSidebarCollapsed && !isInsightsPanelCollapsed
                  ? "grid-cols-[48px_minmax(600px,1fr)_minmax(480px,32%)]"
                  : !isSidebarCollapsed && isInsightsPanelCollapsed
                    ? "grid-cols-[260px_1fr_48px]"
                    : "grid-cols-[260px_minmax(500px,1fr)_minmax(420px,30%)]",
            )}
          >
            {/* Sidebar */}
            <aside className="relative">
              <ConversationList />
            </aside>

            {/* Main Panel */}
            <main>
              {selectedConversation ? (
                selectedConversation.conversation ? (
                  <ConversationView
                    conversation={selectedConversation.conversation}
                    componentMapping={getDefaultDimension(selectedConversation)?.componentMapping}
                    componentTimeline={getDefaultDimension(selectedConversation)?.componentTimeline}
                    componentColors={getDefaultDimension(selectedConversation)?.componentColors}
                    components={getAllComponents(selectedConversation)}
                    dimensions={selectedConversation.dimensions}
                    staticMapping={selectedConversation.staticMapping}
                    staticTimeline={selectedConversation.staticTimeline}
                    warnings={selectedConversation.warnings}
                    onReprocessComponents={(options) => reprocessComponents(selectedConversation, selectedGroup?.fileIds, options)}
                    isReprocessing={ui.reprocessingId === selectedConversation.id}
                    messageOriginMap={groupDisplayData?.originMap}
                    isGrouped={!!selectedGroup}
                    groupTitle={selectedGroup?.title || selectedConversation.title}
                    memberComponentData={memberComponentData}
                    memberWorkflowStates={memberWorkflowStates}
                  />
                ) : selectedConversation.status === "pending" ? (
                  <Card className="p-12 text-center">
                    <Clock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <h2 className="text-xl font-semibold text-muted-foreground mb-2">Waiting to process</h2>
                    <p className="text-sm text-muted-foreground">{selectedConversation.filename} will be processed soon</p>
                  </Card>
                ) : selectedConversation.status === "processing" ? (
                  <Card className="p-12 text-center">
                    <Loader2 className="h-12 w-12 mx-auto mb-4 text-blue-600 animate-spin" />
                    <h2 className="text-xl font-semibold text-muted-foreground mb-2">Processing...</h2>
                    <p className="text-sm text-muted-foreground">{selectedConversation.filename}</p>
                  </Card>
                ) : selectedConversation.status === "failed" ? (
                  <Card className="p-12 text-center border-red-200 bg-red-50">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-600" />
                    <h2 className="text-xl font-semibold text-red-900 mb-2">Failed to parse</h2>
                    <p className="text-sm text-red-800 mb-4">{selectedConversation.filename}</p>
                    <p className="text-sm text-red-700 font-mono bg-red-100 p-4 rounded">
                      {selectedConversation.error || "Unknown error"}
                    </p>
                  </Card>
                ) : null
              ) : (
                <Card className="p-12 text-center">
                  <h2 className="text-xl font-semibold text-muted-foreground mb-2">No conversation selected</h2>
                  <p className="text-sm text-muted-foreground">Upload files to see their parsed conversations</p>
                </Card>
              )}
            </main>

            {/* Right Sidebar: AI Summary & Analysis */}
            <aside>
              {selectedConversation ? (
                <AISummary
                  summary={selectedConversation.aiSummary}
                  analysis={selectedConversation.analysis}
                  isSummaryStreaming={
                    selectedConversation.status === "processing" && selectedConversation.step === "summary"
                  }
                  isAnalysisStreaming={
                    selectedConversation.status === "processing" && selectedConversation.step === "analysis"
                  }
                  activeTab={insightsTab}
                  onTabChange={(tab) => useUrlStore.getState().setInsightsTab(tab as InsightsTab)}
                  isCollapsed={isInsightsPanelCollapsed}
                  onToggleCollapse={() => useUrlStore.getState().setInsightsCollapsed(!isInsightsPanelCollapsed)}
                  metadata={selectedConversation.metadata}
                  conversation={selectedConversation.conversation}
                  onGenerateSummary={() => generateSummary(selectedConversation.id, selectedConversation)}
                  canGenerateSummary={
                    selectedConversation.status === "success" &&
                    !!selectedConversation.conversation &&
                    !selectedConversation.aiSummary
                  }
                  onGenerateAnalysis={() => generateAnalysis(selectedConversation.id, selectedConversation)}
                  canGenerateAnalysis={
                    selectedConversation.status === "success" &&
                    !!getAllComponents(selectedConversation).length &&
                    !selectedConversation.analysis
                  }
                />
              ) : (
                <AISummary
                  isCollapsed={isInsightsPanelCollapsed}
                  onToggleCollapse={() => useUrlStore.getState().setInsightsCollapsed(!isInsightsPanelCollapsed)}
                />
              )}
            </aside>
          </div>
        )}
      </div>

      {/* Prompt Editor Dialogs */}
      <PromptEditorDialog
        open={ui.isPromptDialogOpen}
        onOpenChange={ui.setIsPromptDialogOpen}
        title={`Edit Component Identification Prompt${ui.editingDimensionName && ui.editingDimensionName !== "default" ? ` (${ui.editingDimensionName})` : ""}`}
        description="Customize the prompt used to identify components in the conversation. The AI will use this prompt to analyze the conversation and identify logical components."
        value={ui.editingPrompt}
        onChange={ui.setEditingPrompt}
        onApply={() => applyPrompt(selectedConversation)}
        placeholder="Enter your component identification prompt..."
        warningText={
          ui.editingDimensionName && ui.editingDimensionName !== "default"
            ? `This will re-run component identification and classification for the "${ui.editingDimensionName}" dimension`
            : "This will re-run component identification and classification, visualization, and analysis"
        }
      />

      <PromptEditorDialog
        open={ui.isComponentsDialogOpen}
        onOpenChange={ui.setIsComponentsDialogOpen}
        title={`Edit Components${ui.editingDimensionName && ui.editingDimensionName !== "default" ? ` (${ui.editingDimensionName})` : ""}`}
        description="Edit the list of components used for mapping. One component per line. These components will be used instead of AI-identified components."
        value={ui.editingComponents}
        onChange={ui.setEditingComponents}
        onApply={() => applyComponents(selectedConversation)}
        placeholder="Enter components (one per line)..."
        warningText={
          ui.editingDimensionName && ui.editingDimensionName !== "default"
            ? `This will re-run component mapping for the "${ui.editingDimensionName}" dimension`
            : "This will re-run component mapping, visualization, and analysis (skipping component identification)"
        }
      />

      <PromptEditorDialog
        open={ui.isSegmentationPromptDialogOpen}
        onOpenChange={ui.setIsSegmentationPromptDialogOpen}
        title="Edit Segmentation Prompt"
        description="Customize the prompt used to segment large text parts into smaller semantic chunks. The AI will use this prompt to identify where to split long content."
        value={ui.editingSegmentationPrompt}
        onChange={ui.setEditingSegmentationPrompt}
        onApply={() => applySegmentationPrompt(selectedConversation, selectedGroup?.fileIds)}
        placeholder="Enter your segmentation prompt..."
        warningText="This will re-run segmentation, component identification and classification, visualization, and analysis"
        threshold={ui.editingSegmentationThreshold}
        onThresholdChange={ui.setEditingSegmentationThreshold}
        thresholdDefault={DEFAULT_SEGMENTATION_THRESHOLD}
      />

      <PromptEditorDialog
        open={ui.isSummaryPromptDialogOpen}
        onOpenChange={ui.setIsSummaryPromptDialogOpen}
        title="Edit Summary Prompt"
        description="Customize the prompt used to generate the AI summary. The summary feeds into context analysis."
        value={ui.editingSummaryPrompt}
        onChange={ui.setEditingSummaryPrompt}
        onApply={() => applySummaryPrompt(selectedConversation)}
        placeholder="Enter your summary prompt..."
        warningText="This will re-run the AI summary and any dependent analysis"
      />

      <PromptEditorDialog
        open={ui.isAnalysisPromptDialogOpen}
        onOpenChange={ui.setIsAnalysisPromptDialogOpen}
        title="Edit Analysis Prompt"
        description="Customize the prompt used to generate context analysis. The analysis identifies patterns, redundancy, and optimization opportunities."
        value={ui.editingAnalysisPrompt}
        onChange={ui.setEditingAnalysisPrompt}
        onApply={() => applyAnalysisPrompt(selectedConversation)}
        placeholder="Enter your analysis prompt..."
        warningText="This will re-run the context analysis"
      />

      <PromptEditorDialog
        open={ui.isColoringPromptDialogOpen}
        onOpenChange={ui.setIsColoringPromptDialogOpen}
        title="Edit Coloring Prompt"
        description="Customize the prompt used to assign colors to components. Similar components should get the same color for visual grouping."
        value={ui.editingColoringPrompt}
        onChange={ui.setEditingColoringPrompt}
        onApply={() => applyColoringPrompt(selectedConversation)}
        placeholder="Enter your coloring prompt..."
        warningText="This will re-run color assignment for components"
      />
    </div>
  );
}

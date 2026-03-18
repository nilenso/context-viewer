import { useEffect, useMemo, useRef, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import "./parsers";
import { useConversationStore, buildBaseContext } from "./stores/conversation-store";
import { useUIStore } from "./stores/ui-store";
import type { WorkflowState } from "./workflow/types";
import { WorkflowEvent } from "./workflow/types";
import type { Notify } from "./workflow/runner";
import { processConversationWorkflow } from "./workflow/pipeline";
import { ensureDimensions } from "./workflow/dimensions";
import { getComponentisationConfig } from "./workflow/component-identification";
import type { ConversationComponentData } from "./components/ComponentComparisonView";
import { aggregateComponentTokens } from "./aggregation";
import { ConversationList } from "./components/ConversationList";
import {
  ConversationView,
  type TabType,
  type SortOption,
} from "./components/ConversationView";
import { AISummary } from "./components/AISummary";
import { Card } from "./components/ui/card";
import { PromptEditorDialog } from "./components/PromptEditorDialog";
import { Clock, Loader2, Upload, AlertCircle, Star, Github } from "lucide-react";
import { cn } from "./lib/utils";
import {
  getDefaultComponentIdentificationPrompt,
  getDefaultSegmentationPrompt,
  getDefaultSummaryPrompt,
  getDefaultAnalysisPrompt,
  getDefaultColoringPrompt,
} from "./prompts";
import { DEFAULT_SEGMENTATION_THRESHOLD } from "./segmentation";
import { loadPresetIndex, loadPreset } from "./lib/preset-loader";
import { PresetSelector } from "./components/PresetSelector";
import { UrlImport } from "./components/UrlImport";
import { createFileValidator, SUPPORTED_EXTENSIONS_TEXT } from "./lib/file-formats";
import { fetchFileFromUrl } from "./lib/url-fetch";
import { useUrlState } from "./hooks/useUrlState";
import type { InsightsTab } from "./lib/url-state";

export default function App() {
  // ---- Stores ----
  const conversations = useConversationStore((s) => s.conversations);
  const selectedIds = useConversationStore((s) => s.selectedIds);
  const hasApiKeyState = useConversationStore((s) => s.hasApiKeyState);

  const {
    updateConversation,
    appendSummaryChunk,
    appendAnalysisChunk,
    toggleSelect: handleToggleSelection,
    clearSelection: handleClearSelection,
    selectAll: handleSelectAll,
    renameConversation: handleRenameConversation,
    handleApplyPromptsToAll,
    handleExportPromptsAsPreset,
    handleExportSession,
    handleResumeWorkflowsWithApiKey,
    setHasApiKeyState,
    processPendingGroups,
    handleFileDrop: storeHandleFileDrop,
  } = useConversationStore();

  const ui = useUIStore();

  // ---- URL state ----
  const {
    state: urlState,
    navigateToConversation,
    navigateToTab,
    setInsightsTab,
    setSidebarCollapsed,
    setInsightsCollapsed,
    setSearchQuery,
    setSort,
    setMessageFilters,
    setComponentFilters,
    setComparisonView,
    setComparisonLegend,
    setComparisonSortBy,
    setComparisonSortDir,
    setComparisonCols,
    setComparisonSquaresPerRow,
  } = useUrlState();

  const selectedId = urlState.conversationId;
  const insightsTab = urlState.insightsTab;
  const isSidebarCollapsed = urlState.sidebarCollapsed;
  const isInsightsPanelCollapsed = urlState.insightsCollapsed;

  const setSelectedId = useCallback(
    (id: string | null) => {
      if (id === null) {
        const basePath = import.meta.env.BASE_URL || "/";
        window.history.replaceState({}, "", basePath);
      } else {
        const conv = conversations.find((c) => c.id === id);
        const isGrouped = conv?.isGrouped ?? false;
        navigateToConversation(id, isGrouped);
      }
    },
    [conversations, navigateToConversation],
  );

  // ---- Derived state ----
  const pausedWorkflowCount = useMemo(
    () => conversations.filter((c) => c.status === "paused-for-api-key").length,
    [conversations],
  );

  const selectedConversation = useMemo(() => {
    if (conversations.length === 0) return undefined;
    return conversations.find((conv) => conv.id === selectedId) ?? conversations[0];
  }, [conversations, selectedId]);

  const sourceConversationComponents = useMemo((): ConversationComponentData[] | undefined => {
    if (!selectedConversation?.isGrouped || !selectedConversation.sourceConversations) return undefined;

    return selectedConversation.sourceConversations
      .map((source) => {
        const conv = conversations.find((c) => c.id === source.id);
        if (!conv?.conversation || !conv.componentMapping) return null;

        const { componentTokens, totalTokens } = aggregateComponentTokens(
          conv.conversation,
          conv.componentMapping,
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
            const component = conv.componentMapping[part.id];
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
          id: source.id,
          filename: source.filename,
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
  }, [selectedConversation, conversations]);

  const sourceWorkflowStates = useMemo(() => {
    if (!selectedConversation?.isGrouped || !selectedConversation.sourceConversations) return undefined;
    return selectedConversation.sourceConversations
      .map((source) => {
        const conv = conversations.find((c) => c.id === source.id);
        if (!conv?.conversation || !conv.componentMapping) return null;
        return {
          id: source.id,
          filename: source.filename,
          title: conv.title,
          conversation: conv.conversation,
          componentMapping: conv.componentMapping,
          dimensions: conv.dimensions,
        };
      })
      .filter((state): state is NonNullable<typeof state> => state !== null);
  }, [selectedConversation, conversations]);

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
      if (!urlState.importUrl) setSelectedId(null);
      return;
    }
    const [firstConversation] = conversations;
    if (!firstConversation) {
      setSelectedId(null);
      return;
    }
    if (!selectedId) {
      setSelectedId(firstConversation.id);
      return;
    }
    if (!conversations.some((conv) => conv.id === selectedId)) {
      const pendingGroups = useConversationStore.getState().pendingSessionImport?.groups;
      if (pendingGroups?.some((g) => g.id === selectedId)) return;
      setSelectedId(firstConversation.id);
    }
  }, [conversations, selectedId]);

  // Process pending groups from session import
  useEffect(() => {
    processPendingGroups(setSelectedId);
  }, [conversations]);

  // Switch to analysis tab when analysis starts streaming
  useEffect(() => {
    if (selectedConversation?.status === "processing" && selectedConversation.step === "analysis") {
      setInsightsTab("analysis");
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
            component: selectedConversation.componentMapping?.[part.id],
          })),
        })),
      };
      (window as any).__debug = {
        conversation: conversationWithComponents,
        summary: selectedConversation.summary,
        msg: (index: number) => conversationWithComponents.messages[index],
        part: (msgIndex: number, partIndex: number) =>
          conversationWithComponents.messages[msgIndex]?.parts[partIndex],
        componentComparison: sourceConversationComponents,
        componentColors: selectedConversation.componentColors,
      };
    }
  }, [selectedConversation, sourceConversationComponents]);

  // URL auto-import
  const importInProgressRef = useRef(false);
  useEffect(() => {
    const { importUrl } = urlState;
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
  }, [urlState.importUrl]);

  // ---- Handlers ----

  const handleFileDrop = async (files: File[]) => {
    await storeHandleFileDrop(files, setSelectedId, selectedId, ui.loadedPreset);
  };

  // Streaming chunk callbacks
  const onAnalysisChunk = (id: string, chunk: string) => appendAnalysisChunk(id, chunk);
  const onSummaryChunk = (id: string, chunk: string) => appendSummaryChunk(id, chunk);

  // Reprocess handlers
  const handleReprocessComponents = async (options: { customPrompt?: string; customComponents?: string[] } = {}) => {
    if (!selectedConversation?.conversation) return;
    const id = selectedConversation.id;
    ui.setReprocessingId(id);
    try {
      // Check if grouped
      if (selectedConversation.isGrouped && selectedConversation.sourceConversations) {
        const sourceConvs = selectedConversation.sourceConversations
          .map((source) => conversations.find((c) => c.id === source.id))
          .filter((c): c is WorkflowState => c !== null && c?.conversation !== null);

        await Promise.all(
          sourceConvs.map(async (conv) => {
            await useConversationStore.getState().handleReprocessWithRunner(
              conv,
              WorkflowEvent.ComponentPromptChanged,
              (ctx) => {
                ctx.customPrompt = options.customPrompt;
                ctx.customComponents = options.customComponents;
              },
              { onAnalysisChunk },
            );
          }),
        );
        return;
      }

      await useConversationStore.getState().handleReprocessWithRunner(
        selectedConversation,
        WorkflowEvent.ComponentPromptChanged,
        (ctx) => {
          ctx.customPrompt = options.customPrompt;
          ctx.customComponents = options.customComponents;
        },
        { onAnalysisChunk },
      );
    } catch (error) {
      console.error("Failed to reprocess:", error);
      updateConversation(id, { status: "failed", step: undefined, error: "Component reprocessing failed" });
    } finally {
      ui.setReprocessingId(null);
    }
  };

  const handleReprocessSegmentation = async (options: { customSegmentationPrompt?: string; segmentationThreshold?: number } = {}) => {
    if (!selectedConversation?.conversation) return;
    const id = selectedConversation.id;
    ui.setReprocessingId(id);
    try {
      if (selectedConversation.isGrouped && selectedConversation.sourceConversations) {
        const sourceConvs = selectedConversation.sourceConversations
          .map((source) => conversations.find((c) => c.id === source.id))
          .filter((c): c is WorkflowState => c !== null && c?.conversation !== null);
        await Promise.all(
          sourceConvs.map(async (conv) => {
            await useConversationStore.getState().handleReprocessWithRunner(
              conv,
              WorkflowEvent.SegmentationPromptChanged,
              (ctx) => {
                ctx.customSegmentationPrompt = options.customSegmentationPrompt;
                ctx.segmentationThreshold = options.segmentationThreshold;
              },
              { onAnalysisChunk },
            );
          }),
        );
        return;
      }
      await useConversationStore.getState().handleReprocessWithRunner(
        selectedConversation,
        WorkflowEvent.SegmentationPromptChanged,
        (ctx) => {
          ctx.customSegmentationPrompt = options.customSegmentationPrompt;
          ctx.segmentationThreshold = options.segmentationThreshold;
        },
        { onAnalysisChunk },
      );
    } catch (error) {
      console.error("Failed to reprocess segmentation:", error);
      updateConversation(id, { status: "failed", step: undefined, error: "Segmentation reprocessing failed" });
    } finally {
      ui.setReprocessingId(null);
    }
  };

  const handleReprocessSummary = async (options: { customSummaryPrompt?: string } = {}) => {
    if (!selectedConversation?.conversation) return;
    const id = selectedConversation.id;
    const shouldRegenerateAnalysis =
      !!selectedConversation.analysis || selectedConversation.stepTimings?.analysis !== undefined;

    ui.setReprocessingId(id);
    try {
      const notify: Notify = (rid, update) => updateConversation(rid, update);
      const ctx = buildBaseContext(selectedConversation);
      ctx.aiSummary = "";
      ctx.analysis = shouldRegenerateAnalysis ? "" : ctx.analysis;
      ctx.customSummaryPrompt = options.customSummaryPrompt;
      ctx.regenerateAnalysis = shouldRegenerateAnalysis;
      ctx.stepTimings = {
        ...ctx.stepTimings,
        summary: undefined,
        ...(shouldRegenerateAnalysis ? { analysis: undefined } : {}),
      };

      await processConversationWorkflow(WorkflowEvent.SummaryPromptChanged, ctx, notify, {
        onSummaryChunk,
        onAnalysisChunk: shouldRegenerateAnalysis ? onAnalysisChunk : undefined,
      });
    } catch (error) {
      console.error("Failed to reprocess summary:", error);
      updateConversation(id, { status: "failed", step: undefined, error: "Summary reprocessing failed" });
    } finally {
      ui.setReprocessingId(null);
    }
  };

  const handleGenerateAnalysis = async (id: string, options: { customAnalysisPrompt?: string } = {}) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv?.conversation) return;

    ui.setReprocessingId(id);
    try {
      const notify: Notify = (rid, update) => updateConversation(rid, update);
      const ctx: WorkflowState = {
        ...buildBaseContext(conv),
        analysis: "",
        customAnalysisPrompt: options.customAnalysisPrompt || conv.customAnalysisPrompt,
        isGrouped: conv.isGrouped,
        sourceConversations: conv.sourceConversations,
        messageSourceMap: conv.messageSourceMap,
      };

      await processConversationWorkflow(WorkflowEvent.GenerateAnalysis, ctx, notify, {
        onSummaryChunk,
        onAnalysisChunk,
      });
    } catch (error) {
      console.error("Failed to generate analysis:", error);
      updateConversation(id, { status: "failed", step: undefined, error: "Analysis generation failed" });
    } finally {
      ui.setReprocessingId(null);
    }
  };

  const handleGenerateSummary = async (id: string, options: { customSummaryPrompt?: string } = {}) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv?.conversation) return;

    ui.setReprocessingId(id);
    try {
      const notify: Notify = (rid, update) => updateConversation(rid, update);
      const ctx: WorkflowState = {
        ...buildBaseContext(conv),
        aiSummary: "",
        customSummaryPrompt: options.customSummaryPrompt || conv.customSummaryPrompt,
        isGrouped: conv.isGrouped,
        sourceConversations: conv.sourceConversations,
        messageSourceMap: conv.messageSourceMap,
      };

      await processConversationWorkflow(WorkflowEvent.GenerateSummary, ctx, notify, {
        onSummaryChunk,
      });
    } catch (error) {
      console.error("Failed to generate summary:", error);
      updateConversation(id, { status: "failed", step: undefined, error: "Summary generation failed" });
    } finally {
      ui.setReprocessingId(null);
    }
  };

  // Prompt editor open handlers
  const handleOpenPromptEditor = (id: string, dimensionName?: string) => {
    setSelectedId(id);
    const conv = conversations.find((c) => c.id === id);
    const dimName = dimensionName || "default";
    ui.setEditingDimensionName(dimName);

    const dimPrompt = conv?.dimensions?.[dimName]?.prompt;
    const currentPrompt =
      dimPrompt ||
      conv?.customPrompt ||
      ui.loadedPreset?.componentIdentificationPrompt ||
      getDefaultComponentIdentificationPrompt();
    ui.setEditingPrompt(currentPrompt);
    ui.setIsPromptDialogOpen(true);
  };

  const handleApplyPrompt = async () => {
    ui.setIsPromptDialogOpen(false);
    if (!selectedConversation?.conversation) return;

    const dimName = ui.editingDimensionName || "default";
    const id = selectedConversation.id;

    // Update dimension prompt in state
    useConversationStore.getState().setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== id) return conv;
        const dims = { ...(conv.dimensions || {}) };
        if (dims[dimName]) {
          dims[dimName] = { ...dims[dimName]!, prompt: ui.editingPrompt };
        } else {
          dims[dimName] = {
            name: dimName,
            prompt: ui.editingPrompt,
            components: [],
            componentMapping: {},
            componentTimeline: [],
            componentColors: {},
          };
        }
        return {
          ...conv,
          dimensions: dims,
          ...(dimName === "default" ? { customPrompt: ui.editingPrompt } : {}),
        };
      }),
    );

    ui.setReprocessingId(id);
    try {
      const notify: Notify = (rid, update) => updateConversation(rid, update);
      const conv = conversations.find((c) => c.id === id)!;
      const ctx = buildBaseContext(conv);

      const dims = ensureDimensions(ctx);
      if (!dims[dimName]) {
        dims[dimName] = {
          name: dimName,
          components: [],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        };
      }
      dims[dimName]!.prompt = ui.editingPrompt;
      ctx.targetDimension = dimName;
      ctx.customPrompt = dimName === "default" ? ui.editingPrompt : ctx.customPrompt;

      await processConversationWorkflow(WorkflowEvent.ComponentPromptChanged, ctx, notify, { onAnalysisChunk });
    } catch (error) {
      console.error("Failed to reprocess dimension:", error);
    } finally {
      ui.setReprocessingId(null);
    }
  };

  const handleOpenComponentsEditor = (id: string, dimensionName?: string) => {
    setSelectedId(id);
    const conv = conversations.find((c) => c.id === id);
    const dimName = dimensionName || "default";
    ui.setEditingDimensionName(dimName);

    const dimComponents = conv?.dimensions?.[dimName]?.components;
    const currentComponents = dimComponents || conv?.components || [];
    ui.setEditingComponents([...new Set(currentComponents)].join("\n"));
    ui.setIsComponentsDialogOpen(true);
  };

  const handleApplyComponents = async () => {
    ui.setIsComponentsDialogOpen(false);
    if (!selectedConversation?.conversation) return;

    const components = ui.editingComponents
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (components.length === 0) return;

    const dimName = ui.editingDimensionName || "default";
    const id = selectedConversation.id;

    useConversationStore.getState().setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== id) return conv;
        const dims = { ...(conv.dimensions || {}) };
        if (dims[dimName]) {
          dims[dimName] = { ...dims[dimName]!, customComponents: components };
        }
        return { ...conv, dimensions: dims };
      }),
    );

    ui.setReprocessingId(id);
    try {
      const notify: Notify = (rid, update) => updateConversation(rid, update);
      const conv = conversations.find((c) => c.id === id)!;
      const ctx = buildBaseContext(conv);
      const dims = ensureDimensions(ctx);
      if (dims[dimName]) dims[dimName]!.customComponents = components;
      ctx.targetDimension = dimName;

      await processConversationWorkflow(WorkflowEvent.ComponentPromptChanged, ctx, notify, { onAnalysisChunk });
    } catch (error) {
      console.error("Failed to reprocess dimension components:", error);
    } finally {
      ui.setReprocessingId(null);
    }
  };

  const handleOpenSegmentationPromptEditor = (id: string) => {
    setSelectedId(id);
    const conv = conversations.find((c) => c.id === id);
    ui.setEditingSegmentationPrompt(conv?.customSegmentationPrompt || getDefaultSegmentationPrompt());
    ui.setEditingSegmentationThreshold(conv?.segmentationThreshold ?? DEFAULT_SEGMENTATION_THRESHOLD);
    ui.setIsSegmentationPromptDialogOpen(true);
  };

  const handleApplySegmentationPrompt = async () => {
    ui.setIsSegmentationPromptDialogOpen(false);
    if (selectedConversation?.conversation) {
      await handleReprocessSegmentation({
        customSegmentationPrompt: ui.editingSegmentationPrompt,
        segmentationThreshold: ui.editingSegmentationThreshold,
      });
    }
  };

  const handleOpenSummaryPromptEditor = (id: string) => {
    setSelectedId(id);
    const conv = conversations.find((c) => c.id === id);
    ui.setEditingSummaryPrompt(conv?.customSummaryPrompt || getDefaultSummaryPrompt());
    ui.setIsSummaryPromptDialogOpen(true);
  };

  const handleApplySummaryPrompt = async () => {
    ui.setIsSummaryPromptDialogOpen(false);
    if (selectedConversation?.conversation) {
      await handleReprocessSummary({ customSummaryPrompt: ui.editingSummaryPrompt });
    }
  };

  const handleOpenAnalysisPromptEditor = (id: string) => {
    setSelectedId(id);
    const conv = conversations.find((c) => c.id === id);
    ui.setEditingAnalysisPrompt(conv?.customAnalysisPrompt || getDefaultAnalysisPrompt());
    ui.setIsAnalysisPromptDialogOpen(true);
  };

  const handleApplyAnalysisPrompt = async () => {
    ui.setIsAnalysisPromptDialogOpen(false);
    if (selectedConversation?.conversation) {
      await handleGenerateAnalysis(selectedConversation.id, {
        customAnalysisPrompt: ui.editingAnalysisPrompt,
      });
    }
  };

  const handleOpenColoringPromptEditor = (id: string) => {
    setSelectedId(id);
    const conv = conversations.find((c) => c.id === id);
    ui.setEditingColoringPrompt(conv?.customColoringPrompt || getDefaultColoringPrompt());
    ui.setIsColoringPromptDialogOpen(true);
  };

  const handleApplyColoringPrompt = async () => {
    ui.setIsColoringPromptDialogOpen(false);
    if (!selectedConversation?.conversation) return;

    const id = selectedConversation.id;
    ui.setReprocessingId(id);

    try {
      const notify: Notify = (rid, update) => updateConversation(rid, update);
      const ctx = buildBaseContext(selectedConversation);
      ctx.customColoringPrompt = ui.editingColoringPrompt;

      await processConversationWorkflow(WorkflowEvent.ColoringPromptChanged, ctx, notify, {});
      updateConversation(id, { customColoringPrompt: ui.editingColoringPrompt });
    } catch (error) {
      console.error("Failed to reprocess coloring:", error);
      updateConversation(id, { status: "failed", step: undefined, error: "Coloring reprocessing failed" });
    } finally {
      ui.setReprocessingId(null);
    }
  };

  // Dimension management
  const handleAddDimension = async (name: string) => {
    if (!selectedConversation?.conversation) return;
    const id = selectedConversation.id;

    useConversationStore.getState().setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== id) return conv;
        let dims = { ...(conv.dimensions || {}) };
        if (Object.keys(dims).length === 0 && conv.components) {
          dims["default"] = {
            name: "default",
            prompt: conv.customPrompt,
            components: conv.components || [],
            componentMapping: conv.componentMapping || {},
            componentTimeline: conv.componentTimeline || [],
            componentColors: conv.componentColors || {},
          };
        }
        dims[name] = {
          name,
          components: [],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        };
        return { ...conv, dimensions: dims };
      }),
    );

    ui.setActiveDimensions(new Set([...ui.activeDimensions, name]));
    ui.setEditingDimensionName(name);
    ui.setEditingPrompt(getDefaultComponentIdentificationPrompt());
    ui.setIsPromptDialogOpen(true);
  };

  const handleRemoveDimension = (name: string) => {
    if (name === "default" || !selectedConversation) return;
    const id = selectedConversation.id;

    useConversationStore.getState().setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== id) return conv;
        const dims = { ...(conv.dimensions || {}) };
        delete dims[name];
        return { ...conv, dimensions: dims };
      }),
    );
    const next = new Set(ui.activeDimensions);
    next.delete(name);
    ui.setActiveDimensions(next);
  };

  const handleRenameDimension = (oldName: string, newName: string) => {
    if (!selectedConversation) return;
    const id = selectedConversation.id;

    useConversationStore.getState().setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== id) return conv;
        const dims = { ...(conv.dimensions || {}) };
        if (!dims[oldName]) return conv;
        dims[newName] = { ...dims[oldName]!, name: newName };
        delete dims[oldName];
        return { ...conv, dimensions: dims };
      }),
    );
    const next = new Set(ui.activeDimensions);
    if (next.has(oldName)) {
      next.delete(oldName);
      next.add(newName);
    }
    ui.setActiveDimensions(next);
  };

  // Sidebar toggle handlers
  const handleToggleSidebar = () => setSidebarCollapsed(!isSidebarCollapsed);
  const handleToggleInsightsPanel = () => setInsightsCollapsed(!isInsightsPanelCollapsed);

  // API key change
  const handleApiKeyChange = (hasKey: boolean) => setHasApiKeyState(hasKey);

  // Group/ungroup wrappers that pass setSelectedId
  const handleGroupConversations = (idsToGroup?: string[], groupName?: string, existingGroupId?: string, groupTitle?: string) =>
    useConversationStore.getState().handleGroupConversations(idsToGroup, setSelectedId, groupName, existingGroupId, groupTitle);

  const handleUngroupConversation = (id: string) =>
    useConversationStore.getState().handleUngroupConversation(id, selectedId, setSelectedId);

  const handleDeleteConversation = (id: string) =>
    useConversationStore.getState().deleteConversation(id, selectedId, setSelectedId);

  const handleUpdateGroupSources = (groupId: string, newSources: Array<{ id: string; filename: string; title?: string }>) =>
    useConversationStore.getState().handleUpdateGroupSources(groupId, newSources, selectedId, setSelectedId);

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
                  <p className="text-sm text-muted-foreground break-all max-w-lg">{urlState.importUrl}</p>
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
                      <p className="text-xs text-muted-foreground break-all max-w-lg mb-6">{urlState.importUrl}</p>
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
              <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
                selectedIds={selectedIds}
                onToggleSelection={handleToggleSelection}
                onGroupConversations={handleGroupConversations}
                onClearSelection={handleClearSelection}
                onSelectAll={handleSelectAll}
                onUngroupConversation={handleUngroupConversation}
                onDeleteConversation={handleDeleteConversation}
                onRename={handleRenameConversation}
                onGenerateAnalysis={handleGenerateAnalysis}
                onGenerateSummary={handleGenerateSummary}
                onFilesSelected={(files) => handleFileDrop(files)}
                onEditPrompt={handleOpenPromptEditor}
                onEditComponents={handleOpenComponentsEditor}
                onEditSegmentationPrompt={handleOpenSegmentationPromptEditor}
                onEditSummaryPrompt={handleOpenSummaryPromptEditor}
                onEditAnalysisPrompt={handleOpenAnalysisPromptEditor}
                onEditColoringPrompt={handleOpenColoringPromptEditor}
                onAddDimension={handleAddDimension}
                onRemoveDimension={handleRemoveDimension}
                onRenameDimension={handleRenameDimension}
                onEditDimensionPrompt={(id, dimName) => handleOpenPromptEditor(id, dimName)}
                onApplyPromptsToAll={handleApplyPromptsToAll}
                onExportPromptsAsPreset={handleExportPromptsAsPreset}
                onExportSession={handleExportSession}
                onUpdateGroupSources={handleUpdateGroupSources}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={handleToggleSidebar}
                pausedWorkflowCount={pausedWorkflowCount}
                onApiKeyChange={handleApiKeyChange}
                onResumeWorkflows={handleResumeWorkflowsWithApiKey}
              />
            </aside>

            {/* Main Panel */}
            <main>
              {selectedConversation ? (
                selectedConversation.conversation ? (
                  <ConversationView
                    conversation={selectedConversation.conversation}
                    componentMapping={selectedConversation.componentMapping}
                    componentTimeline={selectedConversation.componentTimeline}
                    componentColors={selectedConversation.componentColors}
                    components={(() => {
                      const dims = selectedConversation.dimensions;
                      if (!dims || Object.keys(dims).length <= 1) return selectedConversation.components;
                      const allComps = new Set(selectedConversation.components || []);
                      for (const dim of Object.values(dims)) {
                        for (const c of dim.components) allComps.add(c);
                      }
                      return [...allComps];
                    })()}
                    dimensions={selectedConversation.dimensions}
                    activeDimensions={ui.activeDimensions}
                    onActiveDimensionsChange={ui.setActiveDimensions}
                    staticMapping={selectedConversation.staticMapping}
                    staticTimeline={selectedConversation.staticTimeline}
                    warnings={selectedConversation.warnings}
                    onReprocessComponents={handleReprocessComponents}
                    isReprocessing={ui.reprocessingId === selectedConversation.id}
                    messageSourceMap={selectedConversation.messageSourceMap}
                    isGrouped={selectedConversation.isGrouped}
                    groupTitle={selectedConversation.title}
                    onConversationClick={setSelectedId}
                    sourceConversationComponents={sourceConversationComponents}
                    sourceWorkflowStates={sourceWorkflowStates}
                    onAddDimension={handleAddDimension}
                    onRemoveDimension={handleRemoveDimension}
                    onRenameDimension={handleRenameDimension}
                    onEditDimensionPrompt={(dimName) => handleOpenPromptEditor(selectedConversation.id, dimName)}
                    activeTab={urlState.tab as TabType}
                    onTabChange={(tab) => navigateToTab(tab)}
                    searchQuery={urlState.searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    sortBy={urlState.sort as SortOption}
                    onSortByChange={setSort}
                    messageFilters={urlState.messageFilters}
                    onMessageFiltersChange={setMessageFilters}
                    selectedComponents={urlState.componentFilters}
                    onSelectedComponentsChange={setComponentFilters}
                    comparisonViewMode={urlState.comparisonView}
                    onComparisonViewModeChange={setComparisonView}
                    comparisonLegendMode={urlState.comparisonLegend}
                    onComparisonLegendModeChange={setComparisonLegend}
                    comparisonSortField={urlState.comparisonSortBy}
                    onComparisonSortFieldChange={setComparisonSortBy}
                    comparisonSortDirection={urlState.comparisonSortDir}
                    onComparisonSortDirectionChange={setComparisonSortDir}
                    comparisonColumnCount={urlState.comparisonCols}
                    onComparisonColumnCountChange={setComparisonCols}
                    comparisonSquaresPerRow={urlState.comparisonSquaresPerRow}
                    onComparisonSquaresPerRowChange={setComparisonSquaresPerRow}
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
                  onTabChange={(tab) => setInsightsTab(tab as InsightsTab)}
                  isCollapsed={isInsightsPanelCollapsed}
                  onToggleCollapse={handleToggleInsightsPanel}
                  metadata={selectedConversation.metadata}
                  conversation={selectedConversation.conversation}
                  onGenerateSummary={() => handleGenerateSummary(selectedConversation.id)}
                  canGenerateSummary={
                    selectedConversation.status === "success" &&
                    !!selectedConversation.conversation &&
                    !selectedConversation.aiSummary
                  }
                  onGenerateAnalysis={() => handleGenerateAnalysis(selectedConversation.id)}
                  canGenerateAnalysis={
                    selectedConversation.status === "success" &&
                    !!selectedConversation.components?.length &&
                    !selectedConversation.analysis
                  }
                />
              ) : (
                <AISummary
                  isCollapsed={isInsightsPanelCollapsed}
                  onToggleCollapse={handleToggleInsightsPanel}
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
        onApply={handleApplyPrompt}
        placeholder="Enter your componentisation prompt..."
        warningText={
          ui.editingDimensionName && ui.editingDimensionName !== "default"
            ? `This will re-run componentisation for the "${ui.editingDimensionName}" dimension`
            : "This will re-run componentisation, visualization, and analysis"
        }
      />

      <PromptEditorDialog
        open={ui.isComponentsDialogOpen}
        onOpenChange={ui.setIsComponentsDialogOpen}
        title={`Edit Components${ui.editingDimensionName && ui.editingDimensionName !== "default" ? ` (${ui.editingDimensionName})` : ""}`}
        description="Edit the list of components used for mapping. One component per line. These components will be used instead of AI-identified components."
        value={ui.editingComponents}
        onChange={ui.setEditingComponents}
        onApply={handleApplyComponents}
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
        onApply={handleApplySegmentationPrompt}
        placeholder="Enter your segmentation prompt..."
        warningText="This will re-run segmentation, componentisation, visualization, and analysis"
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
        onApply={handleApplySummaryPrompt}
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
        onApply={handleApplyAnalysisPrompt}
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
        onApply={handleApplyColoringPrompt}
        placeholder="Enter your coloring prompt..."
        warningText="This will re-run color assignment for components"
      />
    </div>
  );
}

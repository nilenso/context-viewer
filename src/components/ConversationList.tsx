import { useState, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FileText,
  Loader2,
  AlertCircle,
  Clock,
  Upload,
  ChevronRight,
  Check,
  Circle,
  Play,
  AlertTriangle,
  Menu,
  ChevronLeft,
  Layers,
  Ungroup,
  X,
  Trash2,
  Maximize2,
  Download,
  Pause,
  ChevronDown,
  Plus,
  Pencil,
} from "lucide-react";
import { getComponentWaffleStyles } from "@/lib/component-colors";
import { cn } from "@/lib/utils";
import { ApiKeyInput } from "./ApiKeyInput";
import { WorkflowDetailModal } from "./WorkflowDetailModal";
import {
  createFileValidator,
  SUPPORTED_EXTENSIONS_TEXT,
} from "@/lib/file-formats";
import type { WorkflowState, Group, ProcessingStep } from "@/workflow/types";
import { useConversationStore } from "@/stores/conversation-store";
import { useUrlStore } from "@/stores/url-store";
import { useUIStore } from "@/stores/ui-store";
import {
  navigateToId,
  openPromptEditor,
  openComponentsEditor,
  openSegmentationPromptEditor,
  openSummaryPromptEditor,
  openAnalysisPromptEditor,
  openColoringPromptEditor,
  generateAnalysis,
  generateSummary,
  addDimension,
  removeDimension,
  renameDimension,
  groupConversations,
  ungroupConversation,
  deleteConversation,
  updateGroupSources,
  exportSession,
  exportPromptsAsPresetAction,
} from "@/hooks/useWorkflowActions";

export function ConversationList() {
  // Stores
  const conversations = useConversationStore((s) => s.conversations);
  const groups = useConversationStore((s) => s.groups);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const hasApiKeyState = useUIStore((s) => s.hasApiKeyState);

  const selectedId = useUrlStore((s) => s.conversationId);
  const isCollapsed = useUrlStore((s) => s.sidebarCollapsed);

  // Computed
  const pausedWorkflowCount = conversations.filter((c) => c.status === "paused-for-api-key").length;

  // Local handlers
  const handleToggleCollapse = () => useUrlStore.getState().setSidebarCollapsed(!isCollapsed);
  const handleFilesSelected = (files: File[]) => useConversationStore.getState().processFileDrop(files, useUIStore.getState().loadedPreset);

  // Initialize with all conversations expanded by default
  const [collapsedProgress, setCollapsedProgress] = useState<Set<string>>(
    new Set(),
  );
  // Selection mode - when true, show checkboxes
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  // Expanded view modal state
  const [expandedConversationId, setExpandedConversationId] = useState<
    string | null
  >(null);
  // Inline title editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  // Dimension accordion state — keyed by "conversationId:dimName" so each conversation is independent
  const [expandedDimension, setExpandedDimension] = useState<string | null>(null);
  const [addingDimension, setAddingDimension] = useState(false);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [renamingDimension, setRenamingDimension] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Group helpers
  const getGroup = (id: string): Group | undefined => groups[id];
  const isGroupEntry = (id: string): boolean => !!groups[id];
  const isPartOfGroup = (id: string): boolean =>
    Object.values(groups).some((g) => g.fileIds.includes(id));
  const getMemberFiles = (groupId: string): Array<{ id: string; filename: string; title?: string }> => {
    const group = groups[groupId];
    if (!group) return [];
    return group.fileIds.map((fid) => {
      const conv = conversations.find((c) => c.id === fid);
      return { id: fid, filename: conv?.filename || fid, title: conv?.title };
    });
  };

  // Build unified display list: individual files + group entries
  type DisplayItem = { id: string; filename: string; title?: string; isGroup: boolean; conv?: WorkflowState };
  const displayItems = useMemo((): DisplayItem[] => {
    const items: DisplayItem[] = [];
    for (const conv of conversations) {
      items.push({ id: conv.id, filename: conv.filename, title: conv.title, isGroup: false, conv });
    }
    for (const group of Object.values(groups)) {
      items.push({ id: group.id, filename: group.name, title: group.title, isGroup: true });
    }
    return items;
  }, [conversations, groups]);

  // Count of selectable conversations (non-grouped, success status)
  const selectableConversations = conversations.filter(
    (c) => c.status === "success",
  );
  const canGroup = selectedIds.size >= 2;

  const canDelete = (id: string): boolean => {
    return !isGroupEntry(id) && !isPartOfGroup(id);
  };

  // Save title and exit editing mode
  const handleSaveTitle = (id: string) => {
    useConversationStore.getState().renameConversation(id, editingTitle.trim());
    setEditingId(null);
    setEditingTitle("");
  };

  // Exit selection mode when selection is cleared
  const handleExitSelectionMode = () => {
    setIsSelectionMode(false);
    useUIStore.getState().clearSelection();
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFilesSelected,
    validator: createFileValidator(),
    multiple: true,
    noClick: conversations.length > 0, // Disable click when there are conversations
  });

  const toggleProgress = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCollapsedProgress((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const processingSteps: { key: ProcessingStep; label: string }[] = [
    { key: "parsing", label: "Parse conversation" },
    { key: "counting-tokens", label: "Count tokens" },
    { key: "segmenting", label: "Segment content" },
    { key: "summary", label: "Generate summary" },
    { key: "finding-components", label: "Find components" },
    { key: "coloring", label: "Assign colors" },
    { key: "analysis", label: "Generate analysis" },
  ];

  const getStepStatus = (
    conversation: WorkflowState,
    stepKey: ProcessingStep,
  ): "pending" | "in-progress" | "completed" | "paused" => {
    if (conversation.status === "failed") return "pending";
    if (conversation.status === "pending") return "pending";

    // Handle paused-for-api-key status
    if (conversation.status === "paused-for-api-key") {
      const stepIndex = processingSteps.findIndex((s) => s.key === stepKey);
      const pausedAtIndex = processingSteps.findIndex(
        (s) => s.key === conversation.pausedAtStep,
      );
      if (stepIndex < pausedAtIndex) return "completed";
      if (stepIndex === pausedAtIndex) return "paused";
      return "pending";
    }

    const stepIndex = processingSteps.findIndex((s) => s.key === stepKey);
    const currentStepIndex = processingSteps.findIndex(
      (s) => s.key === conversation.step,
    );

    if (stepKey === "summary") {
      if (conversation.aiSummary && conversation.aiSummary.length > 0) {
        return "completed";
      }
      if (
        conversation.status === "processing" &&
        conversation.step === "summary"
      ) {
        return "in-progress";
      }
      return "pending";
    }

    if (currentStepIndex === -1 && conversation.status === "success") {
      // All steps completed
      return "completed";
    }

    if (stepIndex < currentStepIndex) return "completed";
    if (stepIndex === currentStepIndex) return "in-progress";
    return "pending";
  };

  // When collapsed, show minimal UI
  if (isCollapsed) {
    return (
      <div className="h-full flex flex-col items-center bg-background border rounded-md transition-all duration-200 w-12 py-3">
        <div className="flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleCollapse}
            className="h-8 w-8 p-0"
            title="Open conversations panel"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground mt-2 [writing-mode:vertical-lr] rotate-180">
          Conversations
        </span>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Conversations</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleCollapse}
            className="h-8 w-8 p-0"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        <Card
          {...getRootProps()}
          className={cn(
            "p-6 border-2 border-dashed cursor-pointer transition-colors",
            isDragActive && "border-primary bg-primary/5",
          )}
        >
          <input {...getInputProps()} />
          <div className="text-center text-muted-foreground">
            <Upload className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">
              {isDragActive
                ? "Drop files here"
                : "Drop files here or click to select"}
            </p>
            <p className="text-xs mt-1">
              Accepts {SUPPORTED_EXTENSIONS_TEXT} files
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Conversations</h2>
        <div className="flex items-center gap-1">
          {/* Selection mode toggle */}
          {!isSelectionMode && selectableConversations.length >= 2 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSelectionMode(true)}
              className="h-8 w-8 p-0"
              title="Select conversations to group"
            >
              <Layers className="h-4 w-4" />
            </Button>
          )}
          {isSelectionMode && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExitSelectionMode}
              className="h-8 w-8 p-0"
              title="Cancel selection"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {/* Export button */}
          {selectableConversations.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportSession()}
              className="h-8 w-8 p-0"
              title="Export session"
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleCollapse}
            className="h-8 w-8 p-0"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Selection mode toolbar */}
      {isSelectionMode && (
        <div className="flex items-center gap-2 px-2 py-2 bg-blue-50 border border-blue-200 rounded-md">
          <Checkbox
            checked={
              selectedIds.size === selectableConversations.length &&
              selectableConversations.length > 0
            }
            onCheckedChange={(checked) => {
              if (checked) {
                useUIStore.getState().selectAll(selectableConversations.map((c) => c.id));
              } else {
                useUIStore.getState().clearSelection();
              }
            }}
            className="shrink-0"
          />
          <span className="text-xs text-blue-700 flex-1">
            {selectedIds.size} selected
          </span>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              groupConversations();
              setIsSelectionMode(false);
            }}
            disabled={!canGroup}
            className="h-7 text-xs"
          >
            <Layers className="h-3 w-3 mr-1" />
            Group
          </Button>
        </div>
      )}

      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-md transition-colors",
          isDragActive && "border-primary bg-primary/5",
          !isDragActive && "border-border",
        )}
      >
        <input {...getInputProps()} />
        <div className="relative">
          <ScrollArea className="h-[calc(100vh-14rem)]">
            <div className="space-y-2">
              {/* Build unified list: conversations + group entries */}
              {[...conversations, ...Object.values(groups).map((g): WorkflowState => ({
                id: g.id,
                filename: g.name,
                title: g.title,
                status: "success",
              }))].map((conversation) => {
                const isProcessing =
                  conversation.status === "processing" ||
                  (conversation.status === "success" && conversation.step);
                const isExpanded = !collapsedProgress.has(conversation.id);
                const isSelectable =
                  !isGroupEntry(conversation.id) && conversation.status === "success";
                const isSelected = selectedIds.has(conversation.id);

                return (
                  <div
                    key={conversation.id}
                    onClick={() => {
                      if (isSelectionMode && isSelectable) {
                        useUIStore.getState().toggleSelect(conversation.id, !isSelected);
                      } else {
                        navigateToId(conversation.id);
                      }
                    }}
                    className={cn(
                      "rounded-md border border-gray-200 cursor-pointer",
                      selectedId === conversation.id &&
                        !isSelectionMode &&
                        "border-blue-400 bg-blue-50/50",
                      isSelectionMode &&
                        isSelected &&
                        "border-blue-400 bg-blue-50/50",
                      conversation.status === "failed" &&
                        "border-red-200 bg-red-50",
                      isGroupEntry(conversation.id) &&
                        "border-purple-200 bg-purple-50/30",
                    )}
                  >
                    <div
                      className={cn(
                        "w-full text-left py-3 px-3 hover:bg-accent/50 rounded-t-md transition-colors",
                        selectedId === conversation.id && "hover:bg-blue-50",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isProcessing || conversation.status === "success") {
                          toggleProgress(conversation.id);
                        }
                        if (isSelectionMode && isSelectable) {
                          useUIStore.getState().toggleSelect(conversation.id, !isSelected);
                        } else {
                          navigateToId(conversation.id);
                        }
                      }}
                    >
                      <div className="flex flex-col gap-1 w-full overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Checkbox in selection mode */}
                          {isSelectionMode && isSelectable && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                useUIStore.getState().toggleSelect(conversation.id, !!checked);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0"
                            />
                          )}
                          {/* Grouped icon */}
                          {isGroupEntry(conversation.id) && (
                            <Layers className="h-4 w-4 shrink-0 text-purple-600" />
                          )}
                          {/* Status icons for non-grouped */}
                          {!isGroupEntry(conversation.id) &&
                            conversation.status === "pending" && (
                              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                          {!isGroupEntry(conversation.id) && isProcessing && (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                          )}
                          {!isGroupEntry(conversation.id) &&
                            conversation.status === "success" &&
                            !conversation.step &&
                            !conversation.warnings && (
                              <FileText className="h-4 w-4 shrink-0" />
                            )}
                          {!isGroupEntry(conversation.id) &&
                            conversation.status === "success" &&
                            !conversation.step &&
                            conversation.warnings && (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
                            )}
                          {!isGroupEntry(conversation.id) &&
                            conversation.status === "failed" && (
                              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                            )}
                          {!isGroupEntry(conversation.id) &&
                            conversation.status === "paused-for-api-key" && (
                              <Pause className="h-4 w-4 shrink-0 text-amber-600" />
                            )}
                          {editingId === conversation.id ? (
                            <input
                              autoFocus
                              className="font-medium text-sm flex-1 min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-blue-400"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onBlur={() => handleSaveTitle(conversation.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveTitle(conversation.id);
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  setEditingId(null);
                                  setEditingTitle("");
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span
                              className="font-medium text-sm truncate flex-1 min-w-0 cursor-pointer hover:underline"
                              title={conversation.title || conversation.filename}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingId(conversation.id);
                                setEditingTitle(conversation.title || (isGroupEntry(conversation.id) ? "" : conversation.filename));
                              }}
                            >
                              {isGroupEntry(conversation.id)
                                ? conversation.title || "Grouped"
                                : conversation.title || conversation.filename}
                            </span>
                          )}
                          {/* Expand button to open workflow detail modal */}
                          {(conversation.status === "processing" ||
                            conversation.status === "success" ||
                            conversation.status === "paused-for-api-key") && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedConversationId(conversation.id);
                              }}
                              className="shrink-0 p-0.5 hover:bg-accent rounded cursor-pointer"
                              title="View workflow details"
                            >
                              <Maximize2 className="h-4 w-4 text-gray-500 hover:text-gray-700" />
                            </div>
                          )}
                          {/* Ungroup button for grouped conversations */}
                          {isGroupEntry(conversation.id) &&
                            conversation.status === "success" &&
                            !conversation.step && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  ungroupConversation(conversation.id);
                                }}
                                className="shrink-0 p-0.5 hover:bg-accent rounded cursor-pointer"
                                title="Ungroup"
                              >
                                <Ungroup className="h-4 w-4 text-purple-600 hover:text-purple-800" />
                              </div>
                            )}
                          {(isProcessing ||
                            conversation.status === "success" ||
                            conversation.status === "paused-for-api-key") && (
                            <div
                              onClick={(e) =>
                                toggleProgress(conversation.id, e)
                              }
                              className="shrink-0 p-0.5 hover:bg-accent rounded cursor-pointer"
                            >
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 transition-transform",
                                  isExpanded && "rotate-90",
                                )}
                              />
                            </div>
                          )}
                        </div>

                        {/* Source files for grouped conversation */}
                        {isGroupEntry(conversation.id) &&
                          getMemberFiles(conversation.id) && (
                            <div
                              className="text-xs text-purple-600 pl-6 truncate"
                              title={getMemberFiles(conversation.id)
                                .map((s) => s.title || s.filename)
                                .join(", ")}
                            >
                              {getMemberFiles(conversation.id)
                                .map((s) => s.title || s.filename)
                                .join(", ")}
                            </div>
                          )}

                        <div className="flex gap-2 items-center flex-wrap">
                          {conversation.status === "success" &&
                            !conversation.step &&
                            conversation.summary && (
                              <Badge
                                variant="secondary"
                                className="self-start text-xs"
                              >
                                {conversation.summary.totalMessages} messages
                              </Badge>
                            )}

                          {isGroupEntry(conversation.id) &&
                            getMemberFiles(conversation.id) && (
                              <Badge
                                variant="outline"
                                className="self-start text-xs border-purple-400 text-purple-700 bg-purple-50"
                              >
                                {getMemberFiles(conversation.id).length} files
                              </Badge>
                            )}

                          {conversation.status === "failed" && (
                            <Badge
                              variant="destructive"
                              className="self-start text-xs"
                            >
                              Failed
                            </Badge>
                          )}

                          {conversation.status === "paused-for-api-key" && (
                            <Badge
                              variant="outline"
                              className="self-start text-xs border-amber-500 text-amber-700 bg-amber-50"
                            >
                              Waiting for API key
                            </Badge>
                          )}

                          {conversation.status === "success" &&
                            !conversation.step &&
                            conversation.warnings && (
                              <Badge
                                variant="outline"
                                className="self-start text-xs border-yellow-600 text-yellow-700 bg-yellow-50"
                              >
                                {conversation.warnings.length} warning
                                {conversation.warnings.length > 1 ? "s" : ""}
                              </Badge>
                            )}
                        </div>
                      </div>
                    </div>

                    {/* Progress Checklist */}
                    {isExpanded &&
                      (isProcessing || conversation.status === "success" || conversation.status === "paused-for-api-key") && (
                        <div className="px-3 pb-3 pt-1 border-t">
                          <div className="space-y-1">
                            {processingSteps.map((step) => {
                              const status = getStepStatus(
                                conversation,
                                step.key,
                              );
                              const timing =
                                conversation.stepTimings?.[step.key];
                              const isFindComponentsStep =
                                step.key === "finding-components";
                              const isSegmentingStep =
                                step.key === "segmenting";
                              const isSummaryStep = step.key === "summary";
                              const isAnalysisStep = step.key === "analysis";
                              const isColoringStep = step.key === "coloring";
                              // Summary step is clickable when conversation is complete but summary wasn't run
                              const isSummaryClickable =
                                isSummaryStep &&
                                conversation.status === "success" &&
                                !conversation.step &&
                                timing === undefined;
                              // Analysis step is clickable when conversation is complete but analysis wasn't run
                              const isAnalysisClickable =
                                isAnalysisStep &&
                                conversation.status === "success" &&
                                !conversation.step &&
                                timing === undefined;
                              const isClickable = isSummaryClickable || isAnalysisClickable;
                              return (
                                <div key={step.key}>
                                  <div className="flex items-center gap-2 text-xs">
                                    {status === "completed" &&
                                      !isClickable && (
                                        <Check className="h-3 w-3 text-green-600" />
                                      )}
                                    {status === "in-progress" && (
                                      <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                                    )}
                                    {status === "pending" &&
                                      !isClickable && (
                                        <Circle className="h-3 w-3 text-gray-300" />
                                      )}
                                    {status === "paused" && (
                                      <Pause className="h-3 w-3 text-amber-600" />
                                    )}
                                    {isClickable && (
                                      <Play className="h-3 w-3 text-blue-600" />
                                    )}
                                    {isClickable ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isSummaryClickable) {
                                            generateSummary(conversation.id, undefined);
                                          } else {
                                            generateAnalysis(conversation.id, undefined);
                                          }
                                        }}
                                        className="flex-1 text-left text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        {step.label}
                                      </button>
                                    ) : (
                                      <span
                                        className={cn(
                                          "flex-1",
                                          status === "completed" &&
                                            "text-green-700",
                                          status === "in-progress" &&
                                            "text-blue-700 font-medium",
                                          status === "pending" &&
                                            "text-muted-foreground",
                                          status === "paused" &&
                                            "text-amber-700 font-medium",
                                        )}
                                      >
                                        {step.label}
                                      </span>
                                    )}
                                    {status === "completed" &&
                                      timing !== undefined && (
                                        <span className="text-gray-500 text-xs">
                                          ({timing}s)
                                        </span>
                                      )}
                                  </div>
                                  {/* Edit prompt link - show below "Segment content" step */}
                                  {isSegmentingStep && (
                                      <div className="flex gap-2 ml-5 mt-0.5">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openSegmentationPromptEditor(conversation.id);
                                          }}
                                          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                        >
                                          Edit prompt
                                        </button>
                                      </div>
                                    )}
                                  {/* Edit prompt link - show below "Generate summary" step */}
                                  {isSummaryStep && (
                                    <div className="flex gap-2 ml-5 mt-0.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openSummaryPromptEditor(conversation.id);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        Edit prompt
                                      </button>
                                    </div>
                                  )}
                                  {/* Dimension accordion - show below "Find components" step */}
                                  {isFindComponentsStep && (
                                    <>
                                      {/* Dimension Accordion */}
                                      {(() => {
                                        const dims = conversation.dimensions;
                                        const dimNames = dims ? Object.keys(dims) : [];
                                        return (
                                          <div className="ml-5 mt-2 border rounded text-xs">
                                            <div className="px-2 py-1 bg-muted/50 flex items-center justify-between">
                                              <span className="font-medium text-muted-foreground uppercase tracking-wide" style={{ fontSize: "10px" }}>
                                                Dimensions ({dimNames.length || 1})
                                              </span>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setAddingDimension(true);
                                                }}
                                                className="text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
                                              >
                                                <Plus className="h-3 w-3" /> Add
                                              </button>
                                            </div>

                                            {/* Add dimension input */}
                                            {addingDimension && (
                                              <div className="px-2 py-1.5 border-t flex items-center gap-1.5">
                                                <input
                                                  type="text"
                                                  value={newDimensionName}
                                                  onChange={(e) => setNewDimensionName(e.target.value)}
                                                  placeholder="Name..."
                                                  className="flex-1 border rounded px-1.5 py-0.5 text-xs"
                                                  autoFocus
                                                  onClick={(e) => e.stopPropagation()}
                                                  onKeyDown={(e) => {
                                                    e.stopPropagation();
                                                    if (e.key === "Enter" && newDimensionName.trim()) {
                                                      addDimension(conversation.id, newDimensionName.trim());
                                                      setNewDimensionName("");
                                                      setAddingDimension(false);
                                                    }
                                                    if (e.key === "Escape") {
                                                      setAddingDimension(false);
                                                      setNewDimensionName("");
                                                    }
                                                  }}
                                                />
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (newDimensionName.trim()) addDimension(conversation.id, newDimensionName.trim());
                                                    setNewDimensionName("");
                                                    setAddingDimension(false);
                                                  }}
                                                  className="text-blue-600 hover:text-blue-700"
                                                >
                                                  OK
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setAddingDimension(false);
                                                    setNewDimensionName("");
                                                  }}
                                                  className="text-muted-foreground hover:text-foreground"
                                                >
                                                  <X className="h-3 w-3" />
                                                </button>
                                              </div>
                                            )}

                                            {/* Dimension list */}
                                            {dimNames.map((dimName) => {
                                              const dimData = dims![dimName]!;
                                              const dimKey = `${conversation.id}:${dimName}`;
                                              const isExpanded = expandedDimension === dimKey;
                                              return (
                                                <div key={dimName} className="border-t">
                                                  <div
                                                    className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/30 cursor-pointer"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setExpandedDimension(isExpanded ? null : dimKey);
                                                    }}
                                                  >
                                                    {isExpanded ? (
                                                      <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                                    ) : (
                                                      <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                                    )}

                                                    {renamingDimension === dimName ? (
                                                      <input
                                                        type="text"
                                                        value={renameValue}
                                                        onChange={(e) => setRenameValue(e.target.value)}
                                                        className="flex-1 border rounded px-1 py-0 text-xs"
                                                        autoFocus
                                                        onClick={(e) => e.stopPropagation()}
                                                        onKeyDown={(e) => {
                                                          e.stopPropagation();
                                                          if (e.key === "Enter" && renameValue.trim()) {
                                                            renameDimension(conversation.id, dimName, renameValue.trim());
                                                            setRenamingDimension(null);
                                                          }
                                                          if (e.key === "Escape") setRenamingDimension(null);
                                                        }}
                                                        onBlur={() => {
                                                          if (renameValue.trim() && renameValue.trim() !== dimName) {
                                                            renameDimension(conversation.id, dimName, renameValue.trim());
                                                          }
                                                          setRenamingDimension(null);
                                                        }}
                                                      />
                                                    ) : (
                                                      <span className="flex-1 font-medium truncate">{dimName}</span>
                                                    )}

                                                    <span className="text-muted-foreground flex-shrink-0">
                                                      {new Set(dimData.components).size}
                                                    </span>

                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        openPromptEditor(conversation.id, dimName);
                                                      }}
                                                      className="text-muted-foreground hover:text-blue-600 flex-shrink-0"
                                                      title="Edit prompt"
                                                    >
                                                      <Pencil className="h-2.5 w-2.5" />
                                                    </button>
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setRenamingDimension(dimName);
                                                        setRenameValue(dimName);
                                                      }}
                                                      className="text-muted-foreground hover:text-foreground flex-shrink-0"
                                                      title="Rename"
                                                      style={{ fontSize: "9px" }}
                                                    >
                                                      Aa
                                                    </button>
                                                    {dimName !== "default" && (
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          removeDimension(conversation.id, dimName);
                                                        }}
                                                        className="text-muted-foreground hover:text-red-600 flex-shrink-0"
                                                        title="Remove"
                                                      >
                                                        <Trash2 className="h-2.5 w-2.5" />
                                                      </button>
                                                    )}
                                                  </div>

                                                  {/* Expanded: show component list and action links */}
                                                  {isExpanded && (
                                                    <div className="px-6 py-1.5 bg-muted/20 space-y-0.5">
                                                      {dimData.components.length === 0 ? (
                                                        <p className="text-muted-foreground italic">No components yet</p>
                                                      ) : (
                                                        [...new Set(dimData.components)].map((comp) => {
                                                          const colorStyles = getComponentWaffleStyles(comp, dimData.componentColors);
                                                          return (
                                                            <div key={comp} className="flex items-center gap-1.5">
                                                              <div
                                                                className={cn("w-2.5 h-2.5 rounded-sm flex-shrink-0", colorStyles.classes)}
                                                                style={colorStyles.style || undefined}
                                                              />
                                                              <span className="truncate">{comp}</span>
                                                            </div>
                                                          );
                                                        })
                                                      )}
                                                      <div className="flex gap-3 pt-1.5 border-t mt-1.5">
                                                        <button
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            openPromptEditor(conversation.id, dimName);
                                                          }}
                                                          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                                        >
                                                          Edit prompt
                                                        </button>
                                                        <button
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            openComponentsEditor(conversation.id, dimName);
                                                          }}
                                                          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                                        >
                                                          Edit components
                                                        </button>
                                                      </div>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}

                                            {/* Show "default" placeholder when no dimensions yet */}
                                            {dimNames.length === 0 && (
                                              <div className="border-t px-2 py-1 text-muted-foreground italic">
                                                default (active)
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </>
                                  )}
                                  {/* Edit prompt link - show below "Assign colors" step */}
                                  {isColoringStep && (
                                    <div className="flex gap-2 ml-5 mt-0.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openColoringPromptEditor(conversation.id);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        Edit prompt
                                      </button>
                                    </div>
                                  )}
                                  {/* Edit prompt link - show below "Generate analysis" step */}
                                  {isAnalysisStep && (
                                    <div className="flex gap-2 ml-5 mt-0.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openAnalysisPromptEditor(conversation.id);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        Edit prompt
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    {/* Action buttons at bottom of card */}
                    {conversation.status === "success" && !conversation.step && (
                      <div className="px-3 pb-2 pt-1 border-t flex items-center gap-3">
                        {!isGroupEntry(conversation.id) &&
                          conversations.filter(
                            (c) =>
                              c.id !== conversation.id &&
                              c.status === "success" &&
                              !isGroupEntry(c.id) &&
                              !c.step,
                          ).length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                useConversationStore.getState().handleApplyPromptsToAll(conversation.id);
                              }}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600"
                            >
                              <Layers className="h-3 w-3" />
                              <span>Apply prompts to all</span>
                            </button>
                          )}
                        {!isGroupEntry(conversation.id) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              exportPromptsAsPresetAction(conversation.id);
                            }}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600"
                          >
                            <Download className="h-3 w-3" />
                            <span>Export preset</span>
                          </button>
                        )}
                        {canDelete(conversation.id) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteConversation(conversation.id);
                            }}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Drop zone overlay hint */}
          {isDragActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10 rounded-md pointer-events-none">
              <div className="bg-background/95 border-2 border-primary rounded-lg p-6 shadow-lg">
                <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium text-primary">
                  Drop files to add
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Drop indicator - below the list */}
        {!isDragActive && (
          <div className="px-4 py-3 border-t border-dashed">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Upload className="h-3 w-3" />
              <span>Drop files here to add more</span>
            </div>
          </div>
        )}
      </div>

      {/* API Key Input */}
      <ApiKeyInput
        onApiKeyChange={(hasKey) => useUIStore.getState().setHasApiKeyState(hasKey)}
        pausedWorkflowCount={pausedWorkflowCount}
        onResumeWorkflows={() => useConversationStore.getState().handleResumeWorkflowsWithApiKey()}
      />

      {/* Workflow Detail Modal */}
      {expandedConversationId &&
        (() => {
          const expandedConversation = conversations.find(
            (c) => c.id === expandedConversationId,
          );
          // For groups, build a minimal WorkflowState from group metadata
          const expandedGroup = groups[expandedConversationId];
          const displayConv: WorkflowState | undefined = expandedConversation || (expandedGroup ? {
            id: expandedGroup.id,
            filename: expandedGroup.name,
            title: expandedGroup.title,
            status: "success" as const,
          } : undefined);
          if (!displayConv) return null;
          return (
            <WorkflowDetailModal
              isOpen={true}
              onClose={() => setExpandedConversationId(null)}
              conversationId={displayConv.id}
            />
          );
        })()}
    </div>
  );
}

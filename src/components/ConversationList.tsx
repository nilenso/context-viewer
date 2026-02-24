import { useState } from "react";
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
} from "lucide-react";
import { ApiKeyInput } from "./ApiKeyInput";
import { WorkflowDetailModal } from "./WorkflowDetailModal";
import { cn } from "@/lib/utils";
import {
  createFileValidator,
  SUPPORTED_EXTENSIONS_TEXT,
} from "@/lib/file-formats";

type ConversationStatus = "pending" | "processing" | "success" | "failed" | "paused-for-api-key";
type ProcessingStep =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "summary"
  | "finding-components"
  | "coloring"
  | "analysis";

/**
 * Represents the persisted state of a workflow execution.
 * Minimal subset needed for the conversation list display.
 */
interface WorkflowState {
  id: string;
  filename: string;
  title?: string; // Custom title, displays instead of filename when set
  status?: ConversationStatus;
  step?: ProcessingStep;
  summary?: {
    totalMessages: number;
  };
  aiSummary?: string;
  error?: string;
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep, number>>;
  pausedAtStep?: ProcessingStep;
  // Grouped conversation data
  isGrouped?: boolean;
  sourceConversations?: Array<{ id: string; filename: string; title?: string }>;
}

interface ConversationListProps {
  conversations: WorkflowState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelection: (id: string, isSelected: boolean) => void;
  onGroupConversations: () => void;
  onClearSelection: () => void;
  onSelectAll: (ids: string[]) => void;
  onUngroupConversation: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onRename?: (id: string, newTitle: string) => void;
  onGenerateAnalysis?: (id: string) => void;
  onGenerateSummary?: (id: string) => void;
  onFilesSelected: (files: File[]) => void;
  onEditPrompt?: (id: string) => void;
  onEditComponents?: (id: string) => void;
  onEditSegmentationPrompt?: (id: string) => void;
  onEditSummaryPrompt?: (id: string) => void;
  onEditAnalysisPrompt?: (id: string) => void;
  onEditColoringPrompt?: (id: string) => void;
  onExportSession?: () => void;
  onUpdateGroupSources?: (groupId: string, newSources: Array<{ id: string; filename: string; title?: string }>) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  pausedWorkflowCount?: number;
  onApiKeyChange?: (hasKey: boolean) => void;
  onResumeWorkflows?: () => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  selectedIds,
  onToggleSelection,
  onGroupConversations,
  onClearSelection,
  onSelectAll,
  onUngroupConversation,
  onDeleteConversation,
  onRename,
  onGenerateAnalysis,
  onGenerateSummary,
  onFilesSelected,
  onEditPrompt,
  onEditComponents,
  onEditSegmentationPrompt,
  onEditSummaryPrompt,
  onEditAnalysisPrompt,
  onEditColoringPrompt,
  onExportSession,
  onUpdateGroupSources,
  isCollapsed = false,
  onToggleCollapse,
  pausedWorkflowCount = 0,
  onApiKeyChange,
  onResumeWorkflows,
}: ConversationListProps) {
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

  // Count of selectable conversations (non-grouped, success status)
  const selectableConversations = conversations.filter(
    (c) => !c.isGrouped && c.status === "success",
  );
  const canGroup = selectedIds.size >= 2;

  // Check if a conversation is part of any grouped conversation
  const isPartOfGroup = (id: string): boolean => {
    return conversations.some(
      (c) => c.isGrouped && c.sourceConversations?.some((s) => s.id === id),
    );
  };

  // Check if a conversation can be deleted (not grouped and not part of any group)
  const canDelete = (conversation: WorkflowState): boolean => {
    return !conversation.isGrouped && !isPartOfGroup(conversation.id);
  };

  // Save title and exit editing mode
  const handleSaveTitle = (id: string) => {
    if (onRename) {
      onRename(id, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle("");
  };

  // Exit selection mode when selection is cleared
  const handleExitSelectionMode = () => {
    setIsSelectionMode(false);
    onClearSelection();
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onFilesSelected,
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
        currentStepIndex >= stepIndex
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
            onClick={onToggleCollapse}
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
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="h-8 w-8 p-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
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
          {onExportSession && selectableConversations.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onExportSession}
              className="h-8 w-8 p-0"
              title="Export session"
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="h-8 w-8 p-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
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
                onSelectAll(selectableConversations.map((c) => c.id));
              } else {
                onClearSelection();
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
              onGroupConversations();
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
              {conversations.map((conversation) => {
                const isProcessing =
                  conversation.status === "processing" ||
                  (conversation.status === "success" && conversation.step);
                const isExpanded = !collapsedProgress.has(conversation.id);
                const isSelectable =
                  !conversation.isGrouped && conversation.status === "success";
                const isSelected = selectedIds.has(conversation.id);

                return (
                  <div
                    key={conversation.id}
                    onClick={() => {
                      if (isSelectionMode && isSelectable) {
                        onToggleSelection(conversation.id, !isSelected);
                      } else {
                        onSelect(conversation.id);
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
                      conversation.isGrouped &&
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
                          onToggleSelection(conversation.id, !isSelected);
                        } else {
                          onSelect(conversation.id);
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
                                onToggleSelection(conversation.id, !!checked);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0"
                            />
                          )}
                          {/* Grouped icon */}
                          {conversation.isGrouped && (
                            <Layers className="h-4 w-4 shrink-0 text-purple-600" />
                          )}
                          {/* Status icons for non-grouped */}
                          {!conversation.isGrouped &&
                            conversation.status === "pending" && (
                              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                          {!conversation.isGrouped && isProcessing && (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                          )}
                          {!conversation.isGrouped &&
                            conversation.status === "success" &&
                            !conversation.step &&
                            !conversation.warnings && (
                              <FileText className="h-4 w-4 shrink-0" />
                            )}
                          {!conversation.isGrouped &&
                            conversation.status === "success" &&
                            !conversation.step &&
                            conversation.warnings && (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
                            )}
                          {!conversation.isGrouped &&
                            conversation.status === "failed" && (
                              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                            )}
                          {!conversation.isGrouped &&
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
                                if (onRename) {
                                  e.stopPropagation();
                                  setEditingId(conversation.id);
                                  setEditingTitle(conversation.title || (conversation.isGrouped ? "" : conversation.filename));
                                }
                              }}
                            >
                              {conversation.isGrouped
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
                          {conversation.isGrouped &&
                            conversation.status === "success" &&
                            !conversation.step && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUngroupConversation(conversation.id);
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
                        {conversation.isGrouped &&
                          conversation.sourceConversations && (
                            <div
                              className="text-xs text-purple-600 pl-6 truncate"
                              title={conversation.sourceConversations
                                .map((s) => s.title || s.filename)
                                .join(", ")}
                            >
                              {conversation.sourceConversations
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

                          {conversation.isGrouped &&
                            conversation.sourceConversations && (
                              <Badge
                                variant="outline"
                                className="self-start text-xs border-purple-400 text-purple-700 bg-purple-50"
                              >
                                {conversation.sourceConversations.length} files
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
                                timing === undefined &&
                                onGenerateSummary;
                              // Analysis step is clickable when conversation is complete but analysis wasn't run
                              const isAnalysisClickable =
                                isAnalysisStep &&
                                conversation.status === "success" &&
                                !conversation.step &&
                                timing === undefined &&
                                onGenerateAnalysis;
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
                                            onGenerateSummary!(conversation.id);
                                          } else {
                                            onGenerateAnalysis!(conversation.id);
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
                                  {isSegmentingStep &&
                                    onEditSegmentationPrompt && (
                                      <div className="flex gap-2 ml-5 mt-0.5">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onEditSegmentationPrompt(conversation.id);
                                          }}
                                          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                        >
                                          Edit prompt
                                        </button>
                                      </div>
                                    )}
                                  {/* Edit prompt link - show below "Generate summary" step */}
                                  {isSummaryStep && onEditSummaryPrompt && (
                                    <div className="flex gap-2 ml-5 mt-0.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onEditSummaryPrompt(conversation.id);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        Edit prompt
                                      </button>
                                    </div>
                                  )}
                                  {/* Edit prompt and Edit components links - show below "Find components" step */}
                                  {isFindComponentsStep &&
                                    (onEditPrompt || onEditComponents) && (
                                      <div className="flex gap-2 ml-5 mt-0.5">
                                        {onEditPrompt && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onEditPrompt(conversation.id);
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                          >
                                            Edit prompt
                                          </button>
                                        )}
                                        {onEditComponents && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onEditComponents(conversation.id);
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                          >
                                            Edit components
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  {/* Edit prompt link - show below "Assign colors" step */}
                                  {isColoringStep && onEditColoringPrompt && (
                                    <div className="flex gap-2 ml-5 mt-0.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onEditColoringPrompt(conversation.id);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        Edit prompt
                                      </button>
                                    </div>
                                  )}
                                  {/* Edit prompt link - show below "Generate analysis" step */}
                                  {isAnalysisStep && onEditAnalysisPrompt && (
                                    <div className="flex gap-2 ml-5 mt-0.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onEditAnalysisPrompt(conversation.id);
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

                    {/* Delete button at bottom of card */}
                    {onDeleteConversation && canDelete(conversation) && (
                      <div className="px-3 pb-2 pt-1 border-t">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(conversation.id);
                          }}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Remove</span>
                        </button>
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
      {onApiKeyChange && onResumeWorkflows && (
        <ApiKeyInput
          onApiKeyChange={onApiKeyChange}
          pausedWorkflowCount={pausedWorkflowCount}
          onResumeWorkflows={onResumeWorkflows}
        />
      )}

      {/* Workflow Detail Modal */}
      {expandedConversationId &&
        (() => {
          const expandedConversation = conversations.find(
            (c) => c.id === expandedConversationId,
          );
          if (!expandedConversation) return null;
          return (
            <WorkflowDetailModal
              isOpen={true}
              onClose={() => setExpandedConversationId(null)}
              conversationId={expandedConversation.id}
              filename={expandedConversation.filename}
              title={expandedConversation.title}
              status={expandedConversation.status}
              currentStep={expandedConversation.step}
              stepTimings={expandedConversation.stepTimings}
              aiSummary={expandedConversation.aiSummary}
              warnings={expandedConversation.warnings}
              onEditPrompt={onEditPrompt}
              onEditComponents={onEditComponents}
              onEditSegmentationPrompt={onEditSegmentationPrompt}
              onEditSummaryPrompt={onEditSummaryPrompt}
              onEditAnalysisPrompt={onEditAnalysisPrompt}
              onEditColoringPrompt={onEditColoringPrompt}
              onGenerateAnalysis={onGenerateAnalysis}
              onGenerateSummary={onGenerateSummary}
              isGrouped={expandedConversation.isGrouped}
              sourceConversations={expandedConversation.sourceConversations}
              onUpdateGroupSources={
                onUpdateGroupSources
                  ? (newSources) => onUpdateGroupSources(expandedConversation.id, newSources)
                  : undefined
              }
            />
          );
        })()}
    </div>
  );
}

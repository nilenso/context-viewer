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
} from "lucide-react";
import { cn } from "@/lib/utils";

type ConversationStatus = "pending" | "processing" | "success" | "failed";
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
  status?: ConversationStatus;
  step?: ProcessingStep;
  summary?: {
    totalMessages: number;
  };
  aiSummary?: string;
  error?: string;
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep, number>>;
  // Grouped conversation data
  isGrouped?: boolean;
  sourceConversations?: Array<{ id: string; filename: string }>;
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
  onGenerateAnalysis?: (id: string) => void;
  onFilesSelected: (files: File[]) => void;
  onEditPrompt?: () => void;
  onEditComponents?: () => void;
  onEditSegmentationPrompt?: () => void;
  onEditSummaryPrompt?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
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
  onGenerateAnalysis,
  onFilesSelected,
  onEditPrompt,
  onEditComponents,
  onEditSegmentationPrompt,
  onEditSummaryPrompt,
  isCollapsed = false,
  onToggleCollapse,
}: ConversationListProps) {
  // Initialize with all conversations expanded by default
  const [collapsedProgress, setCollapsedProgress] = useState<Set<string>>(
    new Set(),
  );
  // Selection mode - when true, show checkboxes
  const [isSelectionMode, setIsSelectionMode] = useState(false);

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

  // Exit selection mode when selection is cleared
  const handleExitSelectionMode = () => {
    setIsSelectionMode(false);
    onClearSelection();
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onFilesSelected,
    validator: (file) => {
      const acceptedExtensions = [".json", ".jsonl", ".txt"];
      const ext = file.name
        ? "." + (file.name.split(".").pop()?.toLowerCase() || "")
        : "";
      if (!acceptedExtensions.includes(ext)) {
        return {
          code: "file-invalid-type",
          message: `File type not supported. Accepted: ${acceptedExtensions.join(", ")}`,
        };
      }
      return null;
    },
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
  ): "pending" | "in-progress" | "completed" => {
    if (conversation.status === "failed") return "pending";
    if (conversation.status === "pending") return "pending";

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
              Accepts .json, .jsonl, and .txt files
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
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-start text-left h-auto py-3 px-3",
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
                          <span
                            className="font-medium text-sm truncate flex-1 min-w-0"
                            title={conversation.filename}
                          >
                            {conversation.isGrouped
                              ? "Grouped"
                              : conversation.filename}
                          </span>
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
                            conversation.status === "success") && (
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
                                .map((s) => s.filename)
                                .join(", ")}
                            >
                              {conversation.sourceConversations
                                .map((s) => s.filename)
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
                    </Button>

                    {/* Progress Checklist */}
                    {isExpanded &&
                      (isProcessing || conversation.status === "success") && (
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
                              // Analysis step is clickable when conversation is complete but analysis wasn't run
                              const isAnalysisClickable =
                                isAnalysisStep &&
                                conversation.status === "success" &&
                                !conversation.step &&
                                timing === undefined &&
                                onGenerateAnalysis;
                              return (
                                <div key={step.key}>
                                  <div className="flex items-center gap-2 text-xs">
                                    {status === "completed" &&
                                      !isAnalysisClickable && (
                                        <Check className="h-3 w-3 text-green-600" />
                                      )}
                                    {status === "in-progress" && (
                                      <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                                    )}
                                    {status === "pending" &&
                                      !isAnalysisClickable && (
                                        <Circle className="h-3 w-3 text-gray-300" />
                                      )}
                                    {isAnalysisClickable && (
                                      <Play className="h-3 w-3 text-blue-600" />
                                    )}
                                    {isAnalysisClickable ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onGenerateAnalysis(conversation.id);
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
                                            onEditSegmentationPrompt();
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
                                          onEditSummaryPrompt();
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
                                              onEditPrompt();
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
                                              onEditComponents();
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                          >
                                            Edit components
                                          </button>
                                        )}
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
    </div>
  );
}

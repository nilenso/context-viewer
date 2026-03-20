import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Badge } from "@/ui/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/ui/components/ui/collapsible";
import {
  Check,
  ChevronRight,
  ChevronDown,
  Circle,
  Clock,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Play,
  ListOrdered,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/ui/lib/utils";
import type { DimensionData, StageGroup } from "@/model/types";
import { getComponentWaffleStyles } from "@/ui/lib/component-colors";
import { GroupFileOrderEditor } from "./GroupFileOrderEditor";
import {
  type ConversationLogs,
  type LogEntry,
  type StepTiming,
  getConversationLogs,
  subscribeToLogs,
  formatDuration,
  formatTimestamp,
} from "@/pipeline/logging";
import { useConversationStore } from "@/stores/conversation-store";
import {
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
  updateGroupSources,
} from "@/stores/actions";

interface StepInfo {
  key: StageGroup;
  label: string;
  description: string;
}

const processingSteps: StepInfo[] = [
  {
    key: "parsing",
    label: "Parse conversation",
    description: "Parse the input file and extract conversation structure",
  },
  {
    key: "counting-tokens",
    label: "Count tokens",
    description: "Count tokens for each message and part",
  },
  {
    key: "segmenting",
    label: "Segment content",
    description: "Split large text parts into smaller segments using AI",
  },
  {
    key: "summarizing",
    label: "Generate summary",
    description: "Generate an AI summary of the conversation",
  },
  {
    key: "finding-components",
    label: "Find components",
    description: "Identify semantic components in the conversation using AI",
  },
  {
    key: "coloring",
    label: "Assign colors",
    description: "Assign colors to identified components",
  },
  {
    key: "analyzing",
    label: "Generate analysis",
    description: "Generate detailed context analysis using AI",
  },
];

interface WorkflowDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
}

export function WorkflowDetailModal({
  isOpen,
  onClose,
  conversationId,
}: WorkflowDetailModalProps) {
  // Read conversation data from store
  const conv = useConversationStore((s) => s.conversations.find((c) => c.id === conversationId));
  const group = useConversationStore((s) => s.groups[conversationId]);
  const conversations = useConversationStore((s) => s.conversations);

  // For groups, derive display state from first member file
  const firstMember = group
    ? conversations.find((c) => group.fileIds.includes(c.id) && c.conversation)
    : undefined;

  const filename = conv?.filename ?? group?.name ?? conversationId;
  const title = conv?.title ?? group?.title;
  const status = conv?.status ?? (group && firstMember ? firstMember.status : undefined);
  const currentStep = conv?.step;
  const stepTimings = conv?.stepTimings ?? firstMember?.stepTimings;
  const aiSummary = conv?.aiSummary ?? group?.aiSummary;
  const warnings = conv?.warnings;
  const dimensions = conv?.dimensions ?? firstMember?.dimensions;
  const isGrouped = !!group;
  const memberFiles = group
    ? group.fileIds.flatMap((fid) => {
        const c = conversations.find((cv) => cv.id === fid);
        return c ? [{ id: c.id, filename: c.filename, title: c.title }] : [];
      })
    : undefined;
  const [logs, setLogs] = useState<ConversationLogs | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<StageGroup>>(
    new Set(),
  );
  // Dimension accordion state
  const [expandedDimension, setExpandedDimension] = useState<string | null>(null);
  const [addingDimension, setAddingDimension] = useState(false);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [renamingDimension, setRenamingDimension] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Subscribe to log updates
  useEffect(() => {
    if (!conversationId) return;

    // Get initial logs
    setLogs(getConversationLogs(conversationId));

    // Subscribe to updates
    const unsubscribe = subscribeToLogs((id, newLogs) => {
      if (id === conversationId) {
        setLogs({ ...newLogs });
      }
    });

    return unsubscribe;
  }, [conversationId]);

  const toggleStep = (step: StageGroup) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  };

  const getStepStatus = (
    stepKey: StageGroup,
  ): "pending" | "in-progress" | "completed" | "not-run" => {
    if (status === "failed") return "pending";
    if (status === "pending") return "pending";

    const stepIndex = processingSteps.findIndex((s) => s.key === stepKey);
    const currentStepIndex = processingSteps.findIndex(
      (s) => s.key === currentStep,
    );

    // Special handling for summary step - check if aiSummary exists
    if (stepKey === "summarizing") {
      if (aiSummary && aiSummary.length > 0) {
        return "completed";
      }
      if (status === "processing" && currentStep === "summarizing") {
        return "in-progress";
      }
      return "pending";
    }

    // If all steps completed (no current step and success)
    if (currentStepIndex === -1 && status === "success") {
      // Check if step was actually run (has timing or is before analysis)
      if (stepTimings?.[stepKey] !== undefined) {
        return "completed";
      }
      // Analysis is optional - if no timing, it wasn't run
      if (stepKey === "analyzing") {
        return "not-run";
      }
      return "completed";
    }

    if (stepIndex < currentStepIndex) return "completed";
    if (stepIndex === currentStepIndex) return "in-progress";
    return "pending";
  };

  const getStepTiming = (stepKey: StageGroup): StepTiming | undefined => {
    return logs?.stepTimings[stepKey as keyof typeof logs.stepTimings];
  };

  const getLogsForStep = (stepKey: StageGroup): LogEntry[] => {
    if (!logs) return [];
    return logs.entries.filter((entry) => entry.phase === stepKey);
  };

  const getStatusIcon = (
    stepStatus: "pending" | "in-progress" | "completed" | "not-run",
    stepKey: StageGroup,
  ) => {
    const isSummaryClickable =
      stepKey === "summarizing" &&
      status === "success" &&
      !currentStep &&
      stepTimings?.summarizing === undefined &&
      true;

    const isAnalysisClickable =
      stepKey === "analyzing" &&
      status === "success" &&
      !currentStep &&
      stepTimings?.analyzing === undefined;

    if (isSummaryClickable || isAnalysisClickable) {
      return <Play className="h-4 w-4 text-blue-600" />;
    }

    switch (stepStatus) {
      case "completed":
        return <Check className="h-4 w-4 text-green-600" />;
      case "in-progress":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
      case "not-run":
        return <Circle className="h-4 w-4 text-gray-300" />;
      default:
        return <Circle className="h-4 w-4 text-gray-300" />;
    }
  };

  const formatTime = (date: Date): string => {
    return formatTimestamp(date);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{title || filename}</span>
            {status === "processing" && (
              <Badge variant="secondary" className="shrink-0">
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Processing
              </Badge>
            )}
            {status === "success" && !currentStep && (
              <Badge
                variant="secondary"
                className="shrink-0 bg-green-100 text-green-700"
              >
                <Check className="h-3 w-3 mr-1" />
                Complete
              </Badge>
            )}
            {status === "failed" && (
              <Badge variant="destructive" className="shrink-0">
                <AlertCircle className="h-3 w-3 mr-1" />
                Failed
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {warnings && warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
            <div className="flex items-center gap-2 text-yellow-700 text-sm font-medium mb-1">
              <AlertTriangle className="h-4 w-4" />
              Warnings ({warnings.length})
            </div>
            <ul className="text-xs text-yellow-600 space-y-1 ml-6">
              {warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div className="space-y-2 pb-4">
            {processingSteps.map((step) => {
              const stepStatus = getStepStatus(step.key);
              const timing = getStepTiming(step.key);
              const stepLogs = getLogsForStep(step.key);
              const isExpanded = expandedSteps.has(step.key);
              const legacyTiming = stepTimings?.[step.key];

              const isSummaryClickable =
                step.key === "summarizing" &&
                status === "success" &&
                !currentStep &&
                stepTimings?.summarizing === undefined;

              const isAnalysisClickable =
                step.key === "analyzing" &&
                status === "success" &&
                !currentStep &&
                stepTimings?.analyzing === undefined;

              const isClickable = isSummaryClickable || isAnalysisClickable;

              const isFindComponentsStep = step.key === "finding-components";
              const isSegmentingStep = step.key === "segmenting";
              const isSummaryStep = step.key === "summarizing";
              const isColoringStep = step.key === "coloring";
              const isAnalysisStep = step.key === "analyzing";

              return (
                <Collapsible
                  key={step.key}
                  open={isExpanded}
                  onOpenChange={() => toggleStep(step.key)}
                >
                  <div
                    className={cn(
                      "border rounded-lg",
                      stepStatus === "completed" &&
                        "border-green-200 bg-green-50/50",
                      stepStatus === "in-progress" &&
                        "border-blue-200 bg-blue-50/50",
                      stepStatus === "not-run" &&
                        "border-gray-200 bg-gray-50/50",
                      stepStatus === "pending" && "border-gray-200",
                    )}
                  >
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center gap-3 p-3">
                        {getStatusIcon(stepStatus, step.key)}
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            {isClickable ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isSummaryClickable) {
                                    generateSummary(conversationId, undefined);
                                  } else {
                                    generateAnalysis(conversationId, undefined);
                                  }
                                }}
                                className="font-medium text-sm text-blue-600 hover:text-blue-700 hover:underline"
                              >
                                {step.label}
                              </button>
                            ) : (
                              <span
                                className={cn(
                                  "font-medium text-sm",
                                  stepStatus === "completed" &&
                                    "text-green-700",
                                  stepStatus === "in-progress" &&
                                    "text-blue-700",
                                  stepStatus === "not-run" && "text-gray-400",
                                  stepStatus === "pending" && "text-gray-500",
                                )}
                              >
                                {step.label}
                              </span>
                            )}

                            {/* Edit prompt links in accordion header */}
                            {isSegmentingStep && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSegmentationPromptEditor(conversationId);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline ml-2"
                              >
                                Edit prompt
                              </button>
                            )}
                            {isSummaryStep && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSummaryPromptEditor(conversationId);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline ml-2"
                              >
                                Edit prompt
                              </button>
                            )}
                            {/* Edit prompt/components buttons are per-dimension in the accordion below */}
                            {isColoringStep && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openColoringPromptEditor(conversationId);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline ml-2"
                              >
                                Edit prompt
                              </button>
                            )}
                            {isAnalysisStep && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAnalysisPromptEditor(conversationId);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline ml-2"
                              >
                                Edit prompt
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {step.description}
                          </p>
                        </div>

                        {/* Timing display */}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {timing?.startTime && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTime(timing.startTime)}
                            </span>
                          )}
                          {timing?.durationMs !== undefined && (
                            <Badge variant="outline" className="text-xs">
                              {formatDuration(timing.durationMs)}
                            </Badge>
                          )}
                          {/* Fallback to legacy timing if available */}
                          {!timing?.durationMs &&
                            legacyTiming !== undefined && (
                              <Badge variant="outline" className="text-xs">
                                {legacyTiming}s
                              </Badge>
                            )}
                        </div>

                        <ChevronRight
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            isExpanded && "rotate-90",
                          )}
                        />
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="border-t px-3 py-2 bg-muted/30">
                        {/* Dimension Accordion - show inside Find components step */}
                        {isFindComponentsStep && (() => {
                          const dims = dimensions;
                          const dimNames = dims ? Object.keys(dims) : [];
                          if (dimNames.length === 0) return null;
                          return (
                            <div className="mb-3 border rounded text-xs">
                              <div className="px-2 py-1.5 bg-muted/50 flex items-center justify-between">
                                <span className="font-medium text-muted-foreground uppercase tracking-wide" style={{ fontSize: "10px" }}>
                                  Dimensions ({dimNames.length || 1})
                                </span>
                                {(
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAddingDimension(true);
                                    }}
                                    className="text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
                                  >
                                    <Plus className="h-3 w-3" /> Add
                                  </button>
                                )}
                              </div>

                              {/* Add dimension input */}
                              {addingDimension && (
                                <div className="px-2 py-1.5 border-t flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={newDimensionName}
                                    onChange={(e) => setNewDimensionName(e.target.value)}
                                    placeholder="Dimension name..."
                                    className="flex-1 border rounded px-1.5 py-0.5 text-xs"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === "Enter" && newDimensionName.trim()) {
                                        addDimension(conversationId, newDimensionName.trim());
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
                                      if (newDimensionName.trim()) addDimension(conversationId, newDimensionName.trim());
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
                                const isDimExpanded = expandedDimension === dimName;
                                return (
                                  <div key={dimName} className="border-t">
                                    <div
                                      className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-muted/30 cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedDimension(isDimExpanded ? null : dimName);
                                      }}
                                    >
                                      {isDimExpanded ? (
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
                                              renameDimension(conversationId, dimName, renameValue.trim());
                                              setRenamingDimension(null);
                                            }
                                            if (e.key === "Escape") setRenamingDimension(null);
                                          }}
                                          onBlur={() => {
                                            if (renameValue.trim() && renameValue.trim() !== dimName) {
                                              renameDimension(conversationId, dimName, renameValue.trim());
                                            }
                                            setRenamingDimension(null);
                                          }}
                                        />
                                      ) : (
                                        <span className="flex-1 font-medium truncate">{dimName}</span>
                                      )}

                                      <span className="text-muted-foreground flex-shrink-0">
                                        {new Set(dimData.discoveredComponents).size} components
                                      </span>

                                      {(
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openPromptEditor(conversationId, dimName);
                                          }}
                                          className="text-muted-foreground hover:text-blue-600 flex-shrink-0"
                                          title="Edit prompt"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                      )}
                                      {(
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openComponentsEditor(conversationId, dimName);
                                          }}
                                          className="text-muted-foreground hover:text-blue-600 flex-shrink-0"
                                          title="Edit components"
                                        >
                                          <ListOrdered className="h-3 w-3" />
                                        </button>
                                      )}
                                      {(
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setRenamingDimension(dimName);
                                            setRenameValue(dimName);
                                          }}
                                          className="text-muted-foreground hover:text-foreground flex-shrink-0"
                                          title="Rename"
                                          style={{ fontSize: "10px" }}
                                        >
                                          Aa
                                        </button>
                                      )}
                                      {dimName !== "default" && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeDimension(conversationId, dimName);
                                          }}
                                          className="text-muted-foreground hover:text-red-600 flex-shrink-0"
                                          title="Remove"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>

                                    {/* Expanded: show component list and action links */}
                                    {isDimExpanded && (
                                      <div className="px-7 py-1.5 bg-muted/20 space-y-0.5">
                                        {dimData.discoveredComponents.length === 0 ? (
                                          <p className="text-muted-foreground italic">No components yet. Edit the prompt to run component identification.</p>
                                        ) : (
                                          [...new Set(dimData.discoveredComponents)].map((comp) => {
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
                                            onClick={() => openPromptEditor(conversationId, dimName)}
                                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                          >
                                            Edit prompt
                                          </button>
                                          <button
                                            onClick={() => openComponentsEditor(conversationId, dimName)}
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

                              {/* Placeholder when no dimensions */}
                              {dimNames.length === 0 && (
                                <div className="border-t px-2 py-1.5 text-muted-foreground italic">
                                  default (active)
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Step timing details */}
                        {(timing?.startTime || timing?.endTime) && (
                          <div className="mb-2 text-xs text-muted-foreground space-y-1">
                            {timing.startTime && (
                              <div>
                                Started: {timing.startTime.toLocaleString()}
                              </div>
                            )}
                            {timing.endTime && (
                              <div>
                                Ended: {timing.endTime.toLocaleString()}
                              </div>
                            )}
                            {timing.durationMs !== undefined && (
                              <div>
                                Duration: {formatDuration(timing.durationMs)}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Logs for this step */}
                        {stepLogs.length > 0 ? (
                          <div className="space-y-1 font-mono text-xs max-h-80 overflow-y-auto">
                            {stepLogs.map((log, index) => (
                              <div
                                key={index}
                                className={cn(
                                  "py-0.5",
                                  log.level === "error" && "text-red-600",
                                  log.level === "warn" && "text-yellow-600",
                                  log.level === "debug" && "text-gray-400",
                                )}
                              >
                                <span className="text-muted-foreground">
                                  {formatTimestamp(log.timestamp)}
                                </span>{" "}
                                <span className="break-words">
                                  {log.message}
                                </span>
                                {log.data !== undefined && (
                                  <span className="text-muted-foreground break-words">
                                    {" "}
                                    {typeof log.data === "object"
                                      ? JSON.stringify(log.data)
                                      : String(log.data)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground italic py-2">
                            {stepStatus === "pending" ||
                            stepStatus === "not-run"
                              ? "Step not yet started"
                              : stepStatus === "in-progress"
                                ? "Processing..."
                                : "No detailed logs available"}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}

            {isGrouped && memberFiles && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ListOrdered className="h-4 w-4" />
                  File Order
                </div>
                <GroupFileOrderEditor
                  memberFiles={memberFiles}
                  onApply={(newSources) => updateGroupSources(conversationId, newSources)}
                />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

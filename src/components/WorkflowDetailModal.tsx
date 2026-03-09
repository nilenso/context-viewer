import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { cn } from "@/lib/utils";
import type { DimensionData } from "@/componentisation";
import { getComponentWaffleStyles } from "@/lib/component-colors";
import { GroupFileOrderEditor } from "./GroupFileOrderEditor";
import {
  type ProcessingPhase,
  type ConversationLogs,
  type LogEntry,
  type StepTiming,
  getConversationLogs,
  subscribeToLogs,
  formatDuration,
  formatTimestamp,
} from "@/workflow-logger";

type ProcessingStep =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "summary"
  | "finding-components"
  | "coloring"
  | "analysis";

interface StepInfo {
  key: ProcessingStep;
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
    key: "summary",
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
    key: "analysis",
    label: "Generate analysis",
    description: "Generate detailed context analysis using AI",
  },
];

interface WorkflowDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  filename: string;
  title?: string;
  status?: "pending" | "processing" | "success" | "failed" | "paused-for-api-key";
  currentStep?: ProcessingStep;
  stepTimings?: Partial<Record<ProcessingStep, number>>;
  aiSummary?: string;
  warnings?: string[];
  onEditPrompt?: (id: string) => void;
  onEditComponents?: (id: string) => void;
  onEditSegmentationPrompt?: (id: string) => void;
  onEditSummaryPrompt?: (id: string) => void;
  onEditAnalysisPrompt?: (id: string) => void;
  onEditColoringPrompt?: (id: string) => void;
  onGenerateAnalysis?: (id: string) => void;
  onGenerateSummary?: (id: string) => void;
  // Dimension management
  dimensions?: Record<string, DimensionData>;
  onAddDimension?: (name: string) => void;
  onRemoveDimension?: (name: string) => void;
  onRenameDimension?: (oldName: string, newName: string) => void;
  onEditDimensionPrompt?: (id: string, dimensionName: string) => void;
  // Grouped conversation support
  isGrouped?: boolean;
  sourceConversations?: Array<{ id: string; filename: string; title?: string }>;
  onUpdateGroupSources?: (newSources: Array<{ id: string; filename: string; title?: string }>) => void;
}

export function WorkflowDetailModal({
  isOpen,
  onClose,
  conversationId,
  filename,
  title,
  status,
  currentStep,
  stepTimings,
  aiSummary,
  warnings,
  onEditPrompt,
  onEditComponents,
  onEditSegmentationPrompt,
  onEditSummaryPrompt,
  onEditAnalysisPrompt,
  onEditColoringPrompt,
  onGenerateAnalysis,
  onGenerateSummary,
  dimensions,
  onAddDimension,
  onRemoveDimension,
  onRenameDimension,
  onEditDimensionPrompt,
  isGrouped,
  sourceConversations,
  onUpdateGroupSources,
}: WorkflowDetailModalProps) {
  const [logs, setLogs] = useState<ConversationLogs | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<ProcessingStep>>(
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

  const toggleStep = (step: ProcessingStep) => {
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
    stepKey: ProcessingStep,
  ): "pending" | "in-progress" | "completed" | "not-run" => {
    if (status === "failed") return "pending";
    if (status === "pending") return "pending";

    const stepIndex = processingSteps.findIndex((s) => s.key === stepKey);
    const currentStepIndex = processingSteps.findIndex(
      (s) => s.key === currentStep,
    );

    // Special handling for summary step - check if aiSummary exists
    if (stepKey === "summary") {
      if (aiSummary && aiSummary.length > 0) {
        return "completed";
      }
      if (status === "processing" && currentStep === "summary") {
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
      if (stepKey === "analysis") {
        return "not-run";
      }
      return "completed";
    }

    if (stepIndex < currentStepIndex) return "completed";
    if (stepIndex === currentStepIndex) return "in-progress";
    return "pending";
  };

  const getStepTiming = (stepKey: ProcessingStep): StepTiming | undefined => {
    return logs?.stepTimings[stepKey];
  };

  const getLogsForStep = (stepKey: ProcessingStep): LogEntry[] => {
    if (!logs) return [];
    return logs.entries.filter((entry) => entry.phase === stepKey);
  };

  const getStatusIcon = (
    stepStatus: "pending" | "in-progress" | "completed" | "not-run",
    stepKey: ProcessingStep,
  ) => {
    const isSummaryClickable =
      stepKey === "summary" &&
      status === "success" &&
      !currentStep &&
      stepTimings?.summary === undefined &&
      onGenerateSummary;

    const isAnalysisClickable =
      stepKey === "analysis" &&
      status === "success" &&
      !currentStep &&
      stepTimings?.analysis === undefined &&
      onGenerateAnalysis;

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
                step.key === "summary" &&
                status === "success" &&
                !currentStep &&
                stepTimings?.summary === undefined &&
                onGenerateSummary;

              const isAnalysisClickable =
                step.key === "analysis" &&
                status === "success" &&
                !currentStep &&
                stepTimings?.analysis === undefined &&
                onGenerateAnalysis;

              const isClickable = isSummaryClickable || isAnalysisClickable;

              const isFindComponentsStep = step.key === "finding-components";
              const isSegmentingStep = step.key === "segmenting";
              const isSummaryStep = step.key === "summary";
              const isColoringStep = step.key === "coloring";
              const isAnalysisStep = step.key === "analysis";

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
                                    onGenerateSummary!(conversationId);
                                  } else {
                                    onGenerateAnalysis!(conversationId);
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
                            {isSegmentingStep && onEditSegmentationPrompt && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditSegmentationPrompt(conversationId);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline ml-2"
                              >
                                Edit prompt
                              </button>
                            )}
                            {isSummaryStep && onEditSummaryPrompt && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditSummaryPrompt(conversationId);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline ml-2"
                              >
                                Edit prompt
                              </button>
                            )}
                            {isFindComponentsStep && (
                              <div className="flex gap-2 ml-2">
                                {onEditPrompt && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditPrompt(conversationId);
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
                                      onEditComponents(conversationId);
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                  >
                                    Edit components
                                  </button>
                                )}
                              </div>
                            )}
                            {isColoringStep && onEditColoringPrompt && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditColoringPrompt(conversationId);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline ml-2"
                              >
                                Edit prompt
                              </button>
                            )}
                            {isAnalysisStep && onEditAnalysisPrompt && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditAnalysisPrompt(conversationId);
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
                          if (dimNames.length === 0 && !onAddDimension) return null;
                          return (
                            <div className="mb-3 border rounded text-xs">
                              <div className="px-2 py-1.5 bg-muted/50 flex items-center justify-between">
                                <span className="font-medium text-muted-foreground uppercase tracking-wide" style={{ fontSize: "10px" }}>
                                  Dimensions ({dimNames.length || 1})
                                </span>
                                {onAddDimension && (
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
                                        onAddDimension?.(newDimensionName.trim());
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
                                      if (newDimensionName.trim()) onAddDimension?.(newDimensionName.trim());
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
                                              onRenameDimension?.(dimName, renameValue.trim());
                                              setRenamingDimension(null);
                                            }
                                            if (e.key === "Escape") setRenamingDimension(null);
                                          }}
                                          onBlur={() => {
                                            if (renameValue.trim() && renameValue.trim() !== dimName) {
                                              onRenameDimension?.(dimName, renameValue.trim());
                                            }
                                            setRenamingDimension(null);
                                          }}
                                        />
                                      ) : (
                                        <span className="flex-1 font-medium truncate">{dimName}</span>
                                      )}

                                      <span className="text-muted-foreground flex-shrink-0">
                                        {dimData.components.length} components
                                      </span>

                                      {onEditDimensionPrompt && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onEditDimensionPrompt(conversationId, dimName);
                                          }}
                                          className="text-muted-foreground hover:text-blue-600 flex-shrink-0"
                                          title="Edit prompt"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                      )}
                                      {onRenameDimension && (
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
                                      {dimName !== "default" && onRemoveDimension && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveDimension(dimName);
                                          }}
                                          className="text-muted-foreground hover:text-red-600 flex-shrink-0"
                                          title="Remove"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>

                                    {/* Expanded: show component list */}
                                    {isDimExpanded && (
                                      <div className="px-7 py-1.5 bg-muted/20 space-y-0.5">
                                        {dimData.components.length === 0 ? (
                                          <p className="text-muted-foreground italic">No components yet. Edit the prompt to run componentisation.</p>
                                        ) : (
                                          dimData.components.map((comp) => {
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

            {isGrouped && sourceConversations && onUpdateGroupSources && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ListOrdered className="h-4 w-4" />
                  File Order
                </div>
                <GroupFileOrderEditor
                  sourceConversations={sourceConversations}
                  onApply={onUpdateGroupSources}
                />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

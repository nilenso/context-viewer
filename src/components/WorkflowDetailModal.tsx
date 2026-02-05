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
  Circle,
  Clock,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  onEditPrompt?: () => void;
  onEditComponents?: () => void;
  onEditSegmentationPrompt?: () => void;
  onEditSummaryPrompt?: () => void;
  onEditAnalysisPrompt?: () => void;
  onEditColoringPrompt?: () => void;
  onGenerateAnalysis?: (id: string) => void;
  onGenerateSummary?: (id: string) => void;
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
}: WorkflowDetailModalProps) {
  const [logs, setLogs] = useState<ConversationLogs | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<ProcessingStep>>(
    new Set(),
  );

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
      if (status === "processing" && currentStepIndex >= stepIndex) {
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
                                  onEditSegmentationPrompt();
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
                                  onEditSummaryPrompt();
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
                            {isColoringStep && onEditColoringPrompt && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditColoringPrompt();
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
                                  onEditAnalysisPrompt();
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

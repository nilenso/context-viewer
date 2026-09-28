import React, { useEffect, useState } from "react";
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
  Info,
} from "lucide-react";
import { cn } from "@/ui/lib/utils";
import type { DimensionData, WorkflowStageMetric } from "context-analyzer";
import { type StageGroup, isStageRunning, stageToGroup } from "@/lib/stage-groups";
import { getComponentWaffleStyles } from "@/ui/lib/component-colors";
import { GroupFileOrderEditor } from "./GroupFileOrderEditor";
import { DEFAULT_MODEL, getModelLabel } from "@/lib/ai-config";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";
import {
  type ConversationLogs,
  type LogEntry,
  type StepTiming,
  getConversationLogs,
  subscribeToLogs,
  formatDuration,
  formatTimestamp,
} from "@/lib/pipeline-logging";
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
  optional?: boolean;
}

const metricStageLabels: Record<string, string> = {
  parsing: "Parse",
  "counting-tokens": "Tokens",
  segmenting: "Segment",
  "identifying-components": "Topic identification",
  "classifying-components": "Classification",
  coloring: "Colors",
};

function MetricLabel({ label, description }: { label: string; description: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} aria-label={`About ${label}`} className="text-muted-foreground">
            <Info className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{description}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function formatCost(metric: WorkflowStageMetric): string {
  if (metric.missingCostCallCount > 0 && metric.costCallCount === 0) return "Cost unknown";
  const digits = metric.costUsd >= 1 ? 3 : metric.costUsd >= 0.001 ? 4 : 5;
  return `${metric.missingCostCallCount > 0 ? "~" : ""}$${metric.costUsd.toFixed(digits)}`;
}

function combineMetrics(metrics: Array<WorkflowStageMetric | undefined>): WorkflowStageMetric | undefined {
  const available = metrics.filter((metric): metric is WorkflowStageMetric => !!metric);
  if (available.length === 0) return undefined;
  return available.reduce((total, metric) => ({
    wallClockMs: total.wallClockMs + metric.wallClockMs,
    llmTimeMs: (total.llmTimeMs || 0) + (metric.llmTimeMs || 0),
    costUsd: total.costUsd + metric.costUsd,
    costCallCount: total.costCallCount + metric.costCallCount,
    missingCostCallCount: total.missingCostCallCount + metric.missingCostCallCount,
    calls: [...(total.calls || []), ...(metric.calls || [])],
  }), { wallClockMs: 0, llmTimeMs: 0, costUsd: 0, costCallCount: 0, missingCostCallCount: 0, calls: [] });
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
    key: "summarizing",
    label: "Generate summary",
    description: "Generate an AI summary of the conversation",
    optional: true,
  },
  {
    key: "analyzing",
    label: "Generate analysis",
    description: "Generate detailed context analysis using AI",
    optional: true,
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
  const workflowMetrics = group ? undefined : conv?.workflowMetrics;
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

  const getMetric = (step: StageGroup) => {
    if (!workflowMetrics) return undefined;
    if (step === "finding-components") {
      return combineMetrics([
        workflowMetrics.stages["identifying-components"],
        workflowMetrics.stages["classifying-components"],
      ]);
    }
    return workflowMetrics.stages[step];
  };

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
    const mappedStep = stageToGroup(currentStep);
    const currentStepIndex = processingSteps.findIndex(
      (s) => s.key === mappedStep,
    );

    // Special handling for summary step - check if aiSummary exists
    if (stepKey === "summarizing") {
      if (aiSummary && aiSummary.length > 0) {
        return "completed";
      }
      if (status === "processing" && isStageRunning(currentStep, "summarizing")) {
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
    <TooltipProvider>
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

        {workflowMetrics?.latestRun && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">
                  <MetricLabel
                    label="Total execution time"
                    description="Elapsed time from the latest workflow invocation starting until it completed."
                  />
                </div>
                <div className="font-medium">{formatDuration(workflowMetrics.latestRun.wallClockMs)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Cost</div>
                <div className="font-medium">{formatCost(workflowMetrics.latestRun)}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Stages counted: {workflowMetrics.latestRun.stages
                .map((stage) => metricStageLabels[stage] || stage)
                .join(", ") || "None"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Total execution time differs from summed stage times because some stages and LLM API calls run in parallel.
            </p>
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
              const metric = getMetric(step.key);
              const configuredModel = step.key === "summarizing" || step.key === "analyzing"
                ? DEFAULT_MODEL
                : conv?.stageModels?.[step.key];

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
                <React.Fragment key={step.key}>
                {step.optional && processingSteps.indexOf(step) > 0 && processingSteps[processingSteps.indexOf(step) - 1]?.optional !== true && (
                  <div className="flex items-center gap-2 my-1">
                    <div className="flex-1 border-t border-dashed border-gray-300" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">optional</span>
                    <div className="flex-1 border-t border-dashed border-gray-300" />
                  </div>
                )}
                <Collapsible
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

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {configuredModel && (
                              <Badge variant="secondary" className="text-xs gap-1 font-normal">
                                <span className="font-medium">Model</span>
                                {getModelLabel(configuredModel)}
                              </Badge>
                            )}
                          {metric ? (
                            <>
                              <Badge variant="outline" className="text-xs gap-1">
                                <MetricLabel
                                  label="Execution time"
                                  description="Total elapsed time from this stage starting until it completed."
                                />
                                {formatDuration(metric.wallClockMs)}
                              </Badge>
                              <Badge variant="outline" className="text-xs gap-1">
                                <MetricLabel
                                  label="LLM time"
                                  description="Elapsed time from the first LLM API call starting until the last call completed. Parallel calls are not summed."
                                />
                                {formatDuration(metric.llmTimeMs || 0)}
                              </Badge>
                              <Badge variant="outline" className="text-xs gap-1">
                                <MetricLabel
                                  label="Processing time"
                                  description="Execution time minus LLM time. Includes prompt preparation, parsing, text splitting, token counting, and other app work."
                                />
                                {formatDuration(Math.max(0, metric.wallClockMs - (metric.llmTimeMs || 0)))}
                              </Badge>
                              <Badge variant="outline" className="text-xs gap-1">
                                <MetricLabel
                                  label="Cost"
                                  description="OpenRouter-reported cost of LLM API calls made by this stage."
                                />
                                {formatCost(metric)}
                              </Badge>
                            </>
                          ) : workflowMetrics ? (
                            <Badge variant="outline" className="text-xs">Not run</Badge>
                          ) : null}
                          {timing?.startTime && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTime(timing.startTime)}
                            </span>
                          )}
                          {!workflowMetrics && timing?.durationMs !== undefined && (
                            <Badge variant="outline" className="text-xs">
                              {formatDuration(timing.durationMs)}
                            </Badge>
                          )}
                          {!workflowMetrics && !timing?.durationMs && legacyTiming !== undefined && (
                            <Badge variant="outline" className="text-xs">
                              {legacyTiming}s
                            </Badge>
                            )}
                          </div>
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

                        {isFindComponentsStep && workflowMetrics && (
                          <Tabs defaultValue="identifying-components" className="mb-3">
                            <TabsList className="grid w-full grid-cols-2">
                              <TabsTrigger value="identifying-components">Topic identification</TabsTrigger>
                              <TabsTrigger value="classifying-components">Classification</TabsTrigger>
                            </TabsList>
                            {([
                              ["identifying-components", "Topic identification"],
                              ["classifying-components", "Classification"],
                            ] as const).map(([stage, label]) => {
                              const stageMetric = workflowMetrics.stages[stage];
                              return (
                                <TabsContent key={stage} value={stage} className="mt-2 rounded border bg-background p-3 text-xs">
                                  <div className="font-medium">{label}</div>
                                  {stageMetric ? (
                                    <>
                                      <div className="mt-1 text-muted-foreground">
                                        {getModelLabel(conv?.stageModels?.[stage] || stageMetric.model || DEFAULT_MODEL)}
                                        <br />
                                        Execution {formatDuration(stageMetric.wallClockMs)} · LLM {formatDuration(stageMetric.llmTimeMs || 0)} · Processing {formatDuration(Math.max(0, stageMetric.wallClockMs - (stageMetric.llmTimeMs || 0)))} · {formatCost(stageMetric)}
                                      </div>
                                      {stageMetric.calls && stageMetric.calls.length > 0 && (
                                        <div className="mt-3 space-y-1.5">
                                          <div className="font-medium">LLM API calls ({stageMetric.calls.length})</div>
                                          {stageMetric.calls.map((call, index) => (
                                            <div key={`${call.startedAt}-${index}`} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border px-2 py-1.5">
                                              <span className="text-muted-foreground">#{index + 1}</span>
                                              <span className="truncate" title={call.model}>{getModelLabel(call.model)}</span>
                                              <span>{formatDuration(call.durationMs)}</span>
                                              <span>{call.costUsd === undefined ? "Cost unknown" : `$${call.costUsd.toFixed(call.costUsd >= 0.001 ? 4 : 5)}`}</span>
                                              <span />
                                              <span className="col-span-3 text-muted-foreground">
                                                Input {call.inputTokens?.toLocaleString() ?? "unknown"} · Output {call.outputTokens?.toLocaleString() ?? "unknown"} tokens
                                              </span>
                                              {(call.request || call.response) && (
                                                <Tabs defaultValue="request" className="col-span-4 border-t pt-1.5">
                                                  <TabsList className="grid h-8 w-full grid-cols-2">
                                                    <TabsTrigger value="request" className="text-xs">Request</TabsTrigger>
                                                    <TabsTrigger value="response" className="text-xs">Response</TabsTrigger>
                                                  </TabsList>
                                                  <TabsContent value="request" className="mt-1">
                                                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{call.request || "Request unavailable"}</pre>
                                                  </TabsContent>
                                                  <TabsContent value="response" className="mt-1">
                                                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{call.response || "Response unavailable"}</pre>
                                                  </TabsContent>
                                                </Tabs>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="mt-1 text-muted-foreground">Not run</div>
                                  )}
                                </TabsContent>
                              );
                            })}
                          </Tabs>
                        )}

                        {!isFindComponentsStep && metric?.calls && metric.calls.length > 0 && (
                          <div className="mb-3 space-y-1.5">
                            <div className="text-xs font-medium">LLM API calls ({metric.calls.length})</div>
                            {metric.calls.map((call, index) => (
                              <div key={`${call.startedAt}-${index}`} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs">
                                <span className="text-muted-foreground">#{index + 1}</span>
                                <span className="truncate" title={call.model}>{getModelLabel(call.model)}</span>
                                <span>{formatDuration(call.durationMs)}</span>
                                <span>{call.costUsd === undefined ? "Cost unknown" : `$${call.costUsd.toFixed(call.costUsd >= 0.001 ? 4 : 5)}`}</span>
                                <span />
                                <span className="col-span-3 text-muted-foreground">
                                  Input {call.inputTokens?.toLocaleString() ?? "unknown"} · Output {call.outputTokens?.toLocaleString() ?? "unknown"} tokens
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

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
                </React.Fragment>
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
    </TooltipProvider>
  );
}

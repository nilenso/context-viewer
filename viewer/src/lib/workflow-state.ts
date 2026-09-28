import type { PipelineState, Stage, WorkflowMetrics } from "context-analyzer";
import type { StageGroup } from "@/lib/stage-groups";

export type WorkflowStageStatus = "pending" | "in-progress" | "completed" | "paused" | "not-run";

type WorkflowState = Pick<
  PipelineState,
  "conversation" | "staticComponents" | "aiSummary" | "analysis" | "stepTimings" | "workflowMetrics"
> & {
  status?: "pending" | "in-progress" | "completed" | "failed" | "paused";
  step?: string;
  pausedAtStep?: string;
};

const stageOrder: Stage[] = [
  "parsing",
  "counting-tokens",
  "segmenting",
  "identifying-components",
  "classifying-components",
  "coloring",
  "summarizing",
  "analyzing",
];

const aiStages: Stage[] = [
  "segmenting",
  "identifying-components",
  "classifying-components",
  "coloring",
];

function hasStageRun(metrics: WorkflowMetrics | undefined, stage: Stage): boolean {
  const latestStages = metrics?.latestRun?.stages || [];
  if (latestStages.includes(stage)) return true;
  if (!latestStages.some((candidate) => aiStages.includes(candidate as Stage))) return false;
  return metrics?.stages[stage] !== undefined;
}

function getPipelineStageStatus(state: WorkflowState, stage: Stage): WorkflowStageStatus {
  if (state.status === "failed" || state.status === "pending") return "pending";

  if (state.status === "paused") {
    if (stage === state.pausedAtStep) return "paused";
    return stageOrder.indexOf(stage) < stageOrder.indexOf(state.pausedAtStep as Stage) ? "completed" : "pending";
  }

  if (state.status === "in-progress") {
    if (stage === state.step) return "in-progress";
    if (hasStageRun(state.workflowMetrics, stage)) return "completed";
    return stageOrder.indexOf(stage) < stageOrder.indexOf(state.step as Stage) ? "completed" : "pending";
  }

  if (stage === "parsing") return state.conversation ? "completed" : "pending";
  if (stage === "counting-tokens") return state.staticComponents ? "completed" : "pending";
  if (stage === "summarizing") return state.aiSummary ? "completed" : "pending";
  if (stage === "analyzing") return state.analysis ? "completed" : "not-run";
  return hasStageRun(state.workflowMetrics, stage) ? "completed" : "pending";
}

export function getWorkflowStageStatus(state: WorkflowState, group: StageGroup): WorkflowStageStatus {
  if (group === "finding-components") {
    const statuses = [
      getPipelineStageStatus(state, "identifying-components"),
      getPipelineStageStatus(state, "classifying-components"),
    ];
    if (statuses.includes("in-progress")) return "in-progress";
    if (statuses.every((status) => status === "completed")) return "completed";
    if (statuses.includes("paused")) return "paused";
    return "pending";
  }
  return getPipelineStageStatus(state, group);
}

export function getWorkflowStageExecutionMs(state: WorkflowState, group: StageGroup): number | undefined {
  if (group === "finding-components") {
    const metrics = [
      state.workflowMetrics?.stages["identifying-components"],
      state.workflowMetrics?.stages["classifying-components"],
    ];
    if (metrics.every((metric) => !metric)) return undefined;
    return metrics.reduce((total, metric) => total + (metric?.wallClockMs || 0), 0);
  }
  return state.workflowMetrics?.stages[group]?.wallClockMs
    ?? (state.stepTimings?.[group] !== undefined ? state.stepTimings[group]! * 1000 : undefined);
}

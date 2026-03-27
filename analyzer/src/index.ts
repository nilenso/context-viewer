/**
 * context-analyzer — headless library for analyzing AI conversation transcripts.
 *
 * Primary export:
 *   analyze()        — the single entry point. First run creates a session.
 *                      Subsequent calls with a sessionId iterate.
 *
 * Optional exports:
 *   group()          — merge multiple analyzed files into a virtual conversation
 *   summarize()      — generate AI narrative summary (outside the pipeline)
 *   analyzeContext() — generate AI context analysis (outside the pipeline)
 */

import type {
  PipelineState,
  DimensionData,
  Stage,
} from "./model/types";
import type { Conversation, Message } from "./model/schema";
import { type AnalyzerConfig, resolveAIConfig, type AIConfig } from "./config";
import { configureLogger } from "./logger";
import { runPipeline, type Interceptor, type PipelineOptions } from "./pipeline";
import { runSummary } from "./stages/summarize";
import { runAnalysis } from "./stages/analyze-context";
import { createEmptyDimension } from "./model/dimensions";
import { generateId } from "./id-generator";
import { aggregateComponentTokens } from "./operations/aggregation";
import { summarizeConversation } from "./operations/conversation-summary";
import { createSession, getSession, deleteSession, applyIterationInputs } from "./session";
import type { StageError } from "./errors";

// Register all parsers on import
import "./parsers/index";

// ============================================================================
// Public types
// ============================================================================

export interface FileInput {
  content: string;
  filename: string;
}

/**
 * A component definition with a name and description.
 * The description helps the AI classify conversation parts more accurately.
 *
 * Example:
 *   { name: "auth_system", description: "Authentication, login, sessions, RBAC, and security" }
 */
export interface ComponentDef {
  name: string;
  description: string;
}

export interface AnalyzeOptions {
  /** Session ID from a previous analyze() call. Enables iteration. */
  sessionId?: string;

  /** Input files. Required on first call, ignored when sessionId is provided. */
  files?: FileInput | FileInput[];

  /** Custom prompts by stage name. Keys: "segmentation", "component-identification", "coloring" */
  prompts?: Record<string, string>;

  /** Named dimensions with custom prompts and components. */
  dimensions?: Record<string, {
    prompt?: string;
    components?: ComponentDef[];
    colors?: Record<string, string>;
    coloringPrompt?: string;
  }>;

  /** Preset colors for components (applies to default dimension). */
  presetColors?: Record<string, string>;

  /**
   * Custom components list (applies to default dimension if no dimensions specified).
   * Each entry has a name and a description — the description is passed to the AI
   * classifier so it understands what belongs in each component.
   */
  components?: ComponentDef[];

  /** Segmentation token threshold (default 500). */
  segmentationThreshold?: number;

  /** Interceptors for hooking into pipeline stage boundaries. */
  interceptors?: Interceptor[];
}

// ============================================================================
// Output types
// ============================================================================

export interface ComponentBreakdown {
  component: string;
  tokens: number;
  percentage: number;
  color: string;
}

export interface DimensionResult {
  name: string;
  components: ComponentBreakdown[];
  totalTokens: number;
}

export interface FileAnalytics {
  fileId: string;
  filename: string;
  totalTokens: number;
  messageCount: number;
  turnCount: number;
  dimensions: Record<string, DimensionResult>;
}

export interface AnalyzeResult {
  /** Session ID — pass this back to analyze() to iterate. */
  sessionId: string;
  /** Detected format (e.g. "Claude Code", "OpenAI Responses"). */
  format: string;
  /** Model used in conversation (if detected). */
  model?: string;
  /** Per-file analytics — waffle-chart-ready numbers. */
  analytics: FileAnalytics[];
  /** Full annotated pipeline states — the same objects held by the session. */
  states: PipelineState[];
  /** Errors encountered during processing. */
  errors: StageError[];
  /** Warnings from pipeline stages. */
  warnings: string[];
}

// ============================================================================
// analyze() — single entry point
// ============================================================================

/**
 * Analyze conversation transcripts. Creates a session on first call.
 * Pass the returned sessionId on subsequent calls to iterate (change
 * prompts, refine components) without re-running unchanged stages.
 *
 * First call:
 *   analyze({ files: [...], ... }, config)
 *
 * Iteration:
 *   analyze({ sessionId: prev.sessionId, prompts: { segmentation: "..." } }, config)
 */
export async function analyze(
  options: AnalyzeOptions,
  config: AnalyzerConfig,
): Promise<AnalyzeResult> {
  configureLogger(config.logLevel || "silent", config.logger);
  const aiConfig = config.apiKey ? resolveAIConfig(config) : null;

  let session;
  let affectedDimNames: string[] | undefined;

  if (options.sessionId) {
    // --- Iteration: load session, apply changes ---
    session = getSession(options.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }
    const iterResult = applyIterationInputs(session.states, buildIterationInputs(options));
    affectedDimNames = iterResult.affectedDimNames.length > 0 ? iterResult.affectedDimNames : undefined;
  } else {
    // --- First run: build states from files ---
    const files = options.files;
    if (!files) {
      throw new Error("Either files or sessionId must be provided.");
    }
    const fileList = Array.isArray(files) ? files : [files];
    const states = fileList.map((file) => buildPipelineState(file, options));
    session = createSession(states);
  }

  // --- Run the pipeline on all states ---
  const allErrors: StageError[] = [];
  const pipelineOpts: PipelineOptions = {
    interceptors: options.interceptors,
    dimNames: affectedDimNames,
  };

  await Promise.all(
    session.states.map(async (ctx) => {
      const errors = await runPipeline(ctx, aiConfig, pipelineOpts);
      allErrors.push(...errors);
    }),
  );

  // --- Build result ---
  let format = "";
  let model: string | undefined;
  const allWarnings: string[] = [];

  for (const ctx of session.states) {
    if (!format && ctx.metadata?.parserName) format = ctx.metadata.parserName;
    if (!model && ctx.metadata?.model) model = ctx.metadata.model;
    if (ctx.warnings?.length) allWarnings.push(...ctx.warnings);
  }

  return {
    sessionId: session.id,
    format,
    model,
    analytics: session.states.map(buildFileAnalytics),
    states: session.states,
    errors: allErrors,
    warnings: allWarnings,
  };
}

// ============================================================================
// group()
// ============================================================================

export interface GroupOptions {
  name?: string;
  fileIndices?: number[];
}

export interface GroupResult {
  groupId: string;
  name: string;
  analytics: FileAnalytics;
  members: FileAnalytics[];
  errors: StageError[];
  warnings: string[];
  states: PipelineState[];
  mergedState: PipelineState;
}

export function group(
  result: AnalyzeResult,
  options: GroupOptions = {},
): GroupResult {
  const indices = options.fileIndices ?? result.states.map((_, i) => i);
  const memberStates = indices.map((i) => result.states[i]!).filter((s) => s.conversation);

  if (memberStates.length === 0) {
    throw new Error("No analyzed conversations to group.");
  }

  const groupId = generateId();
  const name = options.name || `Group: ${memberStates.map((s) => s.filename).join(", ")}`;
  const mergedState = buildMergedState(groupId, name, memberStates);

  const allWarnings: string[] = [];
  for (const s of memberStates) {
    if (s.warnings?.length) allWarnings.push(...s.warnings);
  }

  return {
    groupId,
    name,
    analytics: buildFileAnalytics(mergedState),
    members: memberStates.map(buildFileAnalytics),
    errors: [],
    warnings: allWarnings,
    states: memberStates,
    mergedState,
  };
}

// ============================================================================
// summarize() — outside the pipeline, on demand
// ============================================================================

export interface SummarizeOptions {
  prompt?: string;
  fileIndex?: number;
}

export interface SummarizeResult {
  id: string;
  name: string;
  summary: string;
  errors: StageError[];
}

export async function summarize(
  result: AnalyzeResult | GroupResult,
  config: AnalyzerConfig,
  options: SummarizeOptions = {},
): Promise<SummarizeResult> {
  configureLogger(config.logLevel || "silent", config.logger);
  const aiConfig = resolveAIConfig(config);

  const ctx = resolveState(result, options.fileIndex);
  ctx.aiSummary = undefined;
  if (options.prompt !== undefined) ctx.customSummaryPrompt = options.prompt;

  const { error } = await runSummary(ctx, aiConfig);

  return {
    id: ctx.id,
    name: ctx.filename,
    summary: ctx.aiSummary || "",
    errors: error ? [error] : [],
  };
}

// ============================================================================
// analyzeContext() — outside the pipeline, on demand
// ============================================================================

export interface AnalyzeContextOptions {
  prompt?: string;
  fileIndex?: number;
  summary?: string;
}

export interface AnalyzeContextResult {
  id: string;
  name: string;
  analysis: string;
  summary: string;
  errors: StageError[];
}

export async function analyzeContext(
  result: AnalyzeResult | GroupResult,
  config: AnalyzerConfig,
  options: AnalyzeContextOptions = {},
): Promise<AnalyzeContextResult> {
  configureLogger(config.logLevel || "silent", config.logger);
  const aiConfig = resolveAIConfig(config);

  const ctx = resolveState(result, options.fileIndex);
  ctx.analysis = undefined;
  if (options.prompt !== undefined) ctx.customAnalysisPrompt = options.prompt;

  if (options.summary !== undefined) {
    ctx.aiSummary = options.summary;
  } else if (!ctx.aiSummary) {
    await runSummary(ctx, aiConfig);
  }

  if (!ctx.aiSummary) {
    throw new Error("Cannot generate analysis without a summary.");
  }

  const { error } = await runAnalysis(ctx, aiConfig);

  return {
    id: ctx.id,
    name: ctx.filename,
    analysis: ctx.analysis || "",
    summary: ctx.aiSummary,
    errors: error ? [error] : [],
  };
}

// ============================================================================
// Session management
// ============================================================================

export { deleteSession } from "./session";

// ============================================================================
// Internal helpers
// ============================================================================

function isGroupResult(result: AnalyzeResult | GroupResult): result is GroupResult {
  return "mergedState" in result;
}

function resolveState(result: AnalyzeResult | GroupResult, fileIndex?: number): PipelineState {
  if (isGroupResult(result)) {
    return result.mergedState;
  }
  return result.states[fileIndex ?? 0]!;
}

/** Convert AnalyzeOptions into the shape applyIterationInputs expects. */
function buildIterationInputs(options: AnalyzeOptions) {
  const inputs: Parameters<typeof applyIterationInputs>[1] = {};

  if (options.prompts?.segmentation !== undefined) {
    inputs.segmentationPrompt = options.prompts.segmentation;
  }
  if (options.segmentationThreshold !== undefined) {
    inputs.segmentationThreshold = options.segmentationThreshold;
  }
  if (options.presetColors !== undefined) {
    inputs.presetColors = options.presetColors;
  }

  // Build dimension inputs from options.dimensions or options.components
  if (options.dimensions) {
    inputs.dimensions = {};
    for (const [name, dim] of Object.entries(options.dimensions)) {
      inputs.dimensions[name] = {
        prompt: dim.prompt,
        customComponents: dim.components?.map((c) => c.name),
        componentDescriptions: dim.components
          ? Object.fromEntries(dim.components.map((c) => [c.name, c.description]))
          : undefined,
        coloringPrompt: dim.coloringPrompt,
      };
    }
  } else if (options.components) {
    inputs.dimensions = {
      default: {
        customComponents: options.components.map((c) => c.name),
        componentDescriptions: Object.fromEntries(
          options.components.map((c) => [c.name, c.description]),
        ),
      },
    };
  }

  if (options.prompts?.["component-identification"] !== undefined) {
    if (!inputs.dimensions) inputs.dimensions = {};
    if (!inputs.dimensions.default) inputs.dimensions.default = {};
    inputs.dimensions.default.prompt = options.prompts["component-identification"];
  }

  if (options.prompts?.coloring !== undefined) {
    if (!inputs.dimensions) inputs.dimensions = {};
    if (!inputs.dimensions.default) inputs.dimensions.default = {};
    inputs.dimensions.default.coloringPrompt = options.prompts.coloring;
  }

  return inputs;
}

export function buildPipelineState(file: FileInput, options: AnalyzeOptions = {}): PipelineState {
  const id = generateId();

  let dimensions: Record<string, DimensionData> | undefined;

  if (options.dimensions) {
    dimensions = {};
    for (const [name, dim] of Object.entries(options.dimensions)) {
      const names = dim.components?.map((c) => c.name);
      const descs = dim.components ? Object.fromEntries(dim.components.map((c) => [c.name, c.description])) : undefined;
      dimensions[name] = {
        ...createEmptyDimension(name),
        prompt: dim.prompt,
        customComponents: names,
        componentDescriptions: descs,
        componentColors: dim.colors || {},
        customColoringPrompt: dim.coloringPrompt,
      };
    }
  } else if (options.components || options.prompts?.["component-identification"]) {
    const names = options.components?.map((c) => c.name);
    const descs = options.components ? Object.fromEntries(options.components.map((c) => [c.name, c.description])) : undefined;
    dimensions = {
      default: {
        ...createEmptyDimension("default"),
        prompt: options.prompts?.["component-identification"],
        customComponents: names,
        componentDescriptions: descs,
      },
    };
  }

  return {
    id,
    filename: file.filename,
    rawContent: file.content,
    conversation: undefined as any,
    warnings: [],
    stepTimings: {},
    presetColors: options.presetColors,
    customSegmentationPrompt: options.prompts?.segmentation,
    segmentationThreshold: options.segmentationThreshold,
    dimensions,
  };
}

export function buildFileAnalytics(ctx: PipelineState): FileAnalytics {
  const dimensionResults: Record<string, DimensionResult> = {};

  if (ctx.dimensions && ctx.conversation) {
    for (const [name, dim] of Object.entries(ctx.dimensions)) {
      const agg = aggregateComponentTokens(ctx.conversation, dim.componentMapping);

      const components: ComponentBreakdown[] = Object.entries(agg.componentTokens)
        .map(([component, tokens]) => ({
          component,
          tokens,
          percentage: agg.totalTokens > 0 ? (tokens / agg.totalTokens) * 100 : 0,
          color: dim.componentColors[component] || "#94a3b8",
        }))
        .sort((a, b) => b.tokens - a.tokens);

      dimensionResults[name] = {
        name,
        components,
        totalTokens: agg.totalTokens,
      };
    }
  }

  return {
    fileId: ctx.id,
    filename: ctx.filename,
    totalTokens: ctx.conversation?.messages.reduce((sum, m) =>
      sum + m.parts.reduce((s, p) => s + (("token_count" in p && typeof p.token_count === "number") ? p.token_count : 0), 0), 0) || 0,
    messageCount: ctx.conversation?.messages.length || 0,
    turnCount: ctx.conversation?.messages.filter(m => m.role === "user").length || 0,
    dimensions: dimensionResults,
  };
}

function buildMergedState(groupId: string, name: string, members: PipelineState[]): PipelineState {
  const allMessages: Message[] = [];
  for (const conv of members) {
    if (!conv.conversation) continue;
    for (const msg of conv.conversation.messages) {
      const newParts = msg.parts.map((part) => ({
        ...part,
        id: `${conv.id}-${part.id}`,
      }));
      allMessages.push({ ...msg, id: `${conv.id}-${msg.id}`, parts: newParts } as Message);
    }
  }

  const mergedDims: Record<string, DimensionData> = {};
  for (const conv of members) {
    if (!conv.dimensions) continue;
    for (const [dimName, dim] of Object.entries(conv.dimensions)) {
      if (!mergedDims[dimName]) {
        mergedDims[dimName] = createEmptyDimension(dimName);
      }
      const merged = mergedDims[dimName]!;
      for (const c of dim.discoveredComponents) {
        if (!merged.discoveredComponents.includes(c)) merged.discoveredComponents.push(c);
      }
      for (const [partId, component] of Object.entries(dim.componentMapping)) {
        merged.componentMapping[`${conv.id}-${partId}`] = component;
      }
      Object.assign(merged.componentColors, dim.componentColors);
    }
  }

  const staticComponentsSet = new Set<string>();
  const staticMapping: Record<string, string> = {};
  for (const conv of members) {
    if (conv.staticComponents) conv.staticComponents.forEach((c) => staticComponentsSet.add(c));
    if (conv.staticMapping) {
      for (const [partId, component] of Object.entries(conv.staticMapping)) {
        staticMapping[`${conv.id}-${partId}`] = component;
      }
    }
  }

  const conversation: Conversation = { messages: allMessages };
  const summary = summarizeConversation(conversation);

  return {
    id: groupId,
    filename: name,
    conversation,
    summary,
    metadata: members[0]?.metadata,
    dimensions: Object.keys(mergedDims).length > 0 ? mergedDims : undefined,
    staticComponents: [...staticComponentsSet],
    staticMapping,
    warnings: [],
    stepTimings: {},
  };
}

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  Conversation, Message, OriginInfo,
  TextPart, ReasoningPart, ToolCallPart, ToolResultPart, ImagePart, FilePart,
} from "./model/schema";
export type { PipelineState, DimensionData, ConversationSummary, ConversationMetadata, ComponentTimelineSnapshot, Stage, Group } from "./model/types";
export type { AnalyzerConfig, AIConfig, AIApiMode, ReasoningEffort } from "./config";
export type { StageError, ErrorCategory } from "./errors";
export type { LogLevel, LogEntry, LogSink } from "./logger";
export type { Interceptor, PipelineOptions } from "./pipeline";

// Config helpers
export { resolveAIConfig } from "./config";
export { configureLogger } from "./logger";

// Export data types and schemas
export type { SessionExport, FileExport, FileAnalytics as FileAnalyticsExport, AnalyticsExport } from "./model/export-schema";
export { SessionExportSchema, FileExportSchema } from "./model/export-schema";
export { buildFileExport, buildSessionExport } from "./operations/export-builder";

// Parser registry and file format utilities
export { parserRegistry } from "./parsers/parser";
export { parseFileContent, SUPPORTED_EXTENSIONS, SUPPORTED_EXTENSIONS_TEXT } from "./parsers/file-formats";

// Summary and analysis (outside the pipeline, on demand)
export { generateConversationSummary } from "./stages/summarize";
export { generateContextAnalysis } from "./stages/analyze-context";

// Operations (pure functions)
export { aggregateComponentTokens, computePercentages, computeTupleTokens, generateComponentCSV, TUPLE_SEPARATOR, getPartTokenCount, getMessageTokenCount, buildComponentTimeline } from "./operations/aggregation";
export { summarizeConversation } from "./operations/conversation-summary";
export { staticComponentise } from "./operations/static-components";
export { addTokenCounts } from "./operations/token-counting";
export * from "./operations/color-math";

// Model helpers
export { createEmptyDimension, ensureDimensions, getDimensionNames, getAllComponents, getDefaultDimension } from "./model/dimensions";

// Prompts (defaults, for UI editors)
export {
  getDefaultComponentIdentificationPrompt,
  getDefaultSegmentationPrompt,
  getDefaultSummaryPrompt,
  getDefaultAnalysisPrompt,
  getDefaultColoringPrompt,
} from "./stages/prompts";

// Stage constants
export { DEFAULT_SEGMENTATION_THRESHOLD } from "./stages/segment";

// Pipeline (for direct use — most callers should use analyze())
export { runPipeline } from "./pipeline";

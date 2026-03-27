import { generateText } from "ai";
import type { Conversation, Message } from "../model/schema";
import type { PipelineState } from "../model/types";
import type { AIConfig } from "../config";
import { getPrompt } from "./prompts";
import { getProviderOptions, createModel } from "../config";
import { stageLogger } from "../logger";
import { addTokenCounts } from "../operations/token-counting";
import { upstreamError, parseError, type StageError } from "../errors";

const log = stageLogger("segment");

export const DEFAULT_SEGMENTATION_THRESHOLD = 500;

function identifyLargeParts(
  conversation: Conversation,
  threshold: number = DEFAULT_SEGMENTATION_THRESHOLD,
): Array<{ messageIndex: number; partIndex: number; part: Message["parts"][number] }> {
  log.debug(`Using threshold: ${threshold} tokens`);

  const largeParts: Array<{ messageIndex: number; partIndex: number; part: Message["parts"][number] }> = [];

  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      const tokenCount = ("token_count" in part && part.token_count) || 0;
      if (tokenCount > threshold) {
        log.debug(`Found large part: message ${messageIndex}, part ${partIndex}, tokens: ${tokenCount}`);
        largeParts.push({ messageIndex, partIndex, part });
      }
    });
  });

  log.debug(`Found ${largeParts.length} large parts (>${threshold} tokens)`);
  return largeParts;
}

async function segmentTextWithAI(
  text: string,
  config: AIConfig,
  customPrompt?: string,
): Promise<{ patterns: string[]; error?: StageError }> {
  const model = createModel(config);

  log.info(`Calling AI to segment text (${text.length} chars, model: ${config.model})${customPrompt ? " with custom prompt" : ""}`);

  const prompt = getPrompt("segmentation", { text, customPrompt });

  try {
    const result = await generateText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    log.debug(`AI response: ${result.text.substring(0, 200)}...`);

    const jsonMatch = result.text.match(/\[.*\]/s);
    if (!jsonMatch) {
      log.warn("No JSON array found in response");
      return { patterns: [], error: parseError("segment", "AI response contained no JSON array") };
    }

    const substrings = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(substrings)) {
      log.warn("Parsed result is not an array");
      return { patterns: [], error: parseError("segment", "AI response JSON was not an array") };
    }

    log.debug(`Parsed ${substrings.length} split patterns`, substrings);
    return { patterns: substrings };
  } catch (error) {
    log.error("Error calling AI", error);
    return { patterns: [], error: upstreamError("segment", `AI call failed: ${error instanceof Error ? error.message : String(error)}`) };
  }
}

function preprocessPattern(pattern: string): string {
  let processed = pattern.replace(/\(\?=\^/g, "(?=");
  processed = processed.replace(/\$\)/g, ")");
  processed = processed.replace(/\\s\*\$/g, "\\s*");
  return processed;
}

function splitTextBySubstrings(text: string, substrings: string[]): string[] {
  if (substrings.length === 0) return [text];

  try {
    const processedPatterns = substrings.map(preprocessPattern);
    const combinedPattern = processedPatterns.join("|");
    const regex = new RegExp(combinedPattern);
    const parts = text.split(regex);
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
  } catch (error) {
    log.error("Regex error", error);
    return [text];
  }
}

function generateChildId(parentId: string, index: number): string {
  return `${parentId}.${index}`;
}

type SegmentResult =
  | { success: true; parts: Message["parts"] }
  | { success: false; skipped: true }
  | { success: false; error: StageError };

async function segmentMessagePart(
  part: Message["parts"][number],
  config: AIConfig,
  customPrompt?: string,
): Promise<SegmentResult> {
  let text: string;

  if (part.type === "text" || part.type === "reasoning") {
    text = part.text;
  } else {
    log.debug(`Skipping part ${part.id}, type: ${part.type}`);
    return { success: false, skipped: true };
  }

  log.debug(`Processing part ${part.id}, type: ${part.type}, text length: ${text.length}`);
  const { patterns, error } = await segmentTextWithAI(text, config, customPrompt);

  if (error || patterns.length === 0) {
    log.debug(`No patterns returned for part ${part.id}`);
    return { success: false, error: error || parseError("segment", `No segmentation patterns for part ${part.id}`) };
  }

  const segments = splitTextBySubstrings(text, patterns);

  if (segments.length <= 1) {
    log.debug(`Split resulted in ${segments.length} segment(s), not segmenting`);
    return { success: false, skipped: true };
  }

  log.info(`Successfully split part ${part.id} into ${segments.length} segments`);

  const newParts = segments.map((segment, index) => ({
    ...part,
    id: generateChildId(part.id, index + 1),
    token_count: undefined,
    text: segment,
  }));

  return { success: true, parts: newParts as Message["parts"] };
}

export async function segmentConversation(
  conversation: Conversation,
  config: AIConfig,
  customPrompt?: string,
  segmentationThreshold?: number,
): Promise<{ conversation: Conversation; errors: StageError[] }> {
  log.info("Starting segmentation process");

  const errors: StageError[] = [];
  const largeParts = identifyLargeParts(conversation, segmentationThreshold);

  if (largeParts.length === 0) {
    log.info("No large parts to segment, returning original conversation");
    return { conversation, errors };
  }

  const results = await Promise.all(
    largeParts.map(async ({ messageIndex, partIndex, part }) => {
      const result = await segmentMessagePart(part, config, customPrompt);
      return { messageIndex, partIndex, result };
    }),
  );

  for (const { result } of results) {
    if (!result.success && "error" in result && result.error) {
      errors.push(result.error);
    }
  }

  const replacements = new Map<string, Array<{ partIndex: number; segments: Message["parts"] }>>();

  for (const { messageIndex, partIndex, result } of results) {
    if (!result.success) continue;
    const key = messageIndex.toString();
    if (!replacements.has(key)) replacements.set(key, []);
    replacements.get(key)!.push({ partIndex, segments: result.parts });
  }

  const newMessages = conversation.messages.map((message, messageIndex) => {
    const messageReplacements = replacements.get(messageIndex.toString());
    if (!messageReplacements || messageReplacements.length === 0) return message;

    messageReplacements.sort((a, b) => b.partIndex - a.partIndex);
    const newParts = [...message.parts];

    for (const { partIndex, segments } of messageReplacements) {
      newParts.splice(partIndex, 1, ...segments);
    }

    return { ...message, parts: newParts as typeof message.parts } as Message;
  });

  return { conversation: { messages: newMessages as Message[] }, errors };
}

/** Pure stage function for the pipeline. */
export async function segment(
  ctx: PipelineState,
  config: AIConfig,
): Promise<{ conversation: Conversation; warnings?: string[]; errors?: StageError[] }> {
  const segResult = await segmentConversation(
    ctx.conversation!,
    config,
    ctx.customSegmentationPrompt,
    ctx.segmentationThreshold,
  );
  const conversation = await addTokenCounts(segResult.conversation);
  const warnings = segResult.errors.length > 0
    ? [`Segmentation: ${segResult.errors.length} error(s)`]
    : undefined;
  return { conversation, warnings, errors: segResult.errors };
}

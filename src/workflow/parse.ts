/**
 * Parse: file → conversation + summary + metadata.
 * Also handles restoring pre-processed Context Viewer exports.
 */

import type { WorkflowState } from "./types";
import type { ConversationMetadata } from "../parser";
import type { Conversation } from "../schema";
import { type Notify, startStep, endStep, timed } from "./runner";
import { parserRegistry } from "../parser";
import { summarizeConversation } from "../conversation-summary";
import { parseFileContent } from "../lib/file-formats";
import { buildComponentTimeline } from "../componentisation";
import { staticComponentise } from "../static-componentisation";
import { syncLegacyFieldsFromDimensions } from "./dimensions";

export async function runParse(ctx: WorkflowState, notify: Notify) {
  startStep(notify, ctx, "parsing");
  const { result, timing } = await timed(async () => {
    const text = await ctx.file!.text();
    const data = parseFileContent(text, ctx.file!.name);
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);
    const summary = summarizeConversation(conversation);
    return { conversation, summary, metadata };
  });
  endStep(ctx, "parsing");

  ctx.conversation = result.conversation;
  ctx.summary = result.summary;
  ctx.metadata = result.metadata;
  ctx.stepTimings!.parsing = timing;
}

// ---------------------------------------------------------------------------
// Pre-processed import restoration
// ---------------------------------------------------------------------------

function extractComponentMappingFromParts(
  conversation: Conversation,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const message of conversation.messages) {
    for (const part of message.parts) {
      if ("component" in part && part.component) {
        mapping[part.id] = part.component as string;
      }
    }
  }
  return mapping;
}

export function restorePreProcessedImport(
  ctx: WorkflowState,
  metadata: ConversationMetadata,
  conversation: Conversation,
) {
  const componentMapping = extractComponentMappingFromParts(conversation);
  const components = [...new Set(Object.values(componentMapping))];

  ctx.title = metadata.title;
  ctx.componentColors = metadata.componentColors;
  ctx.aiSummary = metadata.aiSummary;
  ctx.analysis = metadata.analysis;
  ctx.components = components;
  ctx.componentMapping = componentMapping;
  ctx.customPrompt = metadata.customPrompt;
  ctx.customSegmentationPrompt = metadata.customSegmentationPrompt;
  ctx.customSummaryPrompt = metadata.customSummaryPrompt;
  ctx.customAnalysisPrompt = metadata.customAnalysisPrompt;
  ctx.customColoringPrompt = metadata.customColoringPrompt;

  ctx.componentTimeline = buildComponentTimeline(conversation, componentMapping);
  const staticResult = staticComponentise(conversation);
  ctx.staticComponents = staticResult.components;
  ctx.staticMapping = staticResult.mapping;
  ctx.staticTimeline = staticResult.timeline;

  if (metadata.dimensions) {
    ctx.dimensions = {};
    for (const [dimName, dimExport] of Object.entries(metadata.dimensions)) {
      const dimMapping: Record<string, string> = {};
      for (const message of conversation.messages) {
        for (const part of message.parts) {
          if ("dimensions" in part && part.dimensions) {
            const dimComp = (part.dimensions as Record<string, string>)[dimName];
            if (dimComp) dimMapping[part.id] = dimComp;
          }
        }
      }
      ctx.dimensions[dimName] = {
        name: dimName,
        prompt: dimExport.prompt,
        components: dimExport.components,
        componentMapping: dimMapping,
        componentTimeline: buildComponentTimeline(conversation, dimMapping),
        componentColors: dimExport.colors,
        customColoringPrompt: dimExport.coloringPrompt,
      };
    }
    syncLegacyFieldsFromDimensions(ctx);
  }
}

export { summarizeConversation } from "../conversation-summary";

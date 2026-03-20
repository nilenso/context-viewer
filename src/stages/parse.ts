/**
 * Parse: file → conversation + summary + metadata.
 * Also handles restoring pre-processed Context Viewer exports.
 */

import type { WorkflowState, ConversationMetadata } from "@/model/types";
import type { Conversation } from "@/model/schema";
import { type Notify, startStep, endStep, timed } from "@/pipeline/notify";
import { parserRegistry } from "@/parsers/parser";
import { summarizeConversation } from "@/operations/conversation-summary";
import { parseFileContent } from "@/parsers/file-formats";
import { buildComponentTimeline } from "./classify-components";
import { staticComponentise } from "@/operations/static-components";

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
  const componentTimeline = buildComponentTimeline(conversation, componentMapping);

  ctx.title = metadata.title;
  ctx.aiSummary = metadata.aiSummary;
  ctx.analysis = metadata.analysis;
  ctx.customSegmentationPrompt = metadata.customSegmentationPrompt;
  ctx.customSummaryPrompt = metadata.customSummaryPrompt;
  ctx.customAnalysisPrompt = metadata.customAnalysisPrompt;

  // Set up default dimension from the imported data
  ctx.dimensions = {
    default: {
      name: "default",
      prompt: metadata.customPrompt,
      components,
      componentMapping,
      componentTimeline,
      componentColors: metadata.componentColors || {},
      customColoringPrompt: metadata.customColoringPrompt,
    },
  };

  // Restore additional dimensions if present
  if (metadata.dimensions) {
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
  }

  const staticResult = staticComponentise(conversation);
  ctx.staticComponents = staticResult.components;
  ctx.staticMapping = staticResult.mapping;
  ctx.staticTimeline = staticResult.timeline;
}

export { summarizeConversation } from "@/operations/conversation-summary";

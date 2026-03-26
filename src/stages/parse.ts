/**
 * Parse: file → conversation + summary + metadata.
 * Also handles restoring pre-processed Context Viewer exports.
 */

import type { PipelineState, ConversationMetadata, DimensionData } from "@/model/types";
import type { Conversation } from "@/model/schema";
import { parserRegistry } from "@/parsers/parser";
import { summarizeConversation } from "@/operations/conversation-summary";
import { parseFileContent } from "@/parsers/file-formats";
import { buildComponentTimeline } from "./classify-components";
import { staticComponentise } from "@/operations/static-components";
import { recordCall } from "@/lib/session-recorder";

/** Pure parse stage — returns results, no side effects. */
export async function parse(
  ctx: PipelineState,
): Promise<Pick<PipelineState, "conversation" | "summary" | "metadata">> {
  return recordCall("stages/parse", "parse", [{ filename: ctx.filename }], () => _parse(ctx));
}

async function _parse(
  ctx: PipelineState,
): Promise<Pick<PipelineState, "conversation" | "summary" | "metadata">> {
  const text = await ctx.file!.text();
  const data = parseFileContent(text, ctx.file!.name);
  const { conversation, metadata } = parserRegistry.parseWithMetadata(data);
  const summary = summarizeConversation(conversation);
  return { conversation, summary, metadata };
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

/** Pure — returns fields to merge, no mutation. */
export function restorePreProcessedImport(
  metadata: ConversationMetadata,
  conversation: Conversation,
): Partial<PipelineState> {
  const componentMapping = extractComponentMappingFromParts(conversation);
  const components = [...new Set(Object.values(componentMapping))];
  const componentTimeline = buildComponentTimeline(conversation, componentMapping);

  const dimensions: Record<string, DimensionData> = {
    default: {
      name: "default",
      prompt: metadata.customPrompt,
      discoveredComponents: components,
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
      dimensions[dimName] = {
        name: dimName,
        prompt: dimExport.prompt,
        discoveredComponents: dimExport.components,
        componentMapping: dimMapping,
        componentTimeline: buildComponentTimeline(conversation, dimMapping),
        componentColors: dimExport.colors,
        customColoringPrompt: dimExport.coloringPrompt,
      };
    }
  }

  const staticResult = staticComponentise(conversation);

  return {
    title: metadata.title,
    aiSummary: metadata.aiSummary,
    analysis: metadata.analysis,
    customSegmentationPrompt: metadata.customSegmentationPrompt,
    customSummaryPrompt: metadata.customSummaryPrompt,
    customAnalysisPrompt: metadata.customAnalysisPrompt,
    dimensions,
    staticComponents: staticResult.components,
    staticMapping: staticResult.mapping,
    staticTimeline: staticResult.timeline,
  };
}

export { summarizeConversation } from "@/operations/conversation-summary";

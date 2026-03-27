import type { Conversation } from "../model/schema";
import type { ConversationMetadata, DimensionData, Group, PipelineState } from "../model/types";
import { aggregateComponentTokens } from "./aggregation";
import {
  SessionExportSchema,
  type SessionExport,
  type FileExport,
  type AnalyticsExport,
  type ExportConversation,
  type ExportDimension,
  type ExportPart,
} from "../model/export-schema";

function buildConversationWithComponents(
  conversation: Conversation,
  componentMapping?: Record<string, string>,
  dimensions?: Record<string, DimensionData>,
): ExportConversation {
  const hasDimensions = dimensions && Object.keys(dimensions).length > 1;
  return {
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      parts: message.parts.map((part) => {
        const exported: ExportPart = {
          ...part,
          component: componentMapping?.[part.id],
        };
        if (hasDimensions) {
          const dimMap: Record<string, string> = {};
          for (const [dimName, dim] of Object.entries(dimensions!)) {
            const comp = dim.componentMapping[part.id];
            if (comp) dimMap[dimName] = comp;
          }
          if (Object.keys(dimMap).length > 0) {
            exported.dimensions = dimMap;
          }
        }
        return exported;
      }),
    })),
  };
}

export function buildFileExport(conv: PipelineState): FileExport {
  if (!conv.conversation) {
    throw new Error(`Cannot export conversation ${conv.id}: no conversation data`);
  }

  const defaultDim = conv.dimensions?.["default"];
  const conversationWithComponents = buildConversationWithComponents(
    conv.conversation,
    defaultDim?.componentMapping,
    conv.dimensions,
  );

  const identPrompt = defaultDim?.prompt;
  const coloringPrompt = defaultDim?.customColoringPrompt;
  const customPrompts = identPrompt || conv.customSegmentationPrompt ||
    conv.customSummaryPrompt || conv.customAnalysisPrompt || coloringPrompt
    ? {
        componentIdentification: identPrompt,
        segmentation: conv.customSegmentationPrompt,
        summary: conv.customSummaryPrompt,
        analysis: conv.customAnalysisPrompt,
        coloring: coloringPrompt,
      }
    : undefined;

  let dimensionsExport: Record<string, ExportDimension> | undefined;
  if (conv.dimensions && Object.keys(conv.dimensions).length > 0) {
    dimensionsExport = {};
    for (const [dimName, dim] of Object.entries(conv.dimensions)) {
      dimensionsExport[dimName] = {
        components: dim.discoveredComponents,
        colors: dim.componentColors,
        prompt: dim.prompt,
        coloringPrompt: dim.customColoringPrompt,
      };
    }
  }

  const result: FileExport = {
    id: conv.id,
    filename: conv.filename,
    conversation: conversationWithComponents,
    colors: defaultDim?.componentColors || {},
    summary: conv.aiSummary || null,
    analysis: conv.analysis || null,
    metadata: conv.metadata,
    customPrompts,
  };
  if (conv.title) {
    result.title = conv.title;
  }
  if (dimensionsExport) {
    result.dimensions = dimensionsExport;
  }
  return result;
}

function buildAnalytics(conversations: PipelineState[]): AnalyticsExport {
  return {
    componentComparison: conversations.map((conv) => {
      const defaultDim = conv.dimensions?.["default"];
      const { componentTokens, totalTokens } = conv.conversation
        ? aggregateComponentTokens(conv.conversation, defaultDim?.componentMapping || {})
        : { componentTokens: {} as Record<string, number>, totalTokens: 0 };

      const analytics: AnalyticsExport["componentComparison"][number] = {
        fileId: conv.id,
        filename: conv.filename,
        totalTokens,
        turnCount:
          conv.conversation?.messages.filter((m) => m.role === "user").length || 0,
        messageCount: conv.conversation?.messages.length || 0,
        componentTokens,
      };
      if (conv.title) {
        analytics.title = conv.title;
      }
      return analytics;
    }),
  };
}

export function buildSessionExport(
  conversations: PipelineState[],
  groups?: Record<string, Group>,
): SessionExport {
  const individualFiles = conversations.filter(
    (c) => c.conversation,
  );

  const groupList = groups ? Object.values(groups) : [];

  const data = {
    version: "1.0" as const,
    exportedAt: new Date().toISOString(),
    files: individualFiles.map(buildFileExport),
    groups: groupList.map((g) => {
      const group: { id: string; name: string; title?: string; fileIds: string[] } = {
        id: g.id,
        name: g.name,
        fileIds: g.fileIds,
      };
      if (g.title) {
        group.title = g.title;
      }
      return group;
    }),
    analytics: buildAnalytics(individualFiles),
  };

  return SessionExportSchema.parse(data);
}

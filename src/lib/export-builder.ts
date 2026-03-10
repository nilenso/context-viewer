import type { Conversation } from "@/schema";
import type { ConversationMetadata } from "@/parser";
import type { DimensionData } from "@/componentisation";
import {
  SessionExportSchema,
  type SessionExport,
  type FileExport,
  type AnalyticsExport,
  type ExportConversation,
  type ExportDimension,
  type ExportPart,
} from "./export-schema";

/**
 * Minimal WorkflowState interface for export building.
 * Matches the subset of fields we need from the full WorkflowState in App.tsx.
 */
interface WorkflowState {
  id: string;
  filename: string;
  title?: string; // Custom display title
  status?: "pending" | "processing" | "success" | "failed" | "paused-for-api-key";
  conversation?: Conversation;
  componentMapping?: Record<string, string>;
  componentColors?: Record<string, string>;
  aiSummary?: string;
  analysis?: string;
  metadata?: ConversationMetadata;
  isGrouped?: boolean;
  sourceConversations?: Array<{ id: string; filename: string; title?: string }>;
  dimensions?: Record<string, DimensionData>;
  // Custom prompts
  customPrompt?: string;
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  customColoringPrompt?: string;
}

/**
 * Build conversation with component embedded in each part
 */
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
        // Embed per-dimension component mappings when multiple dimensions exist
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

/**
 * Build export data for a single file/conversation
 */
export function buildFileExport(conv: WorkflowState): FileExport {
  if (!conv.conversation) {
    throw new Error(`Cannot export conversation ${conv.id}: no conversation data`);
  }

  const conversationWithComponents = buildConversationWithComponents(
    conv.conversation,
    conv.componentMapping,
    conv.dimensions,
  );

  // Build custom prompts object only if any prompts are customized
  const customPrompts = conv.customPrompt || conv.customSegmentationPrompt ||
    conv.customSummaryPrompt || conv.customAnalysisPrompt || conv.customColoringPrompt
    ? {
        componentIdentification: conv.customPrompt,
        segmentation: conv.customSegmentationPrompt,
        summary: conv.customSummaryPrompt,
        analysis: conv.customAnalysisPrompt,
        coloring: conv.customColoringPrompt,
      }
    : undefined;

  // Build per-dimension export data when multiple dimensions exist
  let dimensionsExport: Record<string, ExportDimension> | undefined;
  if (conv.dimensions && Object.keys(conv.dimensions).length > 1) {
    dimensionsExport = {};
    for (const [dimName, dim] of Object.entries(conv.dimensions)) {
      dimensionsExport[dimName] = {
        components: dim.components,
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
    colors: conv.componentColors || {},
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

/**
 * Build analytics data from conversations
 */
function buildAnalytics(conversations: WorkflowState[]): AnalyticsExport {
  return {
    componentComparison: conversations.map((conv) => {
      const componentTokens: Record<string, number> = {};
      let totalTokens = 0;

      conv.conversation?.messages.forEach((msg) => {
        msg.parts.forEach((part) => {
          const tokens = ("token_count" in part && part.token_count) || 0;
          const component = conv.componentMapping?.[part.id] || "other";
          componentTokens[component] = (componentTokens[component] || 0) + tokens;
          totalTokens += tokens;
        });
      });

      const analytics: AnalyticsExport["componentComparison"][number] = {
        fileId: conv.id,
        filename: conv.filename,
        totalTokens,
        turnCount:
          conv.conversation?.messages.filter((m) => m.role === "user").length ||
          0,
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

/**
 * Build complete session export from all conversations
 */
export function buildSessionExport(
  conversations: WorkflowState[],
): SessionExport {
  // Only include successfully processed individual files (not grouped)
  const individualFiles = conversations.filter(
    (c) => !c.isGrouped && c.status === "success" && c.conversation,
  );

  // Get grouped conversations
  const groups = conversations.filter((c) => c.isGrouped);

  const data = {
    version: "1.0" as const,
    exportedAt: new Date().toISOString(),
    files: individualFiles.map(buildFileExport),
    groups: groups.map((g) => {
      const group: { id: string; name: string; title?: string; fileIds: string[] } = {
        id: g.id,
        name: g.filename,
        fileIds: g.sourceConversations?.map((s) => s.id) || [],
      };
      if (g.title) {
        group.title = g.title;
      }
      return group;
    }),
    analytics: buildAnalytics(individualFiles),
  };

  // Validate against schema (catches bugs during development)
  return SessionExportSchema.parse(data);
}

/**
 * Download export data as a JSON file
 */
export function downloadExport(data: SessionExport): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `context-viewer-export-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

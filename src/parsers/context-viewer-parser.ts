import type { Parser, ConversationMetadata } from "@/parser";
import type { Conversation, Message } from "@/schema";
import { FileExportSchema } from "@/lib/export-schema";

/**
 * Parser for Context Viewer export format (FileExport).
 * Handles re-importing previously exported conversations with their
 * pre-computed component data, colors, summaries, and analysis.
 */
export class ContextViewerParser implements Parser {
  name = "Context Viewer";

  canParse(data: unknown): boolean {
    // Check if data matches FileExport schema
    const result = FileExportSchema.safeParse(data);
    return result.success;
  }

  parse(data: unknown): Conversation {
    const file = FileExportSchema.parse(data);

    // Convert ExportConversation to Conversation
    // Parts already have component field from export - workflow will extract mapping
    return {
      messages: file.conversation.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        timestamp: msg.timestamp,
        parts: msg.parts,
      })),
    } as Conversation;
  }

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    const file = FileExportSchema.parse(data);
    return {
      model: file.metadata?.model,
      title: file.title,
      // Carry pre-computed data in metadata
      componentColors: file.colors,
      aiSummary: file.summary ?? undefined,
      analysis: file.analysis ?? undefined,
      // Restore custom prompts
      customPrompt: file.customPrompts?.componentIdentification,
      customSegmentationPrompt: file.customPrompts?.segmentation,
      customSummaryPrompt: file.customPrompts?.summary,
      customAnalysisPrompt: file.customPrompts?.analysis,
      customColoringPrompt: file.customPrompts?.coloring,
    };
  }
}

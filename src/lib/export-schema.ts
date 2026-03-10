import { z } from "zod";

// ============================================================================
// Part with Component (extends base parts with component annotation)
// ============================================================================

export const ExportPartSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    token_count: z.number().optional(),
    component: z.string().optional(), // The component this part maps to (legacy/default dimension)
    dimensions: z.record(z.string(), z.string()).optional(), // Multi-dimension: dimName -> component
  })
  .passthrough(); // Allow additional fields (text, toolName, input, output, etc.)

export const ExportMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  timestamp: z.string().optional(),
  parts: z.array(ExportPartSchema),
});

export const ExportConversationSchema = z.object({
  messages: z.array(ExportMessageSchema),
});

// ============================================================================
// Metadata
// ============================================================================

export const ExportMetadataSchema = z.object({
  parserName: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
});

// ============================================================================
// File Export
// ============================================================================

// ============================================================================
// Custom Prompts
// ============================================================================

export const CustomPromptsSchema = z.object({
  componentIdentification: z.string().optional(),
  segmentation: z.string().optional(),
  summary: z.string().optional(),
  analysis: z.string().optional(),
  coloring: z.string().optional(),
});

// Per-dimension export data
export const ExportDimensionSchema = z.object({
  components: z.array(z.string()),
  colors: z.record(z.string(), z.string()),
  prompt: z.string().optional(),
  coloringPrompt: z.string().optional(),
});

export const FileExportSchema = z.object({
  id: z.string(),
  filename: z.string(),
  title: z.string().optional(), // Custom display title
  conversation: ExportConversationSchema,
  colors: z.record(z.string(), z.string()), // component -> color (legacy/default dimension)
  summary: z.string().nullable(),
  analysis: z.string().nullable(),
  metadata: ExportMetadataSchema.optional(),
  customPrompts: CustomPromptsSchema.optional(),
  dimensions: z.record(z.string(), ExportDimensionSchema).optional(), // Multi-dimension data
});

// ============================================================================
// Group Export
// ============================================================================

export const GroupExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().optional(), // Custom display title for the group
  fileIds: z.array(z.string()), // References to FileExport.id
});

// ============================================================================
// Analytics Export
// ============================================================================

export const FileAnalyticsSchema = z.object({
  fileId: z.string(),
  filename: z.string(),
  title: z.string().optional(), // Custom display title
  totalTokens: z.number(),
  turnCount: z.number(),
  messageCount: z.number(),
  componentTokens: z.record(z.string(), z.number()),
});

export const AnalyticsExportSchema = z.object({
  componentComparison: z.array(FileAnalyticsSchema),
});

// ============================================================================
// Session Export (top-level)
// ============================================================================

export const SessionExportSchema = z.object({
  version: z.literal("1.0"),
  exportedAt: z.string(),
  files: z.array(FileExportSchema),
  groups: z.array(GroupExportSchema),
  analytics: AnalyticsExportSchema,
});

// ============================================================================
// Type Exports
// ============================================================================

export type ExportPart = z.infer<typeof ExportPartSchema>;
export type ExportMessage = z.infer<typeof ExportMessageSchema>;
export type ExportConversation = z.infer<typeof ExportConversationSchema>;
export type ExportMetadata = z.infer<typeof ExportMetadataSchema>;
export type CustomPrompts = z.infer<typeof CustomPromptsSchema>;
export type ExportDimension = z.infer<typeof ExportDimensionSchema>;
export type FileExport = z.infer<typeof FileExportSchema>;
export type GroupExport = z.infer<typeof GroupExportSchema>;
export type FileAnalytics = z.infer<typeof FileAnalyticsSchema>;
export type AnalyticsExport = z.infer<typeof AnalyticsExportSchema>;
export type SessionExport = z.infer<typeof SessionExportSchema>;

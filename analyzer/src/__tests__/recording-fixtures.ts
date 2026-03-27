/**
 * Ground truth data extracted from session recordings.
 *
 * These are the exact return values of AI-calling functions as captured
 * during real browser sessions. They serve as both:
 *   1. Mock return values for generateText (reverse-engineered from function results)
 *   2. Expected assertions for function outputs
 *
 * Source: test-recordings/compaction-single-passthrough.json
 */

// ---------------------------------------------------------------------------
// post-compaction-1.jsonl — 1 message, 22 parts after segmentation
// ---------------------------------------------------------------------------

/**
 * Recording [33]: mapComponentsToIds result for post-compaction-1
 * Maps part IDs (after segmentation: 4.1–4.22) to component names.
 *
 * NOTE: Part IDs in tests will differ from "4.X" because the global ID
 * counter starts fresh. We use this as the AI mock response and verify
 * the function produces the right mapping shape.
 */
export const PC1_MAP_COMPONENTS_RESULT: Record<string, string> = {
  "4.1": "context_viewer_app",
  "4.2": "context_viewer_app",
  "4.3": "componentisation_dimensions",
  "4.4": "dimension_data_model",
  "4.5": "files_src_app_tsx",
  "4.6": "files_src_componentisation",
  "4.7": "files_src_component_colors",
  "4.8": "files_src_app_tsx",
  "4.9": "files_components_workflowmodal",
  "4.10": "files_components_conversationlist",
  "4.11": "ComponentsView checkboxes",
  "4.12": "files_components_conversationview",
  "4.13": "files_components_messagepartview",
  "4.14": "files_components_messageview",
  "4.15": "files_components_componentcomparison",
  "4.16": "errors_duplicate_cn_import",
  "4.17": "parallel_dimension_processing",
  "4.18": "single_blended_waffle",
  "4.19": "pending_tasks_update",
  "4.20": "per_dimension_waffle_fix",
  "4.21": "optional_next_step",
  "4.22": "workflow_runner_state",
};

/**
 * Recording [35]: assignComponentColors result for post-compaction-1
 * Complete color mapping for all 51 components.
 */
export const PC1_COLORS: Record<string, string> = {
  "context_viewer_app": "#60a5fa",
  "conversation_components": "#22d3ee",
  "componentisation_dimensions": "#34d399",
  "dimension_default_handling": "#f97316",
  "dimension_data_model": "#c084fc",
  "DimensionData interface": "#8b5cf6",
  "dimension_prompt_editing": "#fb7185",
  "target_dimension_rerender": "#2dd4bf",
  "parallel_dimension_processing": "#38bdf8",
  "Promise all activities": "#818cf8",
  "workflow_state_dimensions": "#94a3b8",
  "ComponentPromptChanged event": "#a3e635",
  "legacy_field_sync": "#fbbf24",
  "sync_legacy_default": "#f59e0b",
  "rename_default_dimension": "#e879f9",
  "components_tab_selector": "#60a5fa",
  "active_dimensions_state": "#22d3ee",
  "dimension_management_ui": "#34d399",
  "WorkflowDetailModal accordion": "#c084fc",
  "Find components step": "#f97316",
  "ConversationList dimensions": "#38bdf8",
  "ComponentsView checkboxes": "#2dd4bf",
  "ConversationView filters": "#8b5cf6",
  "component_filter_all_dimensions": "#818cf8",
  "rgb_color_blending": "#22d3ee",
  "blendColors utility": "#2dd4bf",
  "waffle_chart_display": "#fbbf24",
  "single_blended_waffle": "#fb7185",
  "multi_column_legend": "#a3e635",
  "token_count_percentage_legend": "#f97316",
  "color_swatches_rendering": "#c084fc",
  "message_part_badges": "#60a5fa",
  "dimension_badges_display": "#34d399",
  "component_comparison_extension": "#8b5cf6",
  "ConversationComponentData dimension": "#94a3b8",
  "workflow_runner_state": "#818cf8",
  "startStep updateState": "#2dd4bf",
  "markComplete propagation": "#34d399",
  "errors_duplicate_cn_import": "#fb7185",
  "ts_preexisting_errors": "#94a3b8",
  "accordion_wrong_place": "#f97316",
  "per_dimension_waffle_fix": "#a3e635",
  "files_src_app_tsx": "#60a5fa",
  "files_src_component_colors": "#c084fc",
  "files_src_componentisation": "#34d399",
  "files_components_workflowmodal": "#8b5cf6",
  "files_components_conversationlist": "#38bdf8",
  "files_components_componentsview": "#2dd4bf",
  "files_components_conversationview": "#22d3ee",
  "files_components_messagepartview": "#fbbf24",
  "files_components_messageview": "#f97316",
  "files_components_componentcomparison": "#818cf8",
  "pending_tasks_update": "#a3e635",
  "optional_next_step": "#f59e0b",
};

// ---------------------------------------------------------------------------
// segment-1.jsonl — 338 messages, 459 parts
// ---------------------------------------------------------------------------

/** Recording [26]: identifyComponents result for segment-1 (49 components) */
export const SEG1_COMPONENTS: string[] = [
  "multi_dimension_componentisation",
  "dimension_data_model",
  "component_mapping_by_dimension",
  "per_dimension_llm_calls",
  "selective_reprocessing_dimensions",
  "prompt_editor_dimension_names",
  "accordion_dimension_management",
  "sidebar_dimension_controls",
  "components_view_dimension_filters",
  "checkbox_active_dimensions",
  "waffle_chart_static_dimensions",
  "multi_dimension_waffle_legend",
  "dimension_color_schemes",
  "blended_color_pure_function",
  "color_blending_rgb_average",
  "component_legend_multi_columns",
  "color_merge_component_pairs",
  "workflow_state_dimensions",
  "target_dimension_processing",
  "component_colours_utilities",
  "blend_colors_function",
  "get_blended_color_part",
  "workflow_runner_state_propagation",
  "find_components_activity_dimensions",
  "assign_colors_activity_dimensions",
  "WorkflowDetailModal_steps_ui",
  "conversation_list_dimension_accordion",
  "components_view_component_sections",
  "conversation_view_dimension_props",
  "message_view_dimension_badges",
  "message_part_view_dimension_badges",
  "component_comparison_dimensions_support",
  "conversation_component_data",
  "pipeline_phase_data_model",
  "pipeline_phase_ui_updates",
  "legacy_default_dimension_sync",
  "migration_legacy_fields",
  "static_componentise_support",
  "export_builder_dimensions",
  "context_viewer_parser_dimensions",
  "ai_summary_updates",
  "typescript_compilation_errors",
  "vite_build_verification",
  "git_commit_first_cut",
  "git_staged_changes",
  "workflow_detail_modal_dimension_props",
  "remove_dimension_accordion_components_view",
  "duplicate_cn_import_cleanup",
  "move_dimension_accordion_modal",
];

/** Recording [40]: assignComponentColors result for segment-1 (49 colors) */
export const SEG1_COLORS: Record<string, string> = {
  "multi_dimension_componentisation": "#f97316",
  "dimension_data_model": "#60a5fa",
  "component_mapping_by_dimension": "#34d399",
  "per_dimension_llm_calls": "#818cf8",
  "selective_reprocessing_dimensions": "#22d3ee",
  "prompt_editor_dimension_names": "#c084fc",
  "accordion_dimension_management": "#fbbf24",
  "sidebar_dimension_controls": "#2dd4bf",
  "components_view_dimension_filters": "#38bdf8",
  "checkbox_active_dimensions": "#a3e635",
  "waffle_chart_static_dimensions": "#fb7185",
  "multi_dimension_waffle_legend": "#8b5cf6",
  "dimension_color_schemes": "#94a3b8",
  "blended_color_pure_function": "#f97316",
  "color_blending_rgb_average": "#34d399",
  "component_legend_multi_columns": "#60a5fa",
  "color_merge_component_pairs": "#c084fc",
  "workflow_state_dimensions": "#22d3ee",
  "target_dimension_processing": "#818cf8",
  "component_colours_utilities": "#94a3b8",
  "blend_colors_function": "#2dd4bf",
  "get_blended_color_part": "#fbbf24",
  "workflow_runner_state_propagation": "#38bdf8",
  "find_components_activity_dimensions": "#a3e635",
  "assign_colors_activity_dimensions": "#fb7185",
  "WorkflowDetailModal_steps_ui": "#8b5cf6",
  "conversation_list_dimension_accordion": "#f97316",
  "components_view_component_sections": "#60a5fa",
  "conversation_view_dimension_props": "#34d399",
  "message_view_dimension_badges": "#22d3ee",
  "message_part_view_dimension_badges": "#c084fc",
  "component_comparison_dimensions_support": "#818cf8",
  "conversation_component_data": "#2dd4bf",
  "pipeline_phase_data_model": "#38bdf8",
  "pipeline_phase_ui_updates": "#fbbf24",
  "legacy_default_dimension_sync": "#94a3b8",
  "migration_legacy_fields": "#f97316",
  "static_componentise_support": "#60a5fa",
  "export_builder_dimensions": "#34d399",
  "context_viewer_parser_dimensions": "#c084fc",
  "ai_summary_updates": "#22d3ee",
  "typescript_compilation_errors": "#fb7185",
  "vite_build_verification": "#818cf8",
  "git_commit_first_cut": "#fbbf24",
  "git_staged_changes": "#a3e635",
  "workflow_detail_modal_dimension_props": "#38bdf8",
  "remove_dimension_accordion_components_view": "#2dd4bf",
  "duplicate_cn_import_cleanup": "#8b5cf6",
  "move_dimension_accordion_modal": "#94a3b8",
};

/**
 * Recording [38]: first 10 entries of mapComponentsToIds for segment-1.
 * The full result has 460 entries (100 shown + "360 more keys").
 * We use these for spot-checking.
 */
export const SEG1_MAP_FIRST_ENTRIES: Record<string, string> = {
  "6": "multi_dimension_componentisation",
  "8": "legacy_default_dimension_sync",
  "10": "multi_dimension_componentisation",
  "11": "workflow_runner_state_propagation",
  "12": "workflow_state_dimensions",
  "13": "find_components_activity_dimensions",
  "16": "ai_summary_updates",
  "17": "target_dimension_processing",
  "18": "context_viewer_parser_dimensions",
  "19": "components_view_component_sections",
};

// ===========================================================================
// Source: test-recordings/compaction-everything.json
//
// This recording captures a multi-step workflow:
//   [0]     processFileDrop (same 2 files)
//   [41-55] applySegmentationPrompt → re-segment → re-identify → re-classify → re-color
//   [56-69] applyPrompt (1st custom) → re-identify → re-classify → re-color
//   [70-83] applyPrompt (2nd custom) → re-identify → re-classify → re-color (12 components)
//   [84-94] applyPromptsToAll → idempotent identify → classify → idempotent color
//   [95]    groupConversations
// ===========================================================================

// ---------------------------------------------------------------------------
// Flow 1: After re-segmentation, initial identification [50]
// ---------------------------------------------------------------------------

/**
 * Everything [50]: identifyComponents after re-segmentation.
 * 67 parts now (was 15 before). AI returns different components.
 * Truncated in recording ("...[32 more items]"); we use the 50 shown.
 */
export const EV_RESEG_COMPONENTS: string[] = [
  "context viewer", "conversation segments", "multi dimensional components",
  "dimension data model", "DimensionData interface", "dimension prompts editing",
  "dimension prompt reprocessing", "target dimension workflow",
  "parallel dimension processing", "Promise all processing",
  "workflow state targetDimension", "legacy field synchronization",
  "default dimension mapping", "rename default dimension",
  "dimensions ensureDimensions", "syncLegacyFieldsFromDimensions",
  "backward compatibility legacy", "color blending RGB averaging",
];

/** Everything [55]: assignComponentColors after re-segmentation (partial — first 18) */
export const EV_RESEG_COLORS: Record<string, string> = {
  "context viewer": "#38bdf8",
  "conversation segments": "#60a5fa",
  "multi dimensional components": "#22d3ee",
  "dimension data model": "#34d399",
  "DimensionData interface": "#2dd4bf",
  "dimension prompts editing": "#c084fc",
  "dimension prompt reprocessing": "#8b5cf6",
  "target dimension workflow": "#f97316",
  "parallel dimension processing": "#fbbf24",
  "Promise all processing": "#a3e635",
  "workflow state targetDimension": "#818cf8",
  "legacy field synchronization": "#94a3b8",
  "default dimension mapping": "#fbbf24",
  "rename default dimension": "#fb7185",
  "dimensions ensureDimensions": "#2dd4bf",
  "syncLegacyFieldsFromDimensions": "#60a5fa",
  "backward compatibility legacy": "#94a3b8",
  "color blending RGB averaging": "#fb7185",
};

// ---------------------------------------------------------------------------
// Flow 2: First custom prompt [64, 67, 69]
// ---------------------------------------------------------------------------

/** Everything [64]: identifyComponents with first custom prompt (51 components, truncated to 50) */
export const EV_PROMPT1_COMPONENTS: string[] = [
  "multi-dimensional componentisation", "conversation context viewer",
  "dimension data model", "DimensionData interface",
  "dimension prompt editing", "dimension lifecycle management",
  "dimension parallel LLM", "identify to map",
  "map and assign colors", "WorkflowState targetDimension",
  "ComponentPromptChanged event", "activeDimensions state tracking",
  "legacy field compatibility", "syncLegacyFields dimensions",
  "ensureDimensions default key", "rename default dimension",
  "components filter all dimensions", "RGB color blending",
];

/** Everything [67]: mapComponentsToIds with first custom prompt — first 3 entries */
export const EV_PROMPT1_MAP_SAMPLE: Record<string, string> = {
  "4.1": "conversation context viewer",
  "4.2": "conversation context viewer",
  "4.3": "multi-dimensional componentisation",
};

/** Everything [69]: assignComponentColors with first custom prompt (partial) */
export const EV_PROMPT1_COLORS: Record<string, string> = {
  "multi-dimensional componentisation": "#8b5cf6",
  "conversation context viewer": "#38bdf8",
  "dimension data model": "#60a5fa",
  "DimensionData interface": "#818cf8",
  "dimension prompt editing": "#c084fc",
  "dimension lifecycle management": "#2dd4bf",
  "dimension parallel LLM": "#22d3ee",
  "identify to map": "#fbbf24",
  "map and assign colors": "#f97316",
  "WorkflowState targetDimension": "#34d399",
  "ComponentPromptChanged event": "#fb7185",
  "activeDimensions state tracking": "#a3e635",
  "legacy field compatibility": "#94a3b8",
  "syncLegacyFields dimensions": "#94a3b8",
  "ensureDimensions default key": "#fbbf24",
  "rename default dimension": "#f97316",
  "components filter all dimensions": "#34d399",
  "RGB color blending": "#22d3ee",
};

// ---------------------------------------------------------------------------
// Flow 3: Third prompt edit — concise 12 components [78, 81, 83]
// This is the final state that gets applied to all files.
// ---------------------------------------------------------------------------

/** Everything [78]: identifyComponents with third custom prompt — 12 components exactly */
export const EV_PROMPT3_COMPONENTS: string[] = [
  "multi_dimensional componentisation",
  "DimensionData interface modeling",
  "per_dimension LLM pipelines",
  "workflow target_dimension reprocessing",
  "legacy default dimension sync",
  "color blending RGB averaging",
  "ComponentsView waffle visualization",
  "multi_column legend statistics",
  "dimension management UI modal",
  "conversation component filtering",
  "dimension rename default handling",
  "React state dimensions propagation",
];

/** Everything [81]: mapComponentsToIds with third prompt — complete 67-entry mapping */
export const EV_PROMPT3_MAP: Record<string, string> = {
  "4.1": "multi_dimensional componentisation",
  "4.2": "multi_dimensional componentisation",
  "4.3": "multi_dimensional componentisation",
  "4.4": "DimensionData interface modeling",
  "4.5.1": "DimensionData interface modeling",
  "4.5.2": "DimensionData interface modeling",
  "4.5.3": "DimensionData interface modeling",
  "4.5.4": "DimensionData interface modeling",
  "4.5.5": "DimensionData interface modeling",
  "4.5.6": "DimensionData interface modeling",
  "4.5.7": "DimensionData interface modeling",
  "4.5.8": "DimensionData interface modeling",
  "4.5.9": "DimensionData interface modeling",
  "4.5.10": "DimensionData interface modeling",
  "4.5.11": "DimensionData interface modeling",
  "4.5.12": "DimensionData interface modeling",
  "4.5.13": "DimensionData interface modeling",
  "4.5.14": "DimensionData interface modeling",
  "4.5.15": "DimensionData interface modeling",
  "4.5.16": "color blending RGB averaging",
  "4.5.17": "color blending RGB averaging",
  "4.5.18": "color blending RGB averaging",
  "4.5.19": "legacy default dimension sync",
  "4.5.20": "color blending RGB averaging",
  "4.5.21": "color blending RGB averaging",
  "4.5.22": "color blending RGB averaging",
  "4.5.23": "color blending RGB averaging",
  "4.5.24": "color blending RGB averaging",
  "4.5.25": "color blending RGB averaging",
  "4.5.26": "color blending RGB averaging",
  "4.5.27": "color blending RGB averaging",
  "4.5.28": "color blending RGB averaging",
  "4.5.29": "color blending RGB averaging",
  "4.5.30": "React state dimensions propagation",
  "4.5.31": "React state dimensions propagation",
  "4.5.32": "legacy default dimension sync",
  "4.5.33": "legacy default dimension sync",
  "4.5.34": "multi_dimensional componentisation",
  "4.5.35": "workflow target_dimension reprocessing",
  "4.5.36": "dimension management UI modal",
  "4.5.37": "dimension management UI modal",
  "4.5.38": "dimension management UI modal",
  "4.5.39": "dimension management UI modal",
  "4.5.40": "React state dimensions propagation",
  "4.5.41": "React state dimensions propagation",
  "4.5.42": "dimension management UI modal",
  "4.5.43": "dimension management UI modal",
  "4.5.44": "dimension management UI modal",
  "4.5.45": "ComponentsView waffle visualization",
  "4.5.46": "dimension management UI modal",
  "4.5.47": "React state dimensions propagation",
  "4.5.48": "color blending RGB averaging",
  "4.5.49": "React state dimensions propagation",
  "4.5.50": "React state dimensions propagation",
  "4.5.51": "React state dimensions propagation",
  "4.5.52": "React state dimensions propagation",
  "4.5.53": "DimensionData interface modeling",
  "4.6": "legacy default dimension sync",
  "4.7": "multi_dimensional componentisation",
  "4.8": "multi_dimensional componentisation",
  "4.9": "legacy default dimension sync",
  "4.10": "ComponentsView waffle visualization",
  "4.11": "workflow target_dimension reprocessing",
  "4.12": "multi_column legend statistics",
  "4.13": "dimension rename default handling",
  "4.14": "conversation component filtering",
  "4.15": "workflow target_dimension reprocessing",
};

/** Everything [83]: assignComponentColors with third prompt — 12 colors exactly */
export const EV_PROMPT3_COLORS: Record<string, string> = {
  "multi_dimensional componentisation": "#f97316",
  "DimensionData interface modeling": "#60a5fa",
  "per_dimension LLM pipelines": "#818cf8",
  "workflow target_dimension reprocessing": "#22d3ee",
  "legacy default dimension sync": "#94a3b8",
  "color blending RGB averaging": "#34d399",
  "ComponentsView waffle visualization": "#fbbf24",
  "multi_column legend statistics": "#38bdf8",
  "dimension management UI modal": "#c084fc",
  "conversation component filtering": "#2dd4bf",
  "dimension rename default handling": "#fb7185",
  "React state dimensions propagation": "#a3e635",
};

// ---------------------------------------------------------------------------
// Flow 4: applyPromptsToAll [84] — applies prompt3 state to segment-1
// ---------------------------------------------------------------------------

/**
 * Everything [84] storeDiff: the components and colors copied to conversation "2".
 * These are the same as EV_PROMPT3_COMPONENTS and EV_PROMPT3_COLORS —
 * applyPromptsToAll copies them from source.
 */
export const EV_APPLY_ALL_TARGET_COMPONENTS = EV_PROMPT3_COMPONENTS;
export const EV_APPLY_ALL_TARGET_COLORS = EV_PROMPT3_COLORS;

// ---------------------------------------------------------------------------
// Segmentation patterns for post-compaction-1.jsonl
// ---------------------------------------------------------------------------

/**
 * Regex lookahead patterns that split post-compaction-1's single 12425-char
 * text part into 22 sub-parts matching recording [15].
 *
 * These are the patterns the AI would have returned from the segmentation
 * prompt. Each is a positive lookahead on the natural section boundary
 * (numbered headings, file path bullets, final instruction).
 *
 * Verified: applying these to the actual file content produces exactly
 * 22 non-empty parts whose text matches the recording's part texts.
 */
export const PC1_SEGMENTATION_PATTERNS: string[] = [
  "(?=Summary:)",
  "(?=1\\. Primary Request and Intent:)",
  "(?=2\\. Key Technical Concepts:)",
  "(?=3\\. Files and Code Sections:)",
  "(?=- \\*\\*`src/componentisation\\.ts`\\*\\*)",
  "(?=- \\*\\*`src/lib/component-colors\\.ts`\\*\\*)",
  "(?=- \\*\\*`src/App\\.tsx`\\*\\*)",
  "(?=- \\*\\*`src/components/WorkflowDetailModal\\.tsx`\\*\\*)",
  "(?=- \\*\\*`src/components/ConversationList\\.tsx`\\*\\*)",
  "(?=- \\*\\*`src/components/ComponentsView\\.tsx`\\*\\*)",
  "(?=- \\*\\*`src/components/ConversationView\\.tsx`\\*\\*)",
  "(?=- \\*\\*`src/components/MessagePartView\\.tsx`\\*\\*)",
  "(?=- \\*\\*`src/components/MessageView\\.tsx`\\*\\*)",
  "(?=- \\*\\*`src/components/ComponentComparisonView\\.tsx`\\*\\*)",
  "(?=4\\. Errors and fixes:)",
  "(?=5\\. Problem Solving:)",
  "(?=6\\. All user messages:)",
  "(?=7\\. Pending Tasks:)",
  "(?=8\\. Current Work:)",
  "(?=9\\. Optional Next Step:)",
  "(?=Continue the conversation from where it left off)",
];

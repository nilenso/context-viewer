# Dimension-scoped pipeline design

## Two layers

The pipeline has two layers:

1. **Conversation-level** (shared across all dimensions): Parse → CountTokens → Segment
2. **Dimension-level** (independent per dimension): Identify → Classify → Color

## Dimensions are self-contained

`DimensionData` owns everything about a dimension: prompt, custom components, component list, mapping, timeline, colors, coloring prompt. No top-level duplicates on `WorkflowState`.

Top-level prompt fields that remain on `WorkflowState` are only for conversation-level concerns: `customSegmentationPrompt`, `segmentationThreshold`, `customSummaryPrompt`, `customAnalysisPrompt`.

## When something changes, only the affected scope runs

| What changed                       | Scope              | What reruns                                              |
| ---------------------------------- | ------------------ | -------------------------------------------------------- |
| Segmentation prompt                | Conversation       | Segment → all dimensions (Identify → Classify → Color)  |
| Identification prompt for dim X    | Dimension X only   | Identify → Classify → Color for X                       |
| Coloring prompt for dim X          | Dimension X only   | Color for X                                             |
| "Apply prompts to all"             | Per-conv, per-dim  | Copies dimension prompts to targets, reruns from earliest changed step per dimension |

## Mechanism

`runPipelineFrom` and the step runners (Identify, Classify, Color) accept an optional `dimNames?: string[]` parameter. When provided, only those dimensions are processed. When omitted, all dimensions run (new files, post-segmentation).

## "Apply prompts to all"

Reads prompts, components, and colors from the source conversation's dimensions (not top-level fields). Copies them into matching dimensions on each target conversation. Diffs to find the earliest changed step per dimension and reprocesses only what changed.

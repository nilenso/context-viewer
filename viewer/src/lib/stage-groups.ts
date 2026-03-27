/**
 * StageGroup — coarser pipeline checkpoints shown in the UI.
 * "finding-components" groups identify + classify + color.
 */
export type StageGroup =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "summarizing"
  | "finding-components"
  | "coloring"
  | "analyzing";

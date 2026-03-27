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

/**
 * Map a pipeline Stage name (from the analyzer) to a UI StageGroup.
 * The analyzer uses fine-grained names like "identifying-components" and
 * "classifying-components", which the UI groups under "finding-components".
 */
export function stageToGroup(stage: string | undefined): StageGroup | undefined {
  if (!stage) return undefined;
  switch (stage) {
    case "identifying-components":
    case "classifying-components":
      return "finding-components";
    default:
      return stage as StageGroup;
  }
}

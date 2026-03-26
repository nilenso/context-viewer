/**
 * Tests for parseFileDropInput.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [1] parseFileDropInput([post-compaction-1.jsonl, segment-1.jsonl])
 *       → filesToProcess: 2 files, oldIdToIndex: empty, sessionGroups: []
 */
import { describe, it, expect } from "vitest";
import { parseFileDropInput } from "@/parsers/file-import";
import { loadArtifact } from "@/__tests__/helpers";

describe("parseFileDropInput", () => {
  it("matches recording [1]: two JSONL files pass through unchanged", async () => {
    const f1 = loadArtifact("post-compaction-1.jsonl").file;
    const f2 = loadArtifact("segment-1.jsonl").file;

    const result = await parseFileDropInput([f1, f2]);

    // Recording [1]: filesToProcess has 2 files, no session import
    expect(result.filesToProcess.length).toBe(2);
    expect(result.filesToProcess[0]!.name).toBe("post-compaction-1.jsonl");
    expect(result.filesToProcess[1]!.name).toBe("segment-1.jsonl");
    expect(result.oldIdToIndex.size).toBe(0);
    expect(result.sessionGroups).toEqual([]);
  });

  it("detects session exports and expands into virtual files", async () => {
    const sessionExport = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      files: [
        { id: "old-1", filename: "a.jsonl", conversation: { messages: [] }, colors: {}, summary: null, analysis: null },
        { id: "old-2", filename: "b.jsonl", conversation: { messages: [] }, colors: {}, summary: null, analysis: null },
      ],
      groups: [{ id: "g1", name: "Group 1", fileIds: ["old-1", "old-2"] }],
      analytics: { componentComparison: [] },
    };

    const result = await parseFileDropInput([
      new File([JSON.stringify(sessionExport)], "session.json"),
    ]);

    expect(result.filesToProcess.length).toBe(2);
    expect(result.sessionGroups.length).toBe(1);
    expect(result.sessionGroups[0]!.name).toBe("Group 1");
    expect(result.oldIdToIndex.get("old-1")).toBe(0);
    expect(result.oldIdToIndex.get("old-2")).toBe(1);
  });

  it("handles invalid JSON .json files gracefully", async () => {
    const result = await parseFileDropInput([
      new File(["not valid json"], "broken.json"),
    ]);
    // Falls through to regular file processing
    expect(result.filesToProcess.length).toBe(1);
    expect(result.filesToProcess[0]!.name).toBe("broken.json");
  });
});

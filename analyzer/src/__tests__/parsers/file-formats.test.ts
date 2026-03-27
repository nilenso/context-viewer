/**
 * Tests for parseFileContent.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [9]  post-compaction-1.jsonl (textLength: 13112) → JSONL array of 1 object
 *   [16] segment-1.jsonl        (textLength: 6236268) → JSONL array of 765 objects
 */
import { describe, it, expect } from "vitest";
import { parseFileContent, SUPPORTED_EXTENSIONS } from "../../parsers/file-formats";
import { loadArtifact } from "../helpers";

describe("parseFileContent", () => {
  it("matches recording [9]: post-compaction-1.jsonl → array of 1 object", () => {
    const { text } = loadArtifact("post-compaction-1.jsonl");
    // Recording [9]: textLength = 13112
    expect(text.length).toBe(13112);

    const data = parseFileContent(text, "post-compaction-1.jsonl") as any[];
    // Recording [9]: result is a single-element array with Claude transcript fields
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0]).toHaveProperty("type", "user");
    expect(data[0]).toHaveProperty("message");
    expect(data[0]).toHaveProperty("isCompactSummary", true);
  });

  it("matches recording [16]: segment-1.jsonl → array of 765 objects", () => {
    const { text } = loadArtifact("segment-1.jsonl");

    const data = parseFileContent(text, "segment-1.jsonl") as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(765);
    // First entry is a file-history-snapshot (from recording [16])
    expect(data[0]).toHaveProperty("type", "file-history-snapshot");
  });

  it("parses .txt files as plain text", () => {
    const text = "Hello world";
    expect(parseFileContent(text, "readme.txt")).toBe(text);
  });

  it("parses .md files as plain text", () => {
    const text = "# Header";
    expect(parseFileContent(text, "doc.md")).toBe(text);
  });

  it("parses .json files as JSON", () => {
    const data = parseFileContent('{"a":1}', "test.json");
    expect(data).toEqual({ a: 1 });
  });

  it("parses .traj files as JSON", () => {
    const data = parseFileContent('{"b":2}', "test.traj");
    expect(data).toEqual({ b: 2 });
  });

  it("detects JSONL by content for unknown extensions", () => {
    const data = parseFileContent('{"a":1}\n{"b":2}', "data.unknown") as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseFileContent("not json {", "bad.json")).toThrow();
  });
});

describe("SUPPORTED_EXTENSIONS", () => {
  it("includes all expected types", () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(
      expect.arrayContaining([".txt", ".md", ".jsonl", ".json", ".traj"]),
    );
  });
});



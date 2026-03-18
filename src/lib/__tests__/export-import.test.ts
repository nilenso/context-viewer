import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  FileExportSchema,
  SessionExportSchema,
  type FileExport,
  type SessionExport,
} from "../export-schema";
import { buildFileExport, buildSessionExport } from "../export-builder";
import { ContextViewerParser } from "@/parsers/context-viewer-parser";

// Path to bundled test fixtures
const BUNDLED_FIXTURES_DIR = path.resolve(__dirname, "fixtures");

// Path to real export fixtures (optional, may not exist in CI)
const FIXTURES_DIR = path.resolve(
  __dirname,
  "../../../../long-prompts-analysis/context-viewer-exports",
);

function loadFixture(filename: string): unknown {
  const filepath = path.join(FIXTURES_DIR, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function hasFixtures(): boolean {
  return fs.existsSync(FIXTURES_DIR);
}

// ============================================================================
// Schema validation tests against real exports
// ============================================================================

describe("Export schema validation", () => {
  const sessionFiles = [
    "claude-prompt-evolution-export-simpler.json",
    "codex-prompt-evolution-export.json",
    "swapping-prompts-swe-tasks.json",
    "system-prompts-session-export.json",
  ];

  it.skipIf(!hasFixtures())(
    "validates all session export fixtures",
    () => {
      for (const file of sessionFiles) {
        const data = loadFixture(file);
        const result = SessionExportSchema.safeParse(data);
        expect(result.success, `${file} should validate as SessionExport: ${!result.success && result.error?.message}`).toBe(true);
      }
    },
  );

  it.skipIf(!hasFixtures())(
    "validates individual FileExport within sessions",
    () => {
      const data = loadFixture("claude-prompt-evolution-export-simpler.json") as SessionExport;
      expect(data.files.length).toBeGreaterThan(0);
      for (const file of data.files) {
        const result = FileExportSchema.safeParse(file);
        expect(result.success, `File ${file.id} should validate`).toBe(true);
      }
    },
  );

  it.skipIf(!hasFixtures())(
    "preserves component annotations on parts",
    () => {
      const data = loadFixture("claude-prompt-evolution-export-simpler.json") as SessionExport;
      const file = data.files[0]!;
      const partsWithComponents = file.conversation.messages.flatMap((m) =>
        m.parts.filter((p) => p.component),
      );
      expect(partsWithComponents.length).toBeGreaterThan(0);
    },
  );
});

// ============================================================================
// Parser round-trip tests
// ============================================================================

describe("ContextViewerParser", () => {
  const parser = new ContextViewerParser();

  it.skipIf(!hasFixtures())(
    "canParse recognizes FileExport format",
    () => {
      const session = loadFixture("claude-prompt-evolution-export-simpler.json") as SessionExport;
      const fileExport = session.files[0]!;
      expect(parser.canParse(fileExport)).toBe(true);
    },
  );

  it("canParse rejects non-FileExport data", () => {
    expect(parser.canParse({ foo: "bar" })).toBe(false);
    expect(parser.canParse(null)).toBe(false);
    expect(parser.canParse("string")).toBe(false);
  });

  it.skipIf(!hasFixtures())(
    "parse extracts conversation with correct structure",
    () => {
      const session = loadFixture("claude-prompt-evolution-export-simpler.json") as SessionExport;
      const fileExport = session.files[0]!;
      const conversation = parser.parse(fileExport);

      expect(conversation.messages).toBeDefined();
      expect(conversation.messages.length).toBe(fileExport.conversation.messages.length);
      // Parts should carry through the component field
      const firstPart = conversation.messages[0]!.parts[0]!;
      expect(firstPart.id).toBe(fileExport.conversation.messages[0]!.parts[0]!.id);
    },
  );

  it.skipIf(!hasFixtures())(
    "extractMetadata restores colors, summary, analysis, and prompts",
    () => {
      const session = loadFixture("claude-prompt-evolution-export-simpler.json") as SessionExport;
      const fileExport = session.files[0]!;
      const metadata = parser.extractMetadata(fileExport);

      expect(metadata.componentColors).toEqual(fileExport.colors);
      expect(metadata.aiSummary).toBe(fileExport.summary ?? undefined);
      expect(metadata.analysis).toBe(fileExport.analysis ?? undefined);
      if (fileExport.customPrompts) {
        expect(metadata.customPrompt).toBe(fileExport.customPrompts.componentIdentification);
      }
    },
  );
});

// ============================================================================
// Build + parse round-trip
// ============================================================================

describe("Export → Import round-trip", () => {
  it("round-trips a single-dimension conversation", () => {
    const workflowState = {
      id: "test-1",
      filename: "test.json",
      status: "success" as const,
      conversation: {
        messages: [
          {
            id: "msg-1",
            role: "user" as const,
            parts: [
              { id: "p1", type: "text" as const, text: "Hello", token_count: 5 },
              { id: "p2", type: "text" as const, text: "World", token_count: 3 },
            ],
          },
          {
            id: "msg-2",
            role: "assistant" as const,
            parts: [
              { id: "p3", type: "text" as const, text: "Hi there", token_count: 4 },
            ],
          },
        ],
      },
      dimensions: {
        default: {
          name: "default",
          components: ["greeting", "context", "response"],
          componentMapping: { p1: "greeting", p2: "context", p3: "response" },
          componentTimeline: [],
          componentColors: { greeting: "blue", context: "green", response: "red" },
          prompt: "Find components",
        },
      },
      aiSummary: "A simple greeting conversation",
      analysis: "Basic two-turn exchange",
    };

    // Export
    const exported = buildFileExport(workflowState);

    // Validate schema
    expect(FileExportSchema.safeParse(exported).success).toBe(true);

    // Verify structure
    expect(exported.id).toBe("test-1");
    expect(exported.colors).toEqual(workflowState.dimensions.default.componentColors);
    expect(exported.summary).toBe(workflowState.aiSummary);
    expect(exported.conversation.messages).toHaveLength(2);

    // Verify component annotations on parts
    const parts = exported.conversation.messages.flatMap((m) => m.parts);
    expect(parts.find((p) => p.id === "p1")?.component).toBe("greeting");
    expect(parts.find((p) => p.id === "p2")?.component).toBe("context");
    expect(parts.find((p) => p.id === "p3")?.component).toBe("response");

    // Import
    const parser = new ContextViewerParser();
    expect(parser.canParse(exported)).toBe(true);

    const conversation = parser.parse(exported);
    expect(conversation.messages).toHaveLength(2);

    const metadata = parser.extractMetadata(exported);
    expect(metadata.componentColors).toEqual(workflowState.dimensions.default.componentColors);
    expect(metadata.aiSummary).toBe(workflowState.aiSummary);
    expect(metadata.analysis).toBe(workflowState.analysis);
    expect(metadata.customPrompt).toBe(workflowState.dimensions.default.prompt);
  });

  it("round-trips a multi-dimension conversation", () => {
    const workflowState = {
      id: "test-multi",
      filename: "multi-dim.json",
      status: "success" as const,
      conversation: {
        messages: [
          {
            id: "msg-1",
            role: "system" as const,
            parts: [
              { id: "p1", type: "text" as const, text: "System prompt", token_count: 10 },
            ],
          },
          {
            id: "msg-2",
            role: "user" as const,
            parts: [
              { id: "p2", type: "text" as const, text: "Fix the bug", token_count: 20 },
              { id: "p3", type: "text" as const, text: "Here is the code", token_count: 50 },
            ],
          },
        ],
      },
      dimensions: {
        default: {
          name: "default",
          components: ["identity", "task_description", "project_context"],
          componentMapping: { p1: "identity", p2: "task_description", p3: "project_context" },
          componentTimeline: [],
          componentColors: { identity: "blue", task_description: "green", project_context: "orange" },
        },
        workflow: {
          name: "workflow",
          components: ["identity", "task_description", "project_context"],
          componentMapping: { p1: "identity", p2: "task_description", p3: "project_context" },
          componentTimeline: [],
          componentColors: { identity: "blue", task_description: "green", project_context: "orange" },
          prompt: "Identify workflow components",
        },
        error_types: {
          name: "error_types",
          components: ["setup", "bug_description", "code_reference"],
          componentMapping: { p1: "setup", p2: "bug_description", p3: "code_reference" },
          componentTimeline: [],
          componentColors: { setup: "gray", bug_description: "red", code_reference: "purple" },
          prompt: "Identify error-related components",
          customColoringPrompt: "Use warm colors for errors",
        },
      },
      aiSummary: "A bug-fixing conversation",
      analysis: null,
    };

    // Export
    const exported = buildFileExport(workflowState);

    // Validate schema
    expect(FileExportSchema.safeParse(exported).success).toBe(true);

    // Verify multi-dimension data is present
    expect(exported.dimensions).toBeDefined();
    expect(Object.keys(exported.dimensions!)).toEqual(["default", "workflow", "error_types"]);

    // Verify per-dimension data
    const workflowDim = exported.dimensions!["workflow"]!;
    expect(workflowDim.components).toEqual(["identity", "task_description", "project_context"]);
    expect(workflowDim.colors).toEqual(workflowState.dimensions.workflow.componentColors);
    expect(workflowDim.prompt).toBe("Identify workflow components");

    const errorDim = exported.dimensions!["error_types"]!;
    expect(errorDim.components).toEqual(["setup", "bug_description", "code_reference"]);
    expect(errorDim.prompt).toBe("Identify error-related components");
    expect(errorDim.coloringPrompt).toBe("Use warm colors for errors");

    // Verify per-part dimension annotations
    const allParts = exported.conversation.messages.flatMap((m) => m.parts);
    const p1 = allParts.find((p) => p.id === "p1")!;
    expect(p1.component).toBe("identity");
    expect(p1.dimensions).toEqual({ default: "identity", workflow: "identity", error_types: "setup" });

    const p2 = allParts.find((p) => p.id === "p2")!;
    expect(p2.dimensions).toEqual({ default: "task_description", workflow: "task_description", error_types: "bug_description" });

    // Colors should come from the default dimension
    expect(exported.colors).toEqual(workflowState.dimensions.default.componentColors);

    // Import
    const parser = new ContextViewerParser();
    expect(parser.canParse(exported)).toBe(true);

    const conversation = parser.parse(exported);
    expect(conversation.messages).toHaveLength(2);

    const metadata = parser.extractMetadata(exported);
    expect(metadata.componentColors).toEqual(workflowState.dimensions.default.componentColors);
    expect(metadata.dimensions).toBeDefined();
    expect(Object.keys(metadata.dimensions!)).toEqual(["default", "workflow", "error_types"]);
    expect(metadata.dimensions!["error_types"]!.prompt).toBe("Identify error-related components");
    expect(metadata.dimensions!["error_types"]!.coloringPrompt).toBe("Use warm colors for errors");

    // Verify dimension part annotations survive parse (carried via passthrough)
    const parsedParts = conversation.messages.flatMap((m) => m.parts);
    const parsedP1 = parsedParts.find((p) => p.id === "p1")! as Record<string, unknown>;
    expect(parsedP1["dimensions"]).toEqual({ default: "identity", workflow: "identity", error_types: "setup" });
  });

  it("backward compat: old export without dimensions imports correctly", () => {
    const oldExport: FileExport = {
      id: "old-1",
      filename: "old.json",
      conversation: {
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [
              { id: "p1", type: "text", token_count: 10, component: "setup" },
            ],
          },
        ],
      },
      colors: { setup: "blue" },
      summary: "Old export",
      analysis: null,
    };

    // Should validate
    expect(FileExportSchema.safeParse(oldExport).success).toBe(true);

    // Parser should handle it
    const parser = new ContextViewerParser();
    expect(parser.canParse(oldExport)).toBe(true);

    const metadata = parser.extractMetadata(oldExport);
    expect(metadata.componentColors).toEqual({ setup: "blue" });
    expect(metadata.dimensions).toBeUndefined();
  });
});

// ============================================================================
// Session export round-trip
// ============================================================================

describe("Session export", () => {
  it("builds valid session export from multiple conversations", () => {
    const conversations = [
      {
        id: "c1",
        filename: "conv1.json",
        status: "success" as const,
        conversation: {
          messages: [
            {
              id: "msg-1",
              role: "user" as const,
              parts: [{ id: "p1", type: "text" as const, text: "Hello", token_count: 5 }],
            },
          ],
        },
        componentMapping: { p1: "greeting" },
        componentColors: { greeting: "blue" },
        aiSummary: "Test",
        analysis: null,
      },
      {
        id: "c2",
        filename: "conv2.json",
        status: "success" as const,
        conversation: {
          messages: [
            {
              id: "msg-2",
              role: "assistant" as const,
              parts: [{ id: "p2", type: "text" as const, text: "Hi", token_count: 3 }],
            },
          ],
        },
        componentMapping: { p2: "response" },
        componentColors: { response: "red" },
        aiSummary: null,
        analysis: null,
      },
    ];

    const session = buildSessionExport(conversations);

    expect(SessionExportSchema.safeParse(session).success).toBe(true);
    expect(session.version).toBe("1.0");
    expect(session.files).toHaveLength(2);
    expect(session.analytics.componentComparison).toHaveLength(2);
  });

  it.skipIf(!hasFixtures())(
    "real session exports re-validate after parse",
    () => {
      const data = loadFixture("claude-prompt-evolution-export-simpler.json");
      const parsed = SessionExportSchema.parse(data);
      // Re-validate the parsed data
      const result = SessionExportSchema.safeParse(parsed);
      expect(result.success).toBe(true);
    },
  );
});

// ============================================================================
// Multi-dimension export fixture tests
// ============================================================================

describe("Multi-dimension export fixture", () => {
  function loadBundledFixture(filename: string): unknown {
    const filepath = path.join(BUNDLED_FIXTURES_DIR, filename);
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  }

  it("validates multi-dimension session export schema", () => {
    const data = loadBundledFixture("multi-dimension-export.json");
    const result = SessionExportSchema.safeParse(data);
    expect(result.success, `Schema validation failed: ${!result.success && result.error?.message}`).toBe(true);
  });

  it("validates individual FileExport with dimensions", () => {
    const data = loadBundledFixture("multi-dimension-export.json") as SessionExport;
    expect(data.files.length).toBeGreaterThan(0);
    for (const file of data.files) {
      const result = FileExportSchema.safeParse(file);
      expect(result.success, `File ${file.id} should validate`).toBe(true);
    }
  });

  it("preserves dimension data on file export", () => {
    const data = loadBundledFixture("multi-dimension-export.json") as SessionExport;
    const file = data.files[0]!;
    expect(file.dimensions).toBeDefined();
    expect(Object.keys(file.dimensions!)).toEqual(["default", "relevance"]);
    expect(file.dimensions!["default"]!.components.length).toBeGreaterThan(0);
    expect(file.dimensions!["relevance"]!.components.length).toBeGreaterThan(0);
  });

  it("preserves per-part dimension annotations", () => {
    const data = loadBundledFixture("multi-dimension-export.json") as SessionExport;
    const file = data.files[0]!;
    const partsWithDimensions = file.conversation.messages.flatMap((m) =>
      m.parts.filter((p) => p.dimensions),
    );
    expect(partsWithDimensions.length).toBeGreaterThan(0);
    // Each part with dimensions should have both dimension keys
    const firstPart = partsWithDimensions[0]!;
    expect(firstPart.dimensions).toHaveProperty("default");
    expect(firstPart.dimensions).toHaveProperty("relevance");
  });

  it("imports multi-dimension export correctly via parser", () => {
    const data = loadBundledFixture("multi-dimension-export.json") as SessionExport;
    const file = data.files[0]!;
    const parser = new ContextViewerParser();
    expect(parser.canParse(file)).toBe(true);

    const conversation = parser.parse(file);
    expect(conversation.messages.length).toBe(file.conversation.messages.length);

    const metadata = parser.extractMetadata(file);
    expect(metadata.dimensions).toBeDefined();
    expect(Object.keys(metadata.dimensions!)).toEqual(["default", "relevance"]);
    expect(metadata.dimensions!["default"]!.components.length).toBeGreaterThan(0);
    expect(metadata.dimensions!["relevance"]!.components.length).toBeGreaterThan(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  deleteSession: vi.fn(),
  parseFileDropInput: vi.fn(),
  generateId: vi.fn(),
}));

vi.mock("context-analyzer", () => ({
  analyze: mocks.analyze,
  deleteSession: mocks.deleteSession,
}));

vi.mock("@/lib/file-import", () => ({
  parseFileDropInput: mocks.parseFileDropInput,
}));

vi.mock("@/lib/ai-config", () => ({
  getAnalyzerConfig: () => ({ apiKey: "" }),
}));

vi.mock("@/lib/id-generator", () => ({
  generateId: mocks.generateId,
}));

vi.mock("@/lib/pipeline-logging", () => ({
  markStepStart: vi.fn(),
  markStepEnd: vi.fn(),
}));

import { useConversationStore } from "@/stores/conversation-store";

function inputFile(name: string) {
  return {
    name,
    text: async () => `content:${name}`,
  } as File;
}

function analyzerState(id: string, filename: string, parserName = "Plain Text") {
  return {
    id,
    filename,
    conversation: {
      messages: [{ id: `message:${id}`, role: "user", parts: [{ id: `part:${id}`, type: "text", text: filename }] }],
    },
    metadata: { parserName },
    warnings: [],
    stepTimings: {},
  };
}

describe("conversation store analyzer sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({ conversations: [], groups: {} });

    let nextId = 0;
    mocks.generateId.mockImplementation(() => `viewer-${++nextId}`);
    mocks.parseFileDropInput.mockImplementation(async (files: File[]) => ({
      filesToProcess: files,
      oldIdToIndex: new Map(),
      sessionGroups: [],
    }));
  });

  it("creates one stable analyzer session per dropped file", async () => {
    const progressStates: string[] = [];
    mocks.analyze.mockImplementation(async (options: any) => {
      const file = options.files;
      const state = analyzerState(file.id, file.filename);
      const parsing = options.interceptors.find((item: any) => item.stage === "parsing" && item.timing === "pre");
      await parsing.fn(state);
      progressStates.push(useConversationStore.getState().getConversation(file.id)?.status || "missing");
      return {
        sessionId: `session:${file.id}`,
        states: [state],
        errors: [],
        warnings: [],
        analytics: [],
        format: "Plain Text",
      };
    });

    await useConversationStore.getState().processFileDrop(
      [inputFile("one.txt"), inputFile("two.txt")],
      null,
    );

    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.analyze.mock.calls.map(([options]) => options.files.id)).toEqual(["viewer-1", "viewer-2"]);
    expect(progressStates).toEqual(["processing", "processing"]);
    expect(useConversationStore.getState().conversations).toMatchObject([
      { id: "viewer-1", sessionId: "session:viewer-1", status: "paused-for-api-key" },
      { id: "viewer-2", sessionId: "session:viewer-2", status: "paused-for-api-key" },
    ]);
  });

  it("keeps successful siblings when one file fails", async () => {
    mocks.analyze.mockImplementation(async (options: any) => {
      const file = options.files;
      if (file.filename === "bad.txt") throw new Error("Cannot parse file");
      return {
        sessionId: `session:${file.id}`,
        states: [analyzerState(file.id, file.filename)],
        errors: [],
        warnings: [],
        analytics: [],
        format: "Plain Text",
      };
    });

    await useConversationStore.getState().processFileDrop(
      [inputFile("good.txt"), inputFile("bad.txt")],
      null,
    );

    expect(useConversationStore.getState().conversations).toMatchObject([
      { filename: "good.txt", status: "paused-for-api-key" },
      { filename: "bad.txt", status: "failed", error: "Cannot parse file" },
    ]);
  });

  it("treats preprocessed imports as complete without an API key", async () => {
    mocks.analyze.mockImplementation(async (options: any) => ({
      sessionId: "session:import",
      states: [analyzerState(options.files.id, options.files.filename, "Context Viewer")],
      errors: [],
      warnings: [],
      analytics: [],
      format: "Context Viewer",
    }));

    await useConversationStore.getState().processFileDrop([inputFile("export.json")], null);

    expect(useConversationStore.getState().conversations[0]).toMatchObject({
      status: "success",
      pausedAtStep: undefined,
    });
  });

  it("surfaces structured analyzer errors as viewer warnings", async () => {
    mocks.analyze.mockImplementation(async (options: any) => ({
      sessionId: "session:error",
      states: [analyzerState(options.files.id, options.files.filename, "Context Viewer")],
      errors: [{ stage: "classify", category: "upstream", message: "Rate limited", retryable: true }],
      warnings: [],
      analytics: [],
      format: "Context Viewer",
    }));

    await useConversationStore.getState().processFileDrop([inputFile("export.json")], null);

    expect(useConversationStore.getState().conversations[0]?.warnings).toContain("classify: Rate limited");
  });

  it("deletes only the selected file's analyzer session", async () => {
    mocks.analyze.mockImplementation(async (options: any) => ({
      sessionId: `session:${options.files.id}`,
      states: [analyzerState(options.files.id, options.files.filename, "Context Viewer")],
      errors: [],
      warnings: [],
      analytics: [],
      format: "Context Viewer",
    }));

    await useConversationStore.getState().processFileDrop(
      [inputFile("one.json"), inputFile("two.json")],
      null,
    );
    useConversationStore.getState().deleteConversation("viewer-1");

    expect(mocks.deleteSession).toHaveBeenCalledWith("session:viewer-1");
    expect(useConversationStore.getState().conversations).toMatchObject([
      { id: "viewer-2", sessionId: "session:viewer-2" },
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  setReprocessingId: vi.fn(),
}));

vi.mock("context-analyzer", () => ({
  analyze: mocks.analyze,
  summarize: vi.fn(),
  analyzeContext: vi.fn(),
  buildSessionExport: vi.fn(),
  createEmptyDimension: (name: string) => ({
    name,
    discoveredComponents: [],
    componentMapping: {},
    componentTimeline: [],
    componentColors: {},
  }),
  getDefaultComponentIdentificationPrompt: () => "identify",
  getDefaultSegmentationPrompt: () => "segment",
  getDefaultSummaryPrompt: () => "summarize",
  getDefaultAnalysisPrompt: () => "analyze",
  getDefaultColoringPrompt: () => "color",
  DEFAULT_SEGMENTATION_THRESHOLD: 500,
  deleteSession: vi.fn(),
}));

vi.mock("@/lib/ai-config", () => ({
  getAnalyzerConfig: () => ({ apiKey: "test-key" }),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: {
    getState: () => ({
      editingDimensionName: "default",
      setReprocessingId: mocks.setReprocessingId,
    }),
  },
}));

vi.mock("@/stores/url-store", () => ({
  useUrlStore: {
    getState: () => ({
      conversationId: null,
      _syncFromUrl: vi.fn(),
      navigateToConversation: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/pipeline-logging", () => ({
  markStepStart: vi.fn(),
  markStepEnd: vi.fn(),
}));

vi.mock("@/ui/lib/export-download", () => ({
  downloadExport: vi.fn(),
  exportPromptsAsPreset: vi.fn(),
}));

import { useConversationStore, type ViewerConversationState } from "@/stores/conversation-store";
import { applyPromptsToAllAction, resumePipelinesWithApiKeyAction } from "@/stores/actions";

function conversation(id: string, overrides: Partial<ViewerConversationState> = {}): ViewerConversationState {
  return {
    id,
    filename: `${id}.txt`,
    conversation: {
      messages: [{ id: `message:${id}`, role: "user", parts: [{ id: `part:${id}`, type: "text", text: id }] }],
    },
    warnings: [],
    stepTimings: {},
    status: "success",
    sessionId: `session:${id}`,
    ...overrides,
  };
}

function resultFor(id: string, warnings: string[] = []) {
  return {
    sessionId: `session:${id}`,
    states: [conversation(id, { warnings })],
    errors: [],
    warnings: [],
    analytics: [],
    format: "Plain Text",
  };
}

describe("viewer session actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({ conversations: [], groups: {} });
    mocks.analyze.mockImplementation(async (options: any) => {
      const id = String(options.sessionId).replace("session:", "");
      return resultFor(id);
    });
  });

  it("resumes each paused file through its own session", async () => {
    useConversationStore.setState({
      conversations: [
        conversation("one", { status: "paused-for-api-key" }),
        conversation("two", { status: "paused-for-api-key" }),
      ],
    });

    await resumePipelinesWithApiKeyAction();

    expect(mocks.analyze.mock.calls.map(([options]) => options.sessionId)).toEqual([
      "session:one",
      "session:two",
    ]);
    expect(useConversationStore.getState().conversations).toMatchObject([
      { id: "one", status: "success" },
      { id: "two", status: "success" },
    ]);
  });

  it("applies prompts to every target using stable analyzer IDs", async () => {
    const source = conversation("source", {
      dimensions: {
        default: {
          name: "default",
          prompt: "Find topics",
          discoveredComponents: ["topic"],
          customComponents: ["topic"],
          componentDescriptions: { topic: "Discussion topic" },
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        },
      },
    });
    useConversationStore.setState({
      conversations: [source, conversation("one"), conversation("two")],
    });

    await applyPromptsToAllAction("source");

    expect(mocks.analyze.mock.calls.map(([options]) => options.sessionId)).toEqual([
      "session:one",
      "session:two",
    ]);
    expect(useConversationStore.getState().conversations).toMatchObject([
      { id: "source" },
      { id: "one", status: "success" },
      { id: "two", status: "success" },
    ]);
  });
});

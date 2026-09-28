import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  summarize: vi.fn(),
  analyzeContext: vi.fn(),
  setReprocessingId: vi.fn(),
  setActiveDimensions: vi.fn(),
  saveSessionDimensions: vi.fn(),
  saveSessionStageModels: vi.fn(),
  setEditingDimensionName: vi.fn(),
  setEditingPrompt: vi.fn(),
  setIsPromptDialogOpen: vi.fn(),
  setIsComponentsDialogOpen: vi.fn(),
  setEditingComponents: vi.fn(),
}));

vi.mock("context-analyzer", () => ({
  analyze: mocks.analyze,
  summarize: mocks.summarize,
  analyzeContext: mocks.analyzeContext,
  saveSessionDimensions: mocks.saveSessionDimensions,
  saveSessionStageModels: mocks.saveSessionStageModels,
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
      editingPrompt: "Find activities",
      editingComponents: "planning\nexecution",
      activeDimensions: new Set(["default", "topic"]),
      setReprocessingId: mocks.setReprocessingId,
      setActiveDimensions: mocks.setActiveDimensions,
      setEditingDimensionName: mocks.setEditingDimensionName,
      setEditingPrompt: mocks.setEditingPrompt,
      setIsPromptDialogOpen: mocks.setIsPromptDialogOpen,
      setIsComponentsDialogOpen: mocks.setIsComponentsDialogOpen,
      setEditingComponents: mocks.setEditingComponents,
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
import {
  applyComponents,
  applyPrompt,
  applyPromptsToAllAction,
  generateAnalysis,
  generateSummary,
  openComponentsEditor,
  openPromptEditor,
  addDimension,
  removeDimension,
  renameDimension,
  saveComponents,
  savePrompt,
  saveStageModel,
  reprocessComponents,
  resumePipelinesWithApiKeyAction,
} from "@/stores/actions";

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

  it("fans group reprocessing out to each member session", async () => {
    const group = conversation("group", { sessionId: undefined });
    useConversationStore.setState({
      conversations: [conversation("one"), conversation("two")],
      groups: { group: { id: "group", name: "Group", fileIds: ["one", "two"] } },
    });

    await reprocessComponents(group, ["one", "two"], { customPrompt: "Find activities" });

    expect(mocks.analyze.mock.calls.map(([options]) => options.sessionId)).toEqual([
      "session:one",
      "session:two",
    ]);
    expect(mocks.setReprocessingId).toHaveBeenNthCalledWith(1, "group");
    expect(mocks.setReprocessingId).toHaveBeenLastCalledWith(null);
  });

  it("stores generated summaries and analyses on groups", async () => {
    const group = conversation("group", { sessionId: undefined });
    useConversationStore.setState({
      conversations: [conversation("one"), conversation("two")],
      groups: { group: { id: "group", name: "Group", fileIds: ["one", "two"] } },
    });
    mocks.summarize.mockResolvedValue({ summary: "Group summary", errors: [] });
    mocks.analyzeContext.mockResolvedValue({ summary: "Analysis summary", analysis: "Group analysis", errors: [] });

    await generateSummary("group", group, { customSummaryPrompt: "Summarize together" });
    await generateAnalysis("group", group, { customAnalysisPrompt: "Compare files" });

    expect(useConversationStore.getState().groups.group).toMatchObject({
      aiSummary: "Analysis summary",
      analysis: "Group analysis",
      customSummaryPrompt: "Summarize together",
      customAnalysisPrompt: "Compare files",
    });
  });

  it("saves a dimension prompt without replacing generated outputs", () => {
    useConversationStore.setState({
      conversations: [conversation("one", {
        dimensions: {
          default: {
            name: "default",
            discoveredComponents: ["existing"],
            componentMapping: { "part:one": "existing" },
            componentTimeline: [],
            componentColors: { existing: "#ff0000" },
          },
        },
      })],
    });

    savePrompt(useConversationStore.getState().getConversation("one"));

    expect(useConversationStore.getState().getConversation("one")?.dimensions?.default).toMatchObject({
      prompt: "Find activities",
      discoveredComponents: ["existing"],
      componentMapping: { "part:one": "existing" },
    });
    expect(mocks.saveSessionDimensions).toHaveBeenCalledOnce();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("opens group editors from group dimension configuration", () => {
    useConversationStore.setState({
      conversations: [conversation("one"), conversation("two")],
      groups: {
        group: {
          id: "group",
          name: "Group",
          fileIds: ["one", "two"],
          dimensions: {
            default: {
              prompt: "Group prompt",
              customComponents: ["planning", "execution"],
            },
          },
        },
      },
    });

    openPromptEditor("group", "default");
    openComponentsEditor("group", "default");

    expect(mocks.setEditingPrompt).toHaveBeenCalledWith("Group prompt");
    expect(mocks.setEditingComponents).toHaveBeenCalledWith("planning\nexecution");
  });

  it("stores saved prompts on the group source of truth", () => {
    const groupConversation = conversation("group", { sessionId: undefined });
    useConversationStore.setState({
      conversations: [conversation("one"), conversation("two")],
      groups: { group: { id: "group", name: "Group", fileIds: ["one", "two"] } },
    });

    savePrompt(groupConversation);

    expect(useConversationStore.getState().groups.group).toMatchObject({
      dimensions: { default: { prompt: "Find activities" } },
    });
    expect(mocks.saveSessionDimensions).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("saves custom components without replacing generated outputs", () => {
    useConversationStore.setState({
      conversations: [conversation("one", {
        dimensions: {
          default: {
            name: "default",
            discoveredComponents: ["existing"],
            componentMapping: { "part:one": "existing" },
            componentTimeline: [],
            componentColors: { existing: "#ff0000" },
          },
        },
      })],
    });

    saveComponents(useConversationStore.getState().getConversation("one"));

    expect(useConversationStore.getState().getConversation("one")?.dimensions?.default).toMatchObject({
      customComponents: ["planning", "execution"],
      discoveredComponents: ["existing"],
      componentMapping: { "part:one": "existing" },
    });
    expect(mocks.saveSessionDimensions).toHaveBeenCalledOnce();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("applies the saved prompt by reprocessing all active dimensions", async () => {
    const selected = conversation("one", {
      dimensions: {
        default: {
          name: "default",
          discoveredComponents: ["existing"],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        },
        topic: {
          name: "topic",
          discoveredComponents: ["discussion"],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        },
      },
    });
    useConversationStore.setState({ conversations: [selected] });

    await applyPrompt(selected);

    expect(mocks.saveSessionDimensions).toHaveBeenCalledWith(
      "session:one",
      "one",
      expect.objectContaining({
        default: expect.objectContaining({ prompt: "Find activities" }),
        topic: expect.anything(),
      }),
    );
    expect(mocks.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session:one",
        reprocessDimensions: ["default", "topic"],
      }),
      expect.anything(),
    );
  });

  it("applies saved components by reprocessing all active dimensions", async () => {
    const selected = conversation("one", {
      dimensions: {
        default: {
          name: "default",
          discoveredComponents: ["existing"],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        },
        topic: {
          name: "topic",
          discoveredComponents: ["discussion"],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        },
      },
    });
    useConversationStore.setState({ conversations: [selected] });

    await applyComponents(selected);

    expect(mocks.saveSessionDimensions).toHaveBeenCalledWith(
      "session:one",
      "one",
      expect.objectContaining({
        default: expect.objectContaining({ customComponents: ["planning", "execution"] }),
        topic: expect.anything(),
      }),
    );
    expect(mocks.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ reprocessDimensions: ["default", "topic"] }),
      expect.anything(),
    );
  });

  it("saves a group stage model to every member session", () => {
    useConversationStore.setState({
      conversations: [conversation("one"), conversation("two")],
      groups: { group: { id: "group", name: "Group", fileIds: ["one", "two"] } },
    });

    saveStageModel("group", "classifying-components", "typesafe/jev-router");

    expect(useConversationStore.getState().groups.group?.stageModels).toEqual({
      "classifying-components": "typesafe/jev-router",
    });
    expect(useConversationStore.getState().conversations.every((item) =>
      item.stageModels?.["classifying-components"] === "typesafe/jev-router",
    )).toBe(true);
    expect(mocks.saveSessionStageModels).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("saves added dimensions without reprocessing", () => {
    useConversationStore.setState({ conversations: [conversation("one")] });

    addDimension("one", "activity");

    expect(useConversationStore.getState().getConversation("one")?.dimensions?.activity).toBeDefined();
    expect(mocks.saveSessionDimensions).toHaveBeenCalledWith(
      "session:one",
      "one",
      expect.objectContaining({ activity: expect.objectContaining({ name: "activity" }) }),
    );
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("saves group dimension renames without reprocessing", () => {
    const withTopic = (id: string) => conversation(id, {
      dimensions: {
        topic: {
          name: "topic",
          discoveredComponents: ["discussion"],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        },
      },
    });
    useConversationStore.setState({
      conversations: [withTopic("one"), withTopic("two")],
      groups: { group: { id: "group", name: "Group", fileIds: ["one", "two"] } },
    });

    renameDimension("group", "topic", "activity");

    expect(useConversationStore.getState().conversations.every((conv) =>
      !!conv.dimensions?.activity && !conv.dimensions?.topic,
    )).toBe(true);
    expect(mocks.saveSessionDimensions).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("saves group dimension removals without reprocessing", () => {
    const withActivity = (id: string) => conversation(id, {
      dimensions: {
        activity: {
          name: "activity",
          discoveredComponents: ["planning"],
          componentMapping: {},
          componentTimeline: [],
          componentColors: {},
        },
      },
    });
    useConversationStore.setState({
      conversations: [withActivity("one"), withActivity("two")],
      groups: { group: { id: "group", name: "Group", fileIds: ["one", "two"] } },
    });

    removeDimension("group", "activity");

    expect(useConversationStore.getState().conversations.every((conv) =>
      !conv.dimensions?.activity,
    )).toBe(true);
    expect(mocks.saveSessionDimensions).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});

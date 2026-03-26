/**
 * Tests for useConversationStore.
 *
 * Ground truth from compaction-everything.json:
 *   [95] groupConversations → storeDiff.groups.added: {id: "802", name: "Grouped: post-compaction-1.jsonl, segment-1.jsonl", fileIds: ["1", "2"]}
 *
 * Tests cover CRUD operations, group management, and streaming mutations.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn(), streamText: vi.fn() }));
vi.mock("@/stages/ai/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/stages/ai/config")>();
  return { ...mod, hasApiKey: () => false, getAIConfig: () => null, createModel: () => ({}), getProviderOptions: () => undefined };
});

import { useConversationStore } from "@/stores/conversation-store";
import type { PipelineState } from "@/model/types";
import { SEG1_COMPONENTS, SEG1_COLORS } from "@/__tests__/recording-fixtures";

function makeConv(id: string, filename: string, status = "success"): PipelineState {
  return {
    id, filename, status: status as any,
    conversation: {
      messages: [{ id: `${id}-m`, role: "user" as const,
        parts: [{ id: `${id}-p`, type: "text" as const, text: "Hello" }],
      }],
    },
    summary: { totalMessages: 1, messagesByRole: { user: 1 }, textOnlyMessageCount: 1, structuredContentMessageCount: 0, partCounts: { text: 1 } },
    metadata: { parserName: "Claude Code" },
    dimensions: {
      default: {
        name: "default",
        discoveredComponents: SEG1_COMPONENTS.slice(0, 3),
        componentMapping: { [`${id}-p`]: SEG1_COMPONENTS[0]! },
        componentTimeline: [],
        componentColors: Object.fromEntries(SEG1_COMPONENTS.slice(0, 3).map(c => [c, SEG1_COLORS[c]!])),
      },
    },
    warnings: [], stepTimings: {},
  };
}

describe("useConversationStore", () => {
  beforeEach(() => {
    useConversationStore.setState({
      conversations: [], groups: {}, fileIdsRef: new Map(), pendingSessionImport: null,
    });
  });

  describe("conversation CRUD", () => {
    it("adds and retrieves conversations", () => {
      useConversationStore.getState().addConversations([makeConv("1", "a.jsonl")]);
      const conv = useConversationStore.getState().getConversation("1");
      expect(conv).toBeDefined();
      expect(conv!.filename).toBe("a.jsonl");
      expect(conv!.metadata!.parserName).toBe("Claude Code");
    });

    it("returns undefined for missing ID", () => {
      expect(useConversationStore.getState().getConversation("999")).toBeUndefined();
    });

    it("updates a conversation", () => {
      useConversationStore.setState({ conversations: [makeConv("1", "a.jsonl")] });
      useConversationStore.getState().updateConversation("1", { title: "New Title" });
      expect(useConversationStore.getState().getConversation("1")!.title).toBe("New Title");
    });

    it("removes a conversation", () => {
      useConversationStore.setState({
        conversations: [makeConv("1", "a.jsonl"), makeConv("2", "b.jsonl")],
      });
      useConversationStore.getState().removeConversation("1");
      expect(useConversationStore.getState().conversations.length).toBe(1);
      expect(useConversationStore.getState().conversations[0]!.id).toBe("2");
    });

    it("renames a conversation (empty string clears title)", () => {
      useConversationStore.setState({
        conversations: [{ ...makeConv("1", "a.jsonl"), title: "Old" }],
      });
      useConversationStore.getState().renameConversation("1", "");
      expect(useConversationStore.getState().getConversation("1")!.title).toBeUndefined();
    });

    it("prevents deleting a conversation in a group", () => {
      useConversationStore.setState({
        conversations: [makeConv("1", "a.jsonl"), makeConv("2", "b.jsonl")],
        groups: { g1: { id: "g1", name: "G", fileIds: ["1", "2"] } },
      });
      useConversationStore.getState().deleteConversation("1");
      expect(useConversationStore.getState().conversations.length).toBe(2);
    });
  });

  describe("streaming mutations", () => {
    it("appends summary chunks", () => {
      useConversationStore.setState({ conversations: [makeConv("1", "a.jsonl")] });
      useConversationStore.getState().appendSummaryChunk("1", "Part 1. ");
      useConversationStore.getState().appendSummaryChunk("1", "Part 2.");
      expect(useConversationStore.getState().getConversation("1")!.aiSummary).toBe("Part 1. Part 2.");
    });

    it("appends analysis chunks", () => {
      useConversationStore.setState({ conversations: [makeConv("1", "a.jsonl")] });
      useConversationStore.getState().appendAnalysisChunk("1", "Analysis.");
      expect(useConversationStore.getState().getConversation("1")!.analysis).toBe("Analysis.");
    });
  });

  describe("group operations", () => {
    it("matches recording [95]: creates group from 2 valid conversations", () => {
      // Recording [95]: groupConversations created group with
      // name: "Grouped: post-compaction-1.jsonl, segment-1.jsonl", fileIds: ["1", "2"]
      useConversationStore.setState({
        conversations: [
          makeConv("1", "post-compaction-1.jsonl"),
          makeConv("2", "segment-1.jsonl"),
        ],
      });

      const groupId = useConversationStore.getState().groupConversations(["1", "2"]);

      expect(groupId).toBeTruthy();
      const group = useConversationStore.getState().getGroup(groupId);
      expect(group).toBeDefined();
      expect(group!.fileIds).toEqual(["1", "2"]);
      // Recording [95]: auto-generated name includes both filenames
      expect(group!.name).toContain("post-compaction-1.jsonl");
      expect(group!.name).toContain("segment-1.jsonl");
    });

    it("rejects group with < 2 valid conversations", () => {
      useConversationStore.setState({ conversations: [makeConv("1", "a.jsonl")] });
      expect(useConversationStore.getState().groupConversations(["1"])).toBe("");
    });

    it("filters non-success conversations", () => {
      useConversationStore.setState({
        conversations: [
          makeConv("1", "a.jsonl"),
          { id: "2", filename: "b.jsonl", status: "pending" } as PipelineState,
          makeConv("3", "c.jsonl"),
        ],
      });
      const gid = useConversationStore.getState().groupConversations(["1", "2", "3"]);
      expect(useConversationStore.getState().getGroup(gid)!.fileIds).toEqual(["1", "3"]);
    });

    it("removes a group", () => {
      useConversationStore.setState({
        conversations: [makeConv("1", "a.jsonl"), makeConv("2", "b.jsonl")],
      });
      const gid = useConversationStore.getState().groupConversations(["1", "2"]);
      useConversationStore.getState().removeGroup(gid);
      expect(useConversationStore.getState().getGroup(gid)).toBeUndefined();
    });

    it("updates a group", () => {
      useConversationStore.setState({
        conversations: [makeConv("1", "a.jsonl"), makeConv("2", "b.jsonl")],
      });
      const gid = useConversationStore.getState().groupConversations(["1", "2"]);
      useConversationStore.getState().updateGroup(gid, { title: "Custom Title" });
      expect(useConversationStore.getState().getGroup(gid)!.title).toBe("Custom Title");
    });

    it("finds groups for a file", () => {
      useConversationStore.setState({
        conversations: [makeConv("1", "a.jsonl"), makeConv("2", "b.jsonl"), makeConv("3", "c.jsonl")],
      });
      useConversationStore.getState().groupConversations(["1", "2"], "G1");
      useConversationStore.getState().groupConversations(["2", "3"], "G2");

      expect(useConversationStore.getState().getGroupsForFile("1").length).toBe(1);
      expect(useConversationStore.getState().getGroupsForFile("2").length).toBe(2);
      expect(useConversationStore.getState().getGroupsForFile("3").length).toBe(1);
    });

    it("counts paused conversations", () => {
      useConversationStore.setState({
        conversations: [
          { ...makeConv("1", "a.jsonl"), status: "paused-for-api-key" },
          makeConv("2", "b.jsonl"),
          { ...makeConv("3", "c.jsonl"), status: "paused-for-api-key" },
        ],
      });
      expect(useConversationStore.getState().getPausedCount()).toBe(2);
    });
  });

  describe("processPendingGroups", () => {
    it("creates groups from pending session import when all files are ready", () => {
      const fileIdsRef = new Map([[0, "new-1"], [1, "new-2"]]);
      useConversationStore.setState({
        conversations: [
          makeConv("new-1", "a.jsonl"),
          makeConv("new-2", "b.jsonl"),
        ],
        fileIdsRef,
        pendingSessionImport: {
          oldIdToIndex: new Map([["old-1", 0], ["old-2", 1]]),
          groups: [{ id: "g1", name: "Imported Group", fileIds: ["old-1", "old-2"] }],
        },
      });

      useConversationStore.getState().processPendingGroups();

      const group = useConversationStore.getState().getGroup("g1");
      expect(group).toBeDefined();
      expect(group!.name).toBe("Imported Group");
      expect(group!.fileIds).toEqual(["new-1", "new-2"]);
      expect(useConversationStore.getState().pendingSessionImport).toBeNull();
    });

    it("does nothing when files are not ready", () => {
      useConversationStore.setState({
        conversations: [
          { id: "new-1", filename: "a.jsonl", status: "pending" } as PipelineState,
        ],
        fileIdsRef: new Map([[0, "new-1"]]),
        pendingSessionImport: {
          oldIdToIndex: new Map([["old-1", 0], ["old-2", 1]]),
          groups: [{ id: "g1", name: "Group", fileIds: ["old-1", "old-2"] }],
        },
      });

      useConversationStore.getState().processPendingGroups();
      expect(useConversationStore.getState().getGroup("g1")).toBeUndefined();
      expect(useConversationStore.getState().pendingSessionImport).not.toBeNull();
    });

    it("does nothing when no pending import", () => {
      useConversationStore.setState({ pendingSessionImport: null });
      useConversationStore.getState().processPendingGroups();
      expect(Object.keys(useConversationStore.getState().groups).length).toBe(0);
    });
  });
});

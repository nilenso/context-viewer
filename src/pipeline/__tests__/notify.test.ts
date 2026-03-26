/**
 * Tests for pipeline notification functions.
 */
import { describe, it, expect, vi } from "vitest";
import {
  markFailed,
  markPausedForApiKey,
  markComplete,
  updateState,
  timed,
} from "@/pipeline/notify";
import type { PipelineState } from "@/model/types";

function makeCtx(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    id: "test-1", filename: "test.jsonl",
    conversation: { messages: [] },
    warnings: [], stepTimings: {},
    ...overrides,
  };
}

describe("markFailed", () => {
  it("notifies with failed status and error message", () => {
    const notify = vi.fn();
    markFailed(notify, "test-1", "Something broke");
    expect(notify).toHaveBeenCalledWith("test-1", {
      status: "failed",
      step: undefined,
      error: "Something broke",
    });
  });
});

describe("markPausedForApiKey", () => {
  it("notifies with paused status and preserves fields", () => {
    const notify = vi.fn();
    const ctx = makeCtx({ aiSummary: "A summary" });
    markPausedForApiKey(notify, ctx, ["conversation", "aiSummary"], "segmenting");

    expect(notify).toHaveBeenCalledOnce();
    const call = notify.mock.calls[0]![1];
    expect(call.status).toBe("paused-for-api-key");
    expect(call.step).toBeUndefined();
    expect(call.pausedAtStep).toBe("segmenting");
    expect(call.conversation).toBe(ctx.conversation);
    expect(call.aiSummary).toBe("A summary");
  });
});

describe("markComplete", () => {
  it("notifies with success status and picked fields", () => {
    const notify = vi.fn();
    const ctx = makeCtx({ title: "My Title" });
    markComplete(notify, ctx, ["title"]);

    const call = notify.mock.calls[0]![1];
    expect(call.status).toBe("success");
    expect(call.step).toBeUndefined();
    expect(call.title).toBe("My Title");
  });
});

describe("updateState", () => {
  it("notifies with success and next step", () => {
    const notify = vi.fn();
    const ctx = makeCtx();
    updateState(notify, ctx, ["conversation"], "segmenting");

    const call = notify.mock.calls[0]![1];
    expect(call.status).toBe("success");
    expect(call.step).toBe("segmenting");
  });

  it("includes warnings when present", () => {
    const notify = vi.fn();
    const ctx = makeCtx({ warnings: ["A warning"] });
    updateState(notify, ctx, ["conversation"], "segmenting");

    const call = notify.mock.calls[0]![1];
    expect(call.warnings).toEqual(["A warning"]);
  });

  it("omits warnings when empty", () => {
    const notify = vi.fn();
    const ctx = makeCtx({ warnings: [] });
    updateState(notify, ctx, ["conversation"]);

    const call = notify.mock.calls[0]![1];
    expect(call.warnings).toBeUndefined();
  });
});

describe("timed", () => {
  it("returns result and timing", async () => {
    const { result, timing } = await timed(async () => 42);
    expect(result).toBe(42);
    expect(typeof timing).toBe("number");
    expect(timing).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Tests for message-filters pure predicates.
 */
import { describe, it, expect } from "vitest";
import { partPassesMessageTypeFilter, hasActiveMessageTypeFilters } from "../../lib/message-filters";

describe("partPassesMessageTypeFilter", () => {
  it("passes everything when filters is undefined", () => {
    expect(partPassesMessageTypeFilter(undefined, "text", "user")).toBe(true);
  });

  it("passes everything when filters contains 'all'", () => {
    expect(partPassesMessageTypeFilter(new Set(["all"]), "text", "user")).toBe(true);
    expect(partPassesMessageTypeFilter(new Set(["all", "user:text"]), "tool-call", "assistant")).toBe(true);
  });

  it("filters by role:type key", () => {
    const filters = new Set(["user:text", "assistant:tool-call"]);
    expect(partPassesMessageTypeFilter(filters, "text", "user")).toBe(true);
    expect(partPassesMessageTypeFilter(filters, "tool-call", "assistant")).toBe(true);
    expect(partPassesMessageTypeFilter(filters, "reasoning", "assistant")).toBe(false);
    expect(partPassesMessageTypeFilter(filters, "tool-result", "tool")).toBe(false);
  });
});

describe("hasActiveMessageTypeFilters", () => {
  it("returns false for undefined", () => {
    expect(hasActiveMessageTypeFilters(undefined)).toBe(false);
  });

  it("returns false when 'all' is present", () => {
    expect(hasActiveMessageTypeFilters(new Set(["all"]))).toBe(false);
  });

  it("returns false for empty set", () => {
    expect(hasActiveMessageTypeFilters(new Set())).toBe(false);
  });

  it("returns true for specific filters", () => {
    expect(hasActiveMessageTypeFilters(new Set(["user:text"]))).toBe(true);
  });
});

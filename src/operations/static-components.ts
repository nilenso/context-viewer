import type { Conversation } from "@/model/schema";
import type { ComponentTimelineSnapshot } from "@/model/types";
import { buildComponentTimeline } from "./aggregation";
import { recordCall } from "@/lib/session-recorder";

/**
 * Static componentisation - deterministic component identification
 * based on role + part type (e.g., "user.text", "assistant.tool-call")
 *
 * This runs without AI and provides instant categorization.
 */

/**
 * Build list of unique static components from a conversation
 * Component names are in format: role.partType (e.g., "user.image")
 */
export function buildStaticComponents(conversation: Conversation): string[] {
  const componentSet = new Set<string>();

  for (const message of conversation.messages) {
    for (const part of message.parts) {
      const componentName = `${message.role}.${part.type}`;
      componentSet.add(componentName);
    }
  }

  // Sort for consistent ordering: by role first, then by type
  const roleOrder = ["system", "user", "assistant", "tool"];
  return Array.from(componentSet).sort((a, b) => {
    const [roleA, typeA = ""] = a.split(".");
    const [roleB, typeB = ""] = b.split(".");
    const roleIndexA = roleOrder.indexOf(roleA ?? "");
    const roleIndexB = roleOrder.indexOf(roleB ?? "");

    if (roleIndexA !== roleIndexB) {
      return roleIndexA - roleIndexB;
    }
    return typeA.localeCompare(typeB);
  });
}

/**
 * Build mapping of part IDs to static component names
 */
export function buildStaticComponentMapping(
  conversation: Conversation
): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const message of conversation.messages) {
    for (const part of message.parts) {
      const componentName = `${message.role}.${part.type}`;
      mapping[part.id] = componentName;
    }
  }

  return mapping;
}

/**
 * Build timeline of component token distribution at each message
 * Reuses the same structure as automatic componentisation for compatibility.
 * Delegates to the shared buildComponentTimeline in aggregation.ts.
 * Static mappings cover every part, so unmapped = null (skip).
 */
export function buildStaticComponentTimeline(
  conversation: Conversation,
  mapping: Record<string, string>
): ComponentTimelineSnapshot[] {
  return buildComponentTimeline(conversation, mapping, { unmappedLabel: null });
}

/**
 * Convenience function to run all static componentisation steps at once
 */
export function staticComponentise(conversation: Conversation): {
  components: string[];
  mapping: Record<string, string>;
  timeline: ComponentTimelineSnapshot[];
} {
  return recordCall("operations/static-components", "staticComponentise", [{ messageCount: conversation.messages.length }], () => {
    const components = buildStaticComponents(conversation);
    const mapping = buildStaticComponentMapping(conversation);
    const timeline = buildStaticComponentTimeline(conversation, mapping);
    return { components, mapping, timeline };
  });
}

import type { Conversation } from "./schema";
import type { ComponentTimelineSnapshot } from "./componentisation";

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
 * Reuses the same structure as automatic componentisation for compatibility
 */
export function buildStaticComponentTimeline(
  conversation: Conversation,
  mapping: Record<string, string>
): ComponentTimelineSnapshot[] {
  // Build a map of part ID to its message index and token count
  const partInfo = new Map<string, { messageIndex: number; tokenCount: number }>();

  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part) => {
      const tokenCount = ("token_count" in part && part.token_count) || 0;
      partInfo.set(part.id, { messageIndex, tokenCount });
    });
  });

  // Build timeline snapshots (cumulative tokens up to each message)
  const timeline: ComponentTimelineSnapshot[] = [];

  for (let msgIndex = 0; msgIndex < conversation.messages.length; msgIndex++) {
    const componentTokens: Record<string, number> = {};
    let totalTokens = 0;

    // Accumulate tokens for all parts up to and including this message
    Object.entries(mapping).forEach(([partId, component]) => {
      const info = partInfo.get(partId);
      if (info && info.messageIndex <= msgIndex) {
        componentTokens[component] = (componentTokens[component] || 0) + info.tokenCount;
        totalTokens += info.tokenCount;
      }
    });

    timeline.push({
      messageIndex: msgIndex,
      componentTokens,
      totalTokens,
    });
  }

  return timeline;
}

/**
 * Convenience function to run all static componentisation steps at once
 */
export function staticComponentise(conversation: Conversation): {
  components: string[];
  mapping: Record<string, string>;
  timeline: ComponentTimelineSnapshot[];
} {
  const components = buildStaticComponents(conversation);
  const mapping = buildStaticComponentMapping(conversation);
  const timeline = buildStaticComponentTimeline(conversation, mapping);

  return { components, mapping, timeline };
}

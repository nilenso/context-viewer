import type { Conversation } from "../model/schema";
import type { ComponentTimelineSnapshot } from "../model/types";
import { buildComponentTimeline } from "./aggregation";

export function buildStaticComponents(conversation: Conversation): string[] {
  const componentSet = new Set<string>();

  for (const message of conversation.messages) {
    for (const part of message.parts) {
      const componentName = `${message.role}.${part.type}`;
      componentSet.add(componentName);
    }
  }

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

export function buildStaticComponentTimeline(
  conversation: Conversation,
  mapping: Record<string, string>
): ComponentTimelineSnapshot[] {
  return buildComponentTimeline(conversation, mapping, { unmappedLabel: null });
}

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

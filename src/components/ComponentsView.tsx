import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { WaffleChart } from "./WaffleChart";
import { getComponentBgClass } from "@/lib/component-colors";
import { getStaticComponentLabel } from "@/lib/static-component-colors";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/componentisation";

// Message type filter in format "role:type" (e.g., "assistant:tool-call")
type MessageTypeFilter = string;

interface ComponentsViewProps {
  componentMapping?: Record<string, string>;
  conversation: Conversation;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  selectedComponent?: string | null;
  onComponentSelect?: (component: string | null) => void;
  // Static component filter - when set, only show automatic components for parts matching this static component
  staticMapping?: Record<string, string>;
  filterByStaticComponent?: string | null;
  // Filters from conversation view
  messageTypeFilters?: Set<MessageTypeFilter>;
}

export function ComponentsView({
  componentMapping,
  conversation,
  componentTimeline,
  componentColors,
  selectedComponent,
  onComponentSelect,
  staticMapping,
  filterByStaticComponent,
  messageTypeFilters,
}: ComponentsViewProps) {
  // Initialize slider to the last message
  const [currentMessageIndex, setCurrentMessageIndex] = useState(
    conversation.messages.length - 1
  );

  // Helper to check if a part passes the message type filter
  const partPassesMessageTypeFilter = (part: { type: string }, msgRole: string): boolean => {
    if (!messageTypeFilters || messageTypeFilters.has("all")) return true;
    const filterKey = `${msgRole}:${part.type}`;
    return messageTypeFilters.has(filterKey);
  };

  // Get the set of part IDs that match the static component filter
  const filteredPartIds = useMemo(() => {
    if (!filterByStaticComponent || !staticMapping) return null;

    const ids = new Set<string>();
    for (const [partId, staticComp] of Object.entries(staticMapping)) {
      if (staticComp === filterByStaticComponent) {
        ids.add(partId);
      }
    }
    return ids;
  }, [filterByStaticComponent, staticMapping]);

  if (!componentMapping || Object.keys(componentMapping).length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No component mapping available yet.</p>
        <p className="text-sm mt-2">
          Component mapping will appear here after processing.
        </p>
      </div>
    );
  }

  // Get component data for the current message, filtered by static component and message type
  let componentTokensForOverview: Record<string, number> = {};
  let filteredTokensTotal = 0;
  let fullTokensTotal = 0;

  // Always calculate from conversation to apply filtering
  conversation.messages.forEach((message, msgIndex) => {
    if (msgIndex <= currentMessageIndex) {
      message.parts.forEach((part) => {
        const component = componentMapping[part.id];
        if (component) {
          const tokenCount = ("token_count" in part && part.token_count) || 0;
          fullTokensTotal += tokenCount;

          // Apply message type filter first
          if (!partPassesMessageTypeFilter(part, message.role)) return;

          // Apply static component filter if set
          if (!filteredPartIds || filteredPartIds.has(part.id)) {
            componentTokensForOverview[component] =
              (componentTokensForOverview[component] || 0) + tokenCount;
            filteredTokensTotal += tokenCount;
          }
        }
      });
    }
  });

  const handleComponentClick = (component: string) => {
    const newSelection = selectedComponent === component ? null : component;
    onComponentSelect?.(newSelection);
  };

  // Check if message type filters are active
  const hasMessageTypeFilters = messageTypeFilters && !messageTypeFilters.has("all") && messageTypeFilters.size > 0;

  return (
    <div className="p-4">
      {/* Filter indicator */}
      {(filterByStaticComponent || hasMessageTypeFilters) && (
        <div className="mb-3 text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md">
          {hasMessageTypeFilters && "Filtered view"}
          {hasMessageTypeFilters && filterByStaticComponent && " · "}
          {filterByStaticComponent && (
            <>Filtering by <strong>{getStaticComponentLabel(filterByStaticComponent)}</strong></>
          )}
          {" · "}{filteredTokensTotal.toLocaleString()} tokens
        </div>
      )}

      {/* Timeline Slider */}
      <div className="mb-4 px-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground">
            Message {currentMessageIndex + 1} of {conversation.messages.length}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {fullTokensTotal.toLocaleString()} tokens
          </span>
        </div>
        <Slider
          value={[currentMessageIndex]}
          onValueChange={(value) => setCurrentMessageIndex(value[0] ?? 0)}
          min={0}
          max={conversation.messages.length - 1}
          step={1}
          className="w-full"
        />
      </div>

      {/* Waffle Chart */}
      <WaffleChart
        componentTokens={componentTokensForOverview}
        totalTokens={filteredTokensTotal}
        getColorClass={(component) => getComponentBgClass(component, componentColors)}
        getLabel={(component) => component}
        onComponentClick={handleComponentClick}
      />
    </div>
  );
}

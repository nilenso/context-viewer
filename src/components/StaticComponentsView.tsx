import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { useUIStore } from "@/stores/ui-store";
import { WaffleChart } from "./WaffleChart";
import {
  getStaticComponentWaffleStyles,
  getStaticComponentLabel,
} from "@/lib/static-component-colors";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/aggregation";
import { aggregateComponentTokens } from "@/aggregation";
import { partPassesMessageTypeFilter, hasActiveMessageTypeFilters } from "@/lib/message-filters";

type MessageTypeFilter = string;

interface StaticComponentsViewProps {
  conversation: Conversation;
  staticMapping?: Record<string, string>;
  staticTimeline?: ComponentTimelineSnapshot[];
  selectedComponent?: string | null;
  onComponentSelect?: (component: string | null) => void;
  // Filters from conversation view
  messageTypeFilters?: Set<MessageTypeFilter>;
}

export function StaticComponentsView({
  conversation,
  staticMapping,
  staticTimeline,
  selectedComponent,
  onComponentSelect,
  messageTypeFilters,
}: StaticComponentsViewProps) {
  const percentPrecision = useUIStore((s) => s.percentPrecision);

  // Initialize slider to the last message
  const [currentMessageIndex, setCurrentMessageIndex] = useState(
    conversation.messages.length - 1
  );

  const partPassesFilter = (part: { type: string }, msgRole: string): boolean =>
    partPassesMessageTypeFilter(messageTypeFilters, part.type, msgRole);

  if (!staticMapping || Object.keys(staticMapping).length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No static component mapping available yet.</p>
        <p className="text-sm mt-2">
          Static components will appear here after processing.
        </p>
      </div>
    );
  }

  // Get component data for the current message, applying filters
  const { componentTokens, totalTokens } = aggregateComponentTokens(
    conversation,
    staticMapping,
    {
      maxMessageIndex: currentMessageIndex,
      partFilter: (part, msgRole) => partPassesFilter(part, msgRole),
      unmappedLabel: null,
    },
  );

  const handleComponentClick = (component: string) => {
    const newSelection = selectedComponent === component ? null : component;
    onComponentSelect?.(newSelection);
  };

  const hasActiveFilters = hasActiveMessageTypeFilters(messageTypeFilters);

  return (
    <div className="p-4">
      {/* Filter indicator */}
      {hasActiveFilters && (
        <div className="mb-3 text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md">
          Filtered view · {totalTokens.toLocaleString()} tokens
        </div>
      )}

      {/* Timeline Slider */}
      <div className="mb-4 px-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground">
            Message {currentMessageIndex + 1} of {conversation.messages.length}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {totalTokens.toLocaleString()} tokens
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
        componentTokens={componentTokens}
        totalTokens={totalTokens}
        getColorStyles={getStaticComponentWaffleStyles}
        getLabel={getStaticComponentLabel}
        onComponentClick={handleComponentClick}
        percentPrecision={percentPrecision}
      />
    </div>
  );
}

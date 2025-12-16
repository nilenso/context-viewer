import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { WaffleChart } from "./WaffleChart";
import {
  getStaticComponentBgClass,
  getStaticComponentLabel,
} from "@/lib/static-component-colors";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/componentisation";

interface StaticComponentsViewProps {
  conversation: Conversation;
  staticMapping?: Record<string, string>;
  staticTimeline?: ComponentTimelineSnapshot[];
  selectedComponent?: string | null;
  onComponentSelect?: (component: string | null) => void;
}

export function StaticComponentsView({
  conversation,
  staticMapping,
  staticTimeline,
  selectedComponent,
  onComponentSelect,
}: StaticComponentsViewProps) {
  // Initialize slider to the last message
  const [currentMessageIndex, setCurrentMessageIndex] = useState(
    conversation.messages.length - 1
  );

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

  // Get component data for the current message from timeline
  let componentTokens: Record<string, number> = {};
  let totalTokens = 0;

  if (staticTimeline && staticTimeline[currentMessageIndex]) {
    const snapshot = staticTimeline[currentMessageIndex];
    componentTokens = snapshot.componentTokens;
    totalTokens = snapshot.totalTokens;
  } else {
    // Fallback: calculate on the fly if timeline not available
    conversation.messages.forEach((message, msgIndex) => {
      if (msgIndex <= currentMessageIndex) {
        message.parts.forEach((part) => {
          const component = staticMapping[part.id];
          if (component) {
            const tokenCount = ("token_count" in part && part.token_count) || 0;
            componentTokens[component] = (componentTokens[component] || 0) + tokenCount;
            totalTokens += tokenCount;
          }
        });
      }
    });
  }

  const handleComponentClick = (component: string) => {
    const newSelection = selectedComponent === component ? null : component;
    onComponentSelect?.(newSelection);
  };

  return (
    <div className="p-4">
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
        getColorClass={getStaticComponentBgClass}
        getLabel={getStaticComponentLabel}
        onComponentClick={handleComponentClick}
      />
    </div>
  );
}

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { WaffleChart } from "./WaffleChart";
import { MessagePartView } from "./MessagePartView";
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
}

export function StaticComponentsView({
  conversation,
  staticMapping,
  staticTimeline,
}: StaticComponentsViewProps) {
  // Initialize slider to the last message
  const [currentMessageIndex, setCurrentMessageIndex] = useState(
    conversation.messages.length - 1
  );

  // Track selected component for filtering
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);

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
    setSelectedComponent(selectedComponent === component ? null : component);
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Component Visualization */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Static Components</h3>

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
          <Card className="p-6">
            <WaffleChart
              componentTokens={componentTokens}
              totalTokens={totalTokens}
              getColorClass={getStaticComponentBgClass}
              getLabel={getStaticComponentLabel}
              onComponentClick={handleComponentClick}
            />
          </Card>

          {selectedComponent && (
            <p className="text-sm text-muted-foreground mt-2 text-center">
              Selected: <strong>{getStaticComponentLabel(selectedComponent)}</strong>
              <button
                onClick={() => setSelectedComponent(null)}
                className="ml-2 text-blue-600 hover:underline"
              >
                Clear
              </button>
            </p>
          )}
        </div>

        {/* Filtered Messages */}
        {selectedComponent ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">
                Messages for: {getStaticComponentLabel(selectedComponent)}
              </h3>
              <button
                onClick={() => setSelectedComponent(null)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear selection
              </button>
            </div>

            <div className="space-y-4">
              {conversation.messages.map((message, msgIndex) => {
                // Filter parts that belong to the selected component
                const relevantParts = message.parts.filter(
                  (part) => staticMapping[part.id] === selectedComponent
                );

                if (relevantParts.length === 0) return null;

                return (
                  <Card key={msgIndex} className="p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Message {msgIndex + 1}
                      </Badge>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {message.role}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {relevantParts.length} {relevantParts.length === 1 ? 'part' : 'parts'}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {relevantParts.map((part) => (
                        <div key={part.id}>
                          <MessagePartView part={part as any} isExpanded={false} />
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              }).filter(Boolean)}
            </div>
          </div>
        ) : (
          <div className="text-center p-8 text-muted-foreground">
            <p>Click a component in the chart to view its messages and parts</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { getComponentColorHex, getComponentTextColorHex } from "@/lib/component-colors";
import { MessagePartView } from "./MessagePartView";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/componentisation";

interface TreeMapViewProps {
  componentMapping?: Record<string, string>;
  conversation: Conversation;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  components?: string[];
}

interface TreeMapData {
  name: string;
  size: number;
  fill: string;
  hasTokens?: boolean;
}

export function TreeMapView({
  componentMapping,
  conversation,
  componentTimeline,
  componentColors,
  components,
}: TreeMapViewProps) {
  // Initialize slider to the last message
  const [currentMessageIndex, setCurrentMessageIndex] = useState(
    conversation.messages.length - 1
  );

  // Track selected component for filtering
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);

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

  // Get component data for the current message from timeline
  let componentTokensForTreeMap: Record<string, number> = {};
  let totalTokensAtMessage = 0;

  if (componentTimeline && componentTimeline[currentMessageIndex]) {
    const snapshot = componentTimeline[currentMessageIndex];
    componentTokensForTreeMap = snapshot.componentTokens;
    totalTokensAtMessage = snapshot.totalTokens;
  } else {
    // Fallback: calculate on the fly if timeline not available
    conversation.messages.forEach((message, msgIndex) => {
      if (msgIndex <= currentMessageIndex) {
        message.parts.forEach((part) => {
          const component = componentMapping[part.id];
          if (component) {
            const tokenCount = ("token_count" in part && part.token_count) || 0;
            componentTokensForTreeMap[component] =
              (componentTokensForTreeMap[component] || 0) + tokenCount;
            totalTokensAtMessage += tokenCount;
          }
        });
      }
    });
  }

  // Get all unique components from the entire conversation (not just current message)
  const allComponents = components || [];

  // Prepare data for treemap - include all components to preserve topology
  // Components with 0 tokens will have a minimum size to maintain position
  const treeMapData: TreeMapData[] = allComponents
    .sort() // Sort alphabetically to ensure consistent ordering
    .map((component) => {
      const tokenCount = componentTokensForTreeMap[component] || 0;
      return {
        name: component,
        // Use actual size if > 0, otherwise use small placeholder (1) to preserve position
        size: tokenCount > 0 ? tokenCount : 1,
        fill: getComponentColorHex(component, componentColors),
        // Track whether this component actually has tokens at this point
        hasTokens: tokenCount > 0,
      };
    });

  // Custom content for treemap cells
  const CustomizedContent = (props: any) => {
    const { x, y, width, height, name, size, fill, hasTokens } = props;

    // Safety check - return null if essential props are missing
    if (!name || size === undefined || !fill) {
      return null;
    }

    // Get text color based on component name
    const textColor = getComponentTextColorHex(name, componentColors);

    // Only show label if there's enough space
    const showLabel = width > 80 && height > 40;
    const showTokens = width > 120 && height > 60;

    // Components without tokens yet are dimmed
    const opacity = hasTokens ? 1 : 0.15;

    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          style={{
            fill: fill,
            stroke: "#fff",
            strokeWidth: 2,
            cursor: "pointer",
            opacity: opacity,
          }}
          onClick={() => setSelectedComponent(selectedComponent === name ? null : name)}
        />
        {showLabel && hasTokens && (
          <>
            <text
              x={x + width / 2}
              y={y + height / 2 - (showTokens ? 8 : 0)}
              textAnchor="middle"
              fill={textColor}
              stroke="none"
              fontSize={12}
              fontWeight="500"
              style={{ pointerEvents: "none" }}
            >
              {name.length > 20 ? name.substring(0, 18) + "..." : name}
            </text>
            {showTokens && (
              <text
                x={x + width / 2}
                y={y + height / 2 + 16}
                textAnchor="middle"
                fill={textColor}
                stroke="none"
                fontSize={10}
                opacity={0.7}
                style={{ pointerEvents: "none" }}
              >
                {size.toLocaleString()} tokens
              </text>
            )}
          </>
        )}
      </g>
    );
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* TreeMap Visualization */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Token Distribution</h3>

          {/* Timeline Slider */}
          <div className="mb-4 px-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">
                Message {currentMessageIndex + 1} of {conversation.messages.length}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {totalTokensAtMessage.toLocaleString()} tokens
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

          <Card className="p-4 bg-white border-2">
            <ResponsiveContainer width="100%" height={500}>
              <Treemap
                data={treeMapData}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="#fff"
                content={<CustomizedContent />}
                isAnimationActive={false}
              >
                <Tooltip
                  content={({ payload }) => {
                    if (payload && payload[0]) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white border-2 border-gray-200 rounded-lg shadow-lg p-3">
                          <p className="font-semibold text-sm">{data.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {data.size.toLocaleString()} tokens
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {((data.size / totalTokensAtMessage) * 100).toFixed(1)}% of total
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </Treemap>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Filtered Messages */}
        {selectedComponent ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">
                Messages for: {selectedComponent}
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
                  (part) => componentMapping[part.id] === selectedComponent
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
                        {relevantParts.length} {relevantParts.length === 1 ? "part" : "parts"}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {relevantParts.map((part) => {
                        return (
                          <div key={part.id}>
                            {/* Full content (collapsible) */}
                            <MessagePartView part={part as any} isExpanded={false} />
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              }).filter(Boolean)}
            </div>
          </div>
        ) : (
          <div className="text-center p-8 text-muted-foreground">
            <p>Click a component in the treemap to view its messages and parts</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

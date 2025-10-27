import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getComponentColorHex } from "@/lib/component-colors";
import { MessagePartView } from "./MessagePartView";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/componentisation";

interface StackedBarChartViewProps {
  componentMapping?: Record<string, string>;
  conversation: Conversation;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  components?: string[];
}

export function StackedBarChartView({
  componentMapping,
  conversation,
  componentTimeline,
  componentColors,
  components,
}: StackedBarChartViewProps) {
  // Track selected component for filtering
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  // Track hovered message for table display
  const [hoveredMessageIndex, setHoveredMessageIndex] = useState<number | null>(null);
  // Track pinned message (when user clicks a bar)
  const [pinnedMessageIndex, setPinnedMessageIndex] = useState<number | null>(null);

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

  const allComponents = components || [];

  // Build data for stacked bar chart
  // Each bar represents one message, stacked by component token contribution
  const chartData = conversation.messages.map((message, msgIndex) => {
    const dataPoint: any = {
      messageIndex: msgIndex + 1, // 1-indexed for display
      messageName: `Msg ${msgIndex + 1}`,
    };

    let totalTokens = 0;

    if (componentTimeline && componentTimeline[msgIndex]) {
      const snapshot = componentTimeline[msgIndex];
      totalTokens = snapshot.totalTokens;

      // Add each component's token count to the data point
      allComponents.forEach((component) => {
        dataPoint[component] = snapshot.componentTokens[component] || 0;
      });
    } else {
      // Fallback: calculate on the fly
      const componentTokens: Record<string, number> = {};

      conversation.messages.forEach((msg, idx) => {
        if (idx <= msgIndex) {
          msg.parts.forEach((part) => {
            const component = componentMapping[part.id];
            if (component) {
              const tokenCount = ("token_count" in part && part.token_count) || 0;
              componentTokens[component] = (componentTokens[component] || 0) + tokenCount;
              totalTokens += tokenCount;
            }
          });
        }
      });

      allComponents.forEach((component) => {
        dataPoint[component] = componentTokens[component] || 0;
      });
    }

    dataPoint.totalTokens = totalTokens;

    return dataPoint;
  });

  // Calculate max Y value - use the last message's total tokens
  const maxTokens = chartData.length > 0 ? chartData[chartData.length - 1].totalTokens : 0;

  // Get data for the table - prioritize pinned, then hovered, then last message
  const displayMessageIndex = pinnedMessageIndex ?? hoveredMessageIndex ?? (chartData.length - 1);
  const displayData = chartData[displayMessageIndex];

  // Build table rows from the display data
  const tableRows = displayData
    ? allComponents
        .map((component) => ({
          component,
          tokens: displayData[component] || 0,
          color: getComponentColorHex(component, componentColors),
        }))
        .filter((row) => row.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
    : [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Stacked Bar Chart Visualization */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Component Token Distribution Over Time</h3>

          <Card className="p-6 bg-white border-2">
            <ResponsiveContainer width="100%" height={600}>
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
                onMouseMove={(state: any) => {
                  if (state?.activeTooltipIndex !== undefined && pinnedMessageIndex === null) {
                    setHoveredMessageIndex(state.activeTooltipIndex);
                  }
                }}
                onMouseLeave={() => {
                  if (pinnedMessageIndex === null) {
                    setHoveredMessageIndex(null);
                  }
                }}
                onClick={(state: any) => {
                  if (state?.activeTooltipIndex !== undefined) {
                    // Toggle pin: if already pinned to this message, unpin; otherwise pin
                    setPinnedMessageIndex(
                      pinnedMessageIndex === state.activeTooltipIndex ? null : state.activeTooltipIndex
                    );
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="messageName"
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  style={{ fontSize: '12px', fontWeight: 500 }}
                />
                <YAxis
                  domain={[0, maxTokens]}
                  style={{ fontSize: '12px', fontWeight: 500 }}
                  width={70}
                />
                <Tooltip content={() => null} cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }} />
                {allComponents.map((component) => (
                  <Bar
                    key={component}
                    dataKey={component}
                    stackId="a"
                    fill={getComponentColorHex(component, componentColors)}
                    style={{ cursor: "pointer" }}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>

            {/* Component Data Table */}
            <div className="mt-6 border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">
                  {displayData ? `${displayData.messageName} - ${displayData.totalTokens.toLocaleString()} tokens` : 'No data'}
                </h4>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold">Component</th>
                      <th className="text-right py-2 px-3 font-semibold">Tokens</th>
                      <th className="text-right py-2 px-3 font-semibold">Percentage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr
                        key={row.component}
                        className={`border-b last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors ${
                          selectedComponent === row.component ? 'bg-blue-50 hover:bg-blue-100' : ''
                        }`}
                        onClick={() => setSelectedComponent(selectedComponent === row.component ? null : row.component)}
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-sm flex-shrink-0"
                              style={{ backgroundColor: row.color }}
                            />
                            <span className="font-medium">{row.component}</span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-3 font-semibold">
                          {row.tokens.toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-muted-foreground">
                          {((row.tokens / displayData.totalTokens) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedComponent && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Click the selected row again to clear selection
                </div>
              )}
            </div>
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
            <p>Click a component in the chart or legend to view its messages and parts</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

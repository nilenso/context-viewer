import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { WaffleChart } from "./WaffleChart";
import { CompactLegend } from "./ComponentComparisonView";
import { cn } from "@/lib/utils";
import { getComponentWaffleStyles, blendColors, getComponentWaffleHex } from "@/lib/component-colors";
import { getStaticComponentLabel } from "@/lib/static-component-colors";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot, DimensionData } from "@/componentisation";

// Message type filter in format "role:type" (e.g., "assistant:tool-call")
type MessageTypeFilter = string;

interface ComponentsViewProps {
  componentMapping?: Record<string, string>;
  conversation: Conversation;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  // Multi-dimensional component data
  dimensions?: Record<string, DimensionData>;
  activeDimensions?: Set<string>;
  onActiveDimensionsChange?: (dims: Set<string>) => void;
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
  dimensions,
  activeDimensions: activeDimensionsProp,
  onActiveDimensionsChange,
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

  const activeDimensions = activeDimensionsProp || new Set(["default"]);
  const dimensionNames = useMemo(
    () => dimensions ? Object.keys(dimensions) : [],
    [dimensions],
  );
  const hasMultipleDimensions = dimensionNames.length > 1;

  // Determine effective mapping and colors based on active dimensions
  const effectiveMapping = useMemo(() => {
    if (!dimensions || activeDimensions.size <= 1) {
      // Single dimension or no dimensions: use the single active one, or fall back to legacy
      const activeName = [...activeDimensions][0] || "default";
      return dimensions?.[activeName]?.componentMapping || componentMapping || {};
    }
    // Multiple active: use default for the mapping (waffle chart is per-dimension)
    return componentMapping || {};
  }, [dimensions, activeDimensions, componentMapping]);

  const effectiveColors = useMemo(() => {
    if (!dimensions || activeDimensions.size <= 1) {
      const activeName = [...activeDimensions][0] || "default";
      return dimensions?.[activeName]?.componentColors || componentColors || {};
    }
    return componentColors || {};
  }, [dimensions, activeDimensions, componentColors]);

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

  // Compute messageComponents for workflow view (filtered, up to current slider position)
  // Must be before early return to follow React hooks rules
  const messageComponents = useMemo(() => {
    if (!effectiveMapping || Object.keys(effectiveMapping).length === 0) return [];
    const components: string[] = [];
    conversation.messages.forEach((message, msgIndex) => {
      if (msgIndex <= currentMessageIndex) {
        // Find the primary component for this message from first matching part
        let messageComponent: string | null = null;
        for (const part of message.parts) {
          // Apply message type filter
          if (!partPassesMessageTypeFilter(part, message.role)) continue;

          // Apply static component filter if set
          if (filteredPartIds && !filteredPartIds.has(part.id)) continue;

          const component = effectiveMapping[part.id];
          if (component) {
            messageComponent = component;
            break;
          }
        }
        // Only include message if it has parts that pass filters
        if (messageComponent !== null) {
          components.push(messageComponent);
        }
      }
    });
    return components;
  }, [conversation.messages, currentMessageIndex, effectiveMapping, filteredPartIds, messageTypeFilters]);

  if (!effectiveMapping || Object.keys(effectiveMapping).length === 0) {
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
        const component = effectiveMapping[part.id];
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

  // Helper to get blended waffle styles for multi-dimension view
  const getWaffleStylesForDimensions = (component: string) => {
    if (!dimensions || activeDimensions.size <= 1) {
      return getComponentWaffleStyles(component, effectiveColors);
    }
    // Multi-dimension: blend colors
    const activeDimNames = [...activeDimensions];
    const colors = activeDimNames
      .map((dimName) => {
        const dim = dimensions[dimName];
        if (!dim) return null;
        // Find the component color in this dimension
        return getComponentWaffleHex(component, dim.componentColors);
      })
      .filter((c): c is string => c !== null);

    if (colors.length === 0) return getComponentWaffleStyles(component, effectiveColors);
    const blended = colors.length === 1 ? colors[0]! : blendColors(colors);
    return { classes: null, style: { backgroundColor: blended } };
  };

  const handleToggleDimension = (dimName: string) => {
    const next = new Set(activeDimensions);
    if (next.has(dimName)) {
      if (next.size > 1) next.delete(dimName); // Keep at least one active
    } else {
      next.add(dimName);
    }
    onActiveDimensionsChange?.(next);
  };

  return (
    <div className="p-4">
      {/* Dimension selector checkboxes */}
      {hasMultipleDimensions && (
        <div className="mb-3 flex items-center gap-3 text-xs">
          <span className="text-muted-foreground font-medium">Dimensions:</span>
          {dimensionNames.map((dimName) => (
            <label key={dimName} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={activeDimensions.has(dimName)}
                onChange={() => handleToggleDimension(dimName)}
                className="h-3 w-3 accent-blue-600"
              />
              <span>{dimName}</span>
            </label>
          ))}
        </div>
      )}

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

      {/* Active dimension indicator */}
      {hasMultipleDimensions && (
        <div className="mb-3 text-xs text-muted-foreground">
          Viewing: {[...activeDimensions].join(", ")}
        </div>
      )}

      {/* Per-dimension waffle charts when multiple active */}
      {hasMultipleDimensions && activeDimensions.size > 1 ? (
        <div className="space-y-4">
          {[...activeDimensions].map((dimName) => {
            const dim = dimensions?.[dimName];
            if (!dim) return null;

            // Calculate per-dimension token data
            const dimTokens: Record<string, number> = {};
            let dimTotal = 0;
            conversation.messages.forEach((message, msgIndex) => {
              if (msgIndex <= currentMessageIndex) {
                message.parts.forEach((part) => {
                  const component = dim.componentMapping[part.id];
                  if (component) {
                    const tokenCount = ("token_count" in part && part.token_count) || 0;
                    if (!partPassesMessageTypeFilter(part, message.role)) return;
                    if (filteredPartIds && !filteredPartIds.has(part.id)) return;
                    dimTokens[component] = (dimTokens[component] || 0) + tokenCount;
                    dimTotal += tokenCount;
                  }
                });
              }
            });

            return (
              <div key={dimName}>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">{dimName}</h4>
                <WaffleChart
                  componentTokens={dimTokens}
                  totalTokens={dimTotal}
                  getColorStyles={(component) => getComponentWaffleStyles(component, dim.componentColors)}
                  getLabel={(component) => component}
                  onComponentClick={handleComponentClick}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <>
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
            getColorStyles={(component) => getWaffleStylesForDimensions(component)}
            getLabel={(component) => component}
            onComponentClick={handleComponentClick}
          />
        </>
      )}

      {/* Workflow Diagram - horizontal sequence of messages */}
      {messageComponents.length > 0 && (
        <div className="mt-6 pt-4 border-t">
          <h4 className="text-sm font-medium text-muted-foreground mb-3">
            Workflow ({messageComponents.length} messages)
          </h4>
          <div className="flex flex-wrap gap-0.5">
            {messageComponents.map((component, index) => {
              const colorStyles = component ? getWaffleStylesForDimensions(component) : null;
              return (
                <div
                  key={index}
                  className={cn(
                    "w-3 h-3 flex-shrink-0",
                    component ? colorStyles?.classes : "bg-gray-200",
                  )}
                  style={colorStyles?.style || undefined}
                  title={`${index + 1}: ${component || "unknown"}`}
                />
              );
            })}
          </div>
          <div className="mt-3">
            <CompactLegend
              components={messageComponents}
              componentColors={effectiveColors}
            />
          </div>
        </div>
      )}
    </div>
  );
}

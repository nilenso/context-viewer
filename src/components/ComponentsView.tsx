import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { WaffleChart } from "./WaffleChart";
import { CompactLegend } from "./ComponentComparisonView";
import { cn } from "@/lib/utils";
import { getComponentWaffleStyles, blendColors, getComponentWaffleHex } from "@/lib/component-colors";
import { getStaticComponentLabel } from "@/lib/static-component-colors";
import type { Conversation } from "@/schema";
import { type DimensionData } from "@/componentisation";
import { computeTupleTokens, TUPLE_SEPARATOR, aggregateComponentTokens, type ComponentTimelineSnapshot } from "@/aggregation";

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
  // Stable key for memoization (Set identity isn't reliable for useMemo deps)
  const activeDimensionsKey = [...activeDimensions].sort().join(",");
  // Deep-ish key to detect when dimension data actually changes (e.g. new components/colors after processing)
  const dimensionsDataKey = useMemo(() => {
    if (!dimensions) return "";
    return Object.entries(dimensions)
      .map(([name, dim]) => `${name}:${dim.components.length}:${Object.keys(dim.componentMapping).length}`)
      .sort()
      .join("|");
  }, [dimensions]);
  const dimensionNames = useMemo(
    () => dimensions ? Object.keys(dimensions) : [],
    [dimensions],
  );
  const hasMultipleDimensions = dimensionNames.length > 1;

  // The "primary" dimension is the first active one (used for waffle grid layout)
  const primaryDimName = useMemo(() => {
    const active = [...activeDimensions];
    return active[0] || (dimensionNames[0] ?? "default");
  }, [activeDimensionsKey, dimensionNames]);

  // Determine effective mapping and colors based on active dimensions
  const effectiveMapping = useMemo(() => {
    if (!dimensions) return componentMapping || {};
    // Always use the primary (first active) dimension's mapping
    return dimensions[primaryDimName]?.componentMapping || componentMapping || {};
  }, [dimensions, dimensionsDataKey, primaryDimName, componentMapping]);

  const effectiveColors = useMemo(() => {
    if (!dimensions) return componentColors || {};
    return dimensions[primaryDimName]?.componentColors || componentColors || {};
  }, [dimensions, dimensionsDataKey, primaryDimName, componentColors]);

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

  // Compute tuple-based token data when multiple dimensions are active
  // Each tuple is a unique combination of components across active dimensions (e.g. "error_types:X · workflow:Y")
  const tupleData = useMemo(() => {
    if (!dimensions || activeDimensions.size <= 1) return null;
    return computeTupleTokens(
      conversation,
      dimensions,
      [...activeDimensions].sort(),
      {
        maxMessageIndex: currentMessageIndex,
        filteredPartIds,
        partFilter: (part, msgRole) => partPassesMessageTypeFilter(part, msgRole),
      },
    );
  }, [dimensions, dimensionsDataKey, activeDimensionsKey, conversation.messages, currentMessageIndex, filteredPartIds, messageTypeFilters]);

  // Helper to get blended color for a tuple key like "dim1:comp1 · dim2:comp2"
  const getTupleColorStyles = useMemo(() => {
    if (!dimensions || !tupleData) return null;
    return (tupleKey: string) => {
      const parts = tupleKey.split(TUPLE_SEPARATOR);
      const colors: string[] = [];
      for (const part of parts) {
        const sepIdx = part.indexOf(":");
        const dimName = part.slice(0, sepIdx);
        const comp = part.slice(sepIdx + 1);
        const dim = dimensions[dimName];
        if (dim) {
          const hex = getComponentWaffleHex(comp, dim.componentColors);
          if (hex) colors.push(hex);
        }
      }
      if (colors.length === 0) return { classes: "bg-gray-300" as string | null, style: null as React.CSSProperties | null };
      const blended = colors.length === 1 ? colors[0]! : blendColors(colors);
      return { classes: null as string | null, style: { backgroundColor: blended } as React.CSSProperties | null };
    };
  }, [dimensions, dimensionsDataKey, tupleData]);

  // Compute messageComponents for workflow view (filtered, up to current slider position)
  // When multiple dimensions are active, produces tuple keys matching the waffle chart
  const messageComponents = useMemo(() => {
    if (!effectiveMapping || Object.keys(effectiveMapping).length === 0) return [];
    const isMultiDim = dimensions && activeDimensions.size > 1;
    const activeDimNames = isMultiDim ? [...activeDimensions].sort() : null;
    const components: string[] = [];
    conversation.messages.forEach((message, msgIndex) => {
      if (msgIndex <= currentMessageIndex) {
        let messageComponent: string | null = null;
        for (const part of message.parts) {
          if (!partPassesMessageTypeFilter(part, message.role)) continue;
          if (filteredPartIds && !filteredPartIds.has(part.id)) continue;

          if (isMultiDim && activeDimNames) {
            // Build tuple key from all active dimensions
            const tupleParts: string[] = [];
            for (const dimName of activeDimNames) {
              const comp = dimensions![dimName]?.componentMapping[part.id];
              if (comp) tupleParts.push(`${dimName}:${comp}`);
            }
            if (tupleParts.length > 0) {
              messageComponent = tupleParts.join(TUPLE_SEPARATOR);
              break;
            }
          } else {
            const component = effectiveMapping[part.id];
            if (component) {
              messageComponent = component;
              break;
            }
          }
        }
        if (messageComponent !== null) {
          components.push(messageComponent);
        }
      }
    });
    return components;
  }, [conversation.messages, currentMessageIndex, effectiveMapping, dimensions, dimensionsDataKey, activeDimensionsKey, filteredPartIds, messageTypeFilters]);

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
  // Full tokens (no message-type or static-component filter, only mapped parts)
  const { totalTokens: fullTokensTotal } = aggregateComponentTokens(
    conversation,
    effectiveMapping,
    { maxMessageIndex: currentMessageIndex, unmappedLabel: null },
  );

  // Filtered tokens (with message-type filter and optional static-component filter)
  const { componentTokens: componentTokensForOverview, totalTokens: filteredTokensTotal } =
    aggregateComponentTokens(conversation, effectiveMapping, {
      maxMessageIndex: currentMessageIndex,
      partFilter: (part, msgRole) => partPassesMessageTypeFilter(part, msgRole),
      filteredPartIds,
      unmappedLabel: null,
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

      {/* Waffle Chart - tuple-based when multi-dimension, single when one dimension */}
      {tupleData && getTupleColorStyles ? (
        <WaffleChart
          componentTokens={tupleData.tupleTokens}
          totalTokens={tupleData.total}
          getColorStyles={getTupleColorStyles}
          getLabel={(tupleKey) => tupleKey}
          onComponentClick={handleComponentClick}
        />
      ) : (
        <WaffleChart
          componentTokens={componentTokensForOverview}
          totalTokens={filteredTokensTotal}
          getColorStyles={(component) => getWaffleStylesForDimensions(component)}
          getLabel={(component) => component}
          onComponentClick={handleComponentClick}
        />
      )}

      {/* Workflow Diagram - horizontal sequence of messages */}
      {messageComponents.length > 0 && (
        <div className="mt-6 pt-4 border-t">
          <h4 className="text-sm font-medium text-muted-foreground mb-3">
            Workflow ({messageComponents.length} messages)
          </h4>
          <div className="flex flex-wrap gap-0.5">
            {messageComponents.map((component, index) => {
              const colorStyles = component
                ? (getTupleColorStyles ? getTupleColorStyles(component) : getWaffleStylesForDimensions(component))
                : null;
              const label = component;
              return (
                <div
                  key={index}
                  className={cn(
                    "w-3 h-3 flex-shrink-0",
                    component ? colorStyles?.classes : "bg-gray-200",
                  )}
                  style={colorStyles?.style || undefined}
                  title={`${index + 1}: ${label || "unknown"}`}
                />
              );
            })}
          </div>
          <div className="mt-3">
            {getTupleColorStyles ? (
              <WorkflowTupleLegend
                components={messageComponents}
                getColorStyles={getTupleColorStyles}
              />
            ) : (
              <CompactLegend
                components={messageComponents}
                componentColors={effectiveColors}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact legend for tuple-based workflow view
function WorkflowTupleLegend({
  components,
  getColorStyles,
}: {
  components: string[];
  getColorStyles: (key: string) => { classes: string | null; style: React.CSSProperties | null };
}) {
  const unique = [...new Set(components)].filter(Boolean);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {unique.map((tupleKey) => {
        const colorStyles = getColorStyles(tupleKey);
        const label = tupleKey;
        return (
          <div key={tupleKey} className="flex items-center gap-1.5">
            <span
              className={cn("w-3 h-3 flex-shrink-0", colorStyles.classes)}
              style={colorStyles.style || undefined}
            />
            <span className="text-muted-foreground [font-variant:small-caps]">{label}</span>
          </div>
        );
      })}
    </div>
  );
}


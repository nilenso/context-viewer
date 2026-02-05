import { useState } from "react";
import { cn } from "@/lib/utils";
import { getComponentWaffleStyles } from "@/lib/component-colors";
import { ArrowUp, ArrowDown } from "lucide-react";

type SortField = "tokens" | "name" | "category";
type SortDirection = "asc" | "desc";

export interface ConversationComponentData {
  id: string;
  filename: string;
  title?: string; // Custom title, displays instead of filename when set
  componentTokens: Record<string, number>;
  totalTokens: number;
  turnCount: number; // Number of user messages (turns)
  messageCount: number; // Total messages
  durationMs?: number; // Duration in milliseconds (from first to last message)
  messageComponents?: string[]; // Component for each message in order (for workflow view)
}

/**
 * Format duration in a human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Extract the category (prefix before first dot) from a component name
 */
function getCategory(component: string): string {
  const dotIndex = component.indexOf(".");
  return dotIndex > 0 ? component.substring(0, dotIndex) : component;
}

/**
 * Sort components by category - groups components by their prefix,
 * sorts categories by total tokens, then sorts within each category by tokens
 */
function sortByCategory(
  componentTokens: Record<string, number>,
  direction: SortDirection
): Array<{ component: string; tokens: number; percentage: number; category: string }> {
  // Calculate total tokens
  const totalTokens = Object.values(componentTokens).reduce((sum, t) => sum + t, 0);

  // Build component data with category info
  const componentData = Object.entries(componentTokens).map(([component, tokens]) => ({
    component,
    tokens,
    percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
    category: getCategory(component),
  }));

  // Calculate category totals
  const categoryTotals: Record<string, number> = {};
  for (const { category, tokens } of componentData) {
    categoryTotals[category] = (categoryTotals[category] || 0) + tokens;
  }

  // Sort: first by category total, then by individual tokens within category
  const dir = direction === "asc" ? 1 : -1;
  return componentData.sort((a, b) => {
    const categoryCompare = ((categoryTotals[b.category] || 0) - (categoryTotals[a.category] || 0)) * dir;
    if (categoryCompare !== 0) return categoryCompare;
    // Within same category, sort by tokens in same direction
    return (b.tokens - a.tokens) * dir;
  });
}

interface ComponentComparisonViewProps {
  sourceConversations: ConversationComponentData[];
  componentColors?: Record<string, string>;
  hasActiveFilters?: boolean;
}

type ViewMode = "tokens" | "workflow";
type LegendMode = "expanded" | "compact";

/**
 * Compact legend - horizontal list of color squares with labels (no percentages)
 * Used for both workflow view and compact token view
 */
export function CompactLegend({
  components,
  componentColors,
}: {
  components: string[];
  componentColors?: Record<string, string>;
}) {
  // Get unique components preserving order
  const uniqueComponents = [...new Set(components)].filter(Boolean);

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {uniqueComponents.map((component) => {
        const colorStyles = getComponentWaffleStyles(component, componentColors);
        return (
          <div key={component} className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-3 h-3 flex-shrink-0",
                colorStyles.classes,
              )}
              style={colorStyles.style || undefined}
            />
            <span className="text-muted-foreground [font-variant:small-caps]">{component}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Message-based workflow waffle chart
 * Each square = one message, colored by its component, in conversation order
 */
export function MessageWorkflowChart({
  messageComponents,
  componentColors,
  squaresPerRow,
}: {
  messageComponents: string[];
  componentColors?: Record<string, string>;
  squaresPerRow: number;
}) {
  return (
    <div className="flex-shrink-0">
      <div
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${squaresPerRow}, minmax(0, 1fr))`,
        }}
      >
        {messageComponents.map((component, index) => {
          const colorStyles = component ? getComponentWaffleStyles(component, componentColors) : null;
          return (
            <div
              key={index}
              className={cn(
                "w-3 h-3",
                component ? colorStyles?.classes : "bg-gray-200",
              )}
              style={colorStyles?.style || undefined}
              title={`${index + 1}: ${component || "unknown"}`}
            />
          );
        })}
      </div>
    </div>
  );
}


/**
 * Mini waffle chart for comparison view - smaller 10x10 grid
 */
function MiniWaffleChart({
  componentTokens,
  totalTokens,
  componentColors,
  sortField,
  sortDirection,
}: {
  componentTokens: Record<string, number>;
  totalTokens: number;
  componentColors?: Record<string, string>;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  const GRID_SIZE = 100; // 10x10 grid for mini version

  // Calculate percentages and sort based on field and direction
  const componentData = sortField === "category"
    ? sortByCategory(componentTokens, sortDirection)
    : Object.entries(componentTokens)
        .map(([component, tokens]) => ({
          component,
          tokens,
          percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
        }))
        .sort((a, b) => {
          const dir = sortDirection === "asc" ? 1 : -1;
          if (sortField === "name") {
            return a.component.localeCompare(b.component) * dir;
          }
          return (b.percentage - a.percentage) * dir;
        });

  // Build the 100-square grid
  const squares: { component: string; index: number }[] = [];
  let squareIndex = 0;

  for (const { component, percentage } of componentData) {
    const squareCount = Math.max(
      percentage > 0 ? 1 : 0,
      Math.round(percentage)
    );

    for (let i = 0; i < squareCount && squareIndex < GRID_SIZE; i++) {
      squares.push({ component, index: squareIndex });
      squareIndex++;
    }
  }

  while (squares.length < GRID_SIZE) {
    squares.push({ component: "", index: squares.length });
  }
  squares.length = GRID_SIZE;

  return (
    <div className="flex-shrink-0 w-[138px] h-[138px]">
      <div className="grid grid-cols-[repeat(10,minmax(0,1fr))] gap-0.5">
        {squares.map(({ component, index }) => {
          const colorStyles = component ? getComponentWaffleStyles(component, componentColors) : null;
          return (
            <div
              key={index}
              className={cn(
                "w-3 h-3",
                component ? colorStyles?.classes : "bg-gray-200"
              )}
              style={colorStyles?.style || undefined}
              title={component || undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Legend with percentages for a single conversation
 */
function ComparisonLegend({
  componentTokens,
  totalTokens,
  componentColors,
  sortField,
  sortDirection,
}: {
  componentTokens: Record<string, number>;
  totalTokens: number;
  componentColors?: Record<string, string>;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  const componentData = sortField === "category"
    ? sortByCategory(componentTokens, sortDirection)
    : Object.entries(componentTokens)
        .map(([component, tokens]) => ({
          component,
          tokens,
          percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
        }))
        .sort((a, b) => {
          const dir = sortDirection === "asc" ? 1 : -1;
          if (sortField === "name") {
            return a.component.localeCompare(b.component) * dir;
          }
          return (b.percentage - a.percentage) * dir;
        });

  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {componentData.map(({ component, percentage }) => {
        const colorStyles = getComponentWaffleStyles(component, componentColors);
        return (
          <div key={component} className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-2.5 h-2.5 flex-shrink-0",
                colorStyles.classes
              )}
              style={colorStyles.style || undefined}
            />
            <span className="flex-1 truncate text-muted-foreground [font-variant:small-caps]">
              {component}
            </span>
            <span className="text-muted-foreground tabular-nums [font-variant:small-caps]">
              {percentage.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Grid of waffle charts comparing component distribution across conversations
 */
export function ComponentComparisonView({
  sourceConversations,
  componentColors,
  hasActiveFilters,
}: ComponentComparisonViewProps) {
  const [sortField, setSortField] = useState<SortField>("tokens");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [columnCount, setColumnCount] = useState<number>(3);
  const [viewMode, setViewMode] = useState<ViewMode>("tokens");
  const [squaresPerRow, setSquaresPerRow] = useState<number>(20);
  const [legendMode, setLegendMode] = useState<LegendMode>("expanded");

  // Check if workflow view is available (any conversation has messageComponents)
  const hasWorkflowData = sourceConversations.some(
    (c) => c.messageComponents && c.messageComponents.length > 0,
  );

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if clicking the same field
      setSortDirection(prev => prev === "desc" ? "asc" : "desc");
    } else {
      // Switch to new field with default direction
      setSortField(field);
      // Default: tokens/category descending (largest first), name ascending (A-Z)
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  };

  if (sourceConversations.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No conversations to compare.</p>
      </div>
    );
  }

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === "desc"
      ? <ArrowDown className="h-3 w-3 ml-0.5" />
      : <ArrowUp className="h-3 w-3 ml-0.5" />;
  };

  return (
    <div className="p-4">
      {/* Filter indicator */}
      {hasActiveFilters && (
        <div className="text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md mb-4">
          Filtered view
        </div>
      )}

      {/* Controls: View mode, Sort, and Grid columns */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
        {/* View mode toggle */}
        {hasWorkflowData && (
          <div className="flex items-center gap-1">
            <span>View:</span>
            <button
              onClick={() => setViewMode("tokens")}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors",
                viewMode === "tokens"
                  ? "bg-gray-200 text-gray-900"
                  : "hover:bg-gray-100",
              )}
            >
              tokens
            </button>
            <button
              onClick={() => setViewMode("workflow")}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors",
                viewMode === "workflow"
                  ? "bg-gray-200 text-gray-900"
                  : "hover:bg-gray-100",
              )}
            >
              workflow
            </button>
          </div>
        )}

        {/* Legend toggle - only for token view */}
        {viewMode === "tokens" && (
          <div className="flex items-center gap-1">
            <span>Legend:</span>
            <button
              onClick={() => setLegendMode("expanded")}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors",
                legendMode === "expanded"
                  ? "bg-gray-200 text-gray-900"
                  : "hover:bg-gray-100",
              )}
            >
              expanded
            </button>
            <button
              onClick={() => setLegendMode("compact")}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors",
                legendMode === "compact"
                  ? "bg-gray-200 text-gray-900"
                  : "hover:bg-gray-100",
              )}
            >
              compact
            </button>
          </div>
        )}

        {/* Sort controls - only for token view */}
        {viewMode === "tokens" && (
          <div className="flex items-center gap-1">
            <span>Sort:</span>
            <button
              onClick={() => handleSortClick("tokens")}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors flex items-center",
                sortField === "tokens"
                  ? "bg-gray-200 text-gray-900"
                  : "hover:bg-gray-100"
              )}
            >
              tokens
              <SortArrow field="tokens" />
            </button>
            <button
              onClick={() => handleSortClick("name")}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors flex items-center",
                sortField === "name"
                  ? "bg-gray-200 text-gray-900"
                  : "hover:bg-gray-100"
              )}
            >
              name
              <SortArrow field="name" />
            </button>
            <button
              onClick={() => handleSortClick("category")}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors flex items-center",
                sortField === "category"
                  ? "bg-gray-200 text-gray-900"
                  : "hover:bg-gray-100"
              )}
            >
              category
              <SortArrow field="category" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <span>Columns:</span>
          <select
            value={columnCount}
            onChange={(e) => setColumnCount(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-900 cursor-pointer hover:bg-gray-50"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {/* Squares per row - only for workflow view */}
        {viewMode === "workflow" && (
          <div className="flex items-center gap-1">
            <span>Squares/row:</span>
            <select
              value={squaresPerRow}
              onChange={(e) => setSquaresPerRow(Number(e.target.value))}
              className="px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-900 cursor-pointer hover:bg-gray-50"
            >
              {[10, 15, 20, 25, 30, 40, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Shared compact legend - for workflow view or compact token view */}
      {(viewMode === "workflow" || (viewMode === "tokens" && legendMode === "compact")) && sourceConversations.length > 0 && (
        <div className="mb-4">
          <CompactLegend
            components={
              viewMode === "workflow"
                ? sourceConversations.flatMap((c) => c.messageComponents || [])
                : sourceConversations.flatMap((c) => Object.keys(c.componentTokens))
            }
            componentColors={componentColors}
          />
        </div>
      )}

      {/* Grid of waffle charts */}
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {sourceConversations.map((conv) => (
          <div key={conv.id} className={cn(
            "border rounded-lg bg-white",
            viewMode === "tokens" && legendMode === "compact" ? "p-2" : "p-4"
          )}>
            {/* Filename header */}
            <div className={viewMode === "tokens" && legendMode === "compact" ? "mb-2" : "mb-3"}>
              <h4 className="text-sm font-medium truncate" title={conv.title || conv.filename}>
                {conv.title || conv.filename}
              </h4>
              <p className="text-xs text-muted-foreground [font-variant:small-caps]">
                {conv.totalTokens.toLocaleString()} tokens · {conv.turnCount} turns · {conv.messageCount} messages
                {conv.durationMs !== undefined && ` · ${formatDuration(conv.durationMs)}`}
              </p>
            </div>

            {/* Waffle chart and legend side by side */}
            <div className={viewMode === "tokens" && legendMode === "compact" ? "" : "flex gap-4"}>
              {viewMode === "tokens" ? (
                <>
                  <MiniWaffleChart
                    componentTokens={conv.componentTokens}
                    totalTokens={conv.totalTokens}
                    componentColors={componentColors}
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                  {legendMode === "expanded" && (
                    <div className="flex-1 min-w-0 max-h-[216px] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none]">
                      <ComparisonLegend
                        componentTokens={conv.componentTokens}
                        totalTokens={conv.totalTokens}
                        componentColors={componentColors}
                        sortField={sortField}
                        sortDirection={sortDirection}
                      />
                    </div>
                  )}
                </>
              ) : conv.messageComponents ? (
                <MessageWorkflowChart
                  messageComponents={conv.messageComponents}
                  componentColors={componentColors}
                  squaresPerRow={squaresPerRow}
                />
              ) : (
                <div className="text-xs text-muted-foreground">
                  No workflow data available
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

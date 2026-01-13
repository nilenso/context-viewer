import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { getComponentBgClass } from "@/lib/component-colors";
import { ArrowUp, ArrowDown } from "lucide-react";

type SortField = "tokens" | "name" | "category";
type SortDirection = "asc" | "desc";

export interface ConversationComponentData {
  id: string;
  filename: string;
  componentTokens: Record<string, number>;
  totalTokens: number;
  turnCount: number; // Number of user messages (turns)
  messageCount: number; // Total messages
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
        {squares.map(({ component, index }) => (
          <div
            key={index}
            className={cn(
              "w-3 h-3 rounded-sm",
              component
                ? getComponentBgClass(component, componentColors)
                : "bg-gray-200"
            )}
            title={component || undefined}
          />
        ))}
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
      {componentData.map(({ component, tokens, percentage }) => (
        <div key={component} className="flex items-center gap-1.5">
          <span
            className={cn(
              "w-2.5 h-2.5 rounded-sm flex-shrink-0",
              getComponentBgClass(component, componentColors)
            )}
          />
          <span className="flex-1 truncate text-muted-foreground">
            {component}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {percentage.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Grid of waffle charts comparing component distribution across conversations
 */
export function ComponentComparisonView({
  sourceConversations,
  componentColors,
}: ComponentComparisonViewProps) {
  const [sortField, setSortField] = useState<SortField>("tokens");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [columnCount, setColumnCount] = useState<number>(3);

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
      {/* Controls: Sort and Grid columns */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
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
      </div>

      {/* Grid of waffle charts */}
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {sourceConversations.map((conv) => (
          <div key={conv.id} className="border rounded-lg p-4 bg-white">
            {/* Filename header */}
            <div className="mb-3">
              <h4 className="text-sm font-medium truncate" title={conv.filename}>
                {conv.filename}
              </h4>
              <p className="text-xs text-muted-foreground">
                {conv.totalTokens.toLocaleString()} tokens · {conv.turnCount} turns · {conv.messageCount} messages
              </p>
            </div>

            {/* Waffle chart and legend side by side */}
            <div className="flex gap-4">
              <MiniWaffleChart
                componentTokens={conv.componentTokens}
                totalTokens={conv.totalTokens}
                componentColors={componentColors}
                sortField={sortField}
                sortDirection={sortDirection}
              />
              <div className="flex-1 min-w-0 max-h-[216px] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none]">
                <ComparisonLegend
                  componentTokens={conv.componentTokens}
                  totalTokens={conv.totalTokens}
                  componentColors={componentColors}
                  sortField={sortField}
                  sortDirection={sortDirection}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

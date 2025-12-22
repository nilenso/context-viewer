import { useState } from "react";
import { cn } from "@/lib/utils";

type SortMode = "tokens" | "name";

interface WaffleChartProps {
  componentTokens: Record<string, number>;
  totalTokens: number;
  getColorClass: (component: string) => string;
  getLabel: (component: string) => string;
  onComponentClick?: (component: string) => void;
}

/**
 * Waffle chart visualization showing token distribution as a 20x20 grid
 * Each square represents 0.25% of total tokens
 */
export function WaffleChart({
  componentTokens,
  totalTokens,
  getColorClass,
  getLabel,
  onComponentClick,
}: WaffleChartProps) {
  const [sortMode, setSortMode] = useState<SortMode>("tokens");
  const GRID_SIZE = 400; // 20x20 grid

  // Calculate percentages and sort based on mode
  const componentData = Object.entries(componentTokens)
    .map(([component, tokens]) => ({
      component,
      tokens,
      percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
    }))
    .sort((a, b) => {
      if (sortMode === "name") {
        return a.component.localeCompare(b.component);
      }
      return b.percentage - a.percentage;
    });

  // Build the 400-square grid (20x20)
  // Each square is assigned to a component based on percentage
  const squares: { component: string; index: number }[] = [];
  let squareIndex = 0;

  for (const { component, percentage } of componentData) {
    // Calculate squares: percentage * 4 (since 400 squares = 100%)
    // Ensure at least 1 square if component has tokens
    const squareCount = Math.max(
      percentage > 0 ? 1 : 0,
      Math.round(percentage * 4)
    );

    for (let i = 0; i < squareCount && squareIndex < GRID_SIZE; i++) {
      squares.push({ component, index: squareIndex });
      squareIndex++;
    }
  }

  // Fill remaining squares with empty (shouldn't happen if percentages add to 100)
  while (squares.length < GRID_SIZE) {
    squares.push({ component: "", index: squares.length });
  }

  // Trim to exactly 400
  squares.length = GRID_SIZE;

  return (
    <div className="flex gap-8 items-start">
      {/* Legend (left side) */}
      <div className="flex flex-col gap-1.5 min-w-[240px]">
        {/* Sort toggle */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1 px-2">
          <span>Sort:</span>
          <button
            onClick={() => setSortMode("tokens")}
            className={cn(
              "px-1.5 py-0.5 rounded transition-colors",
              sortMode === "tokens"
                ? "bg-gray-200 text-gray-900"
                : "hover:bg-gray-100"
            )}
          >
            tokens
          </button>
          <button
            onClick={() => setSortMode("name")}
            className={cn(
              "px-1.5 py-0.5 rounded transition-colors",
              sortMode === "name"
                ? "bg-gray-200 text-gray-900"
                : "hover:bg-gray-100"
            )}
          >
            name
          </button>
        </div>
        {componentData.map(({ component, tokens, percentage }) => (
          <button
            key={component}
            onClick={() => onComponentClick?.(component)}
            className={cn(
              "flex items-center gap-2 text-left text-sm py-1 px-2 rounded hover:bg-gray-100 transition-colors",
              onComponentClick && "cursor-pointer"
            )}
          >
            <span
              className={cn(
                "w-4 h-4 rounded-sm flex-shrink-0",
                getColorClass(component)
              )}
            />
            <span className="flex-1 truncate">{getLabel(component)}</span>
            <span className="text-muted-foreground tabular-nums text-xs w-16 text-right">
              {tokens.toLocaleString()}
            </span>
            <span className="text-muted-foreground tabular-nums w-10 text-right">
              {percentage.toFixed(0)}%
            </span>
          </button>
        ))}
      </div>

      {/* Waffle grid (right side) - fixed 20x20 square */}
      <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-0.5 flex-shrink-0">
        {squares.map(({ component, index }) => (
          <button
            key={index}
            onClick={() => component && onComponentClick?.(component)}
            className={cn(
              "w-3 h-3 rounded-sm transition-all",
              component ? getColorClass(component) : "bg-gray-200",
              component && onComponentClick && "cursor-pointer hover:scale-110"
            )}
            title={component ? `${getLabel(component)}` : undefined}
          />
        ))}
      </div>
    </div>
  );
}

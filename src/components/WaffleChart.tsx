import { cn } from "@/lib/utils";

interface WaffleChartProps {
  componentTokens: Record<string, number>;
  totalTokens: number;
  getColorClass: (component: string) => string;
  getLabel: (component: string) => string;
  onComponentClick?: (component: string) => void;
}

/**
 * Waffle chart visualization showing token distribution as a 10x10 grid
 * Each square represents 1% of total tokens
 */
export function WaffleChart({
  componentTokens,
  totalTokens,
  getColorClass,
  getLabel,
  onComponentClick,
}: WaffleChartProps) {
  // Calculate percentages and sort by size (largest first)
  const componentData = Object.entries(componentTokens)
    .map(([component, tokens]) => ({
      component,
      tokens,
      percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  // Build the 100-square grid
  // Each square is assigned to a component based on percentage
  const squares: { component: string; index: number }[] = [];
  let squareIndex = 0;

  for (const { component, percentage } of componentData) {
    // Round to nearest integer, but ensure at least 1 square if component has tokens
    const squareCount = Math.max(
      percentage > 0 ? 1 : 0,
      Math.round(percentage)
    );

    for (let i = 0; i < squareCount && squareIndex < 100; i++) {
      squares.push({ component, index: squareIndex });
      squareIndex++;
    }
  }

  // Fill remaining squares with empty (shouldn't happen if percentages add to 100)
  while (squares.length < 100) {
    squares.push({ component: "", index: squares.length });
  }

  // Trim to exactly 100
  squares.length = 100;

  return (
    <div className="flex gap-8 items-start">
      {/* Legend (left side) */}
      <div className="flex flex-col gap-1.5 min-w-[240px]">
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

      {/* Waffle grid (right side) - fixed 10x10 square */}
      <div className="grid grid-cols-10 gap-1 flex-shrink-0">
        {squares.map(({ component, index }) => (
          <button
            key={index}
            onClick={() => component && onComponentClick?.(component)}
            className={cn(
              "w-5 h-5 rounded-sm transition-all",
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

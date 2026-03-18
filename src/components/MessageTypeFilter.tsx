import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter } from "lucide-react";

// Combined role+type filters based on valid schema combinations
export type MessageFilter =
  | "all"
  | "system:text"
  | "user:text"
  | "user:image"
  | "user:file"
  | "assistant:text"
  | "assistant:file"
  | "assistant:reasoning"
  | "assistant:tool-call"
  | "tool:tool-result";

export const ALL_MESSAGE_FILTERS: MessageFilter[] = [
  "system:text",
  "user:text",
  "user:image",
  "user:file",
  "assistant:text",
  "assistant:file",
  "assistant:reasoning",
  "assistant:tool-call",
  "tool:tool-result",
];

export const DEFAULT_MESSAGE_FILTERS = new Set<MessageFilter>([
  "all",
  ...ALL_MESSAGE_FILTERS,
]);

// Valid message filter options grouped by role
export const filterOptions = [
  {
    role: "All",
    emoji: "🔍",
    filters: [
      { key: "all" as MessageFilter, label: "All Messages", emoji: "🔍" },
    ]
  },
  {
    role: "System",
    emoji: "⚙️",
    filters: [
      { key: "system:text" as MessageFilter, label: "Text", emoji: "💬" },
    ]
  },
  {
    role: "User",
    emoji: "👤",
    filters: [
      { key: "user:text" as MessageFilter, label: "Text", emoji: "💬" },
      { key: "user:image" as MessageFilter, label: "Image", emoji: "🖼️" },
      { key: "user:file" as MessageFilter, label: "File", emoji: "📄" },
    ]
  },
  {
    role: "Assistant",
    emoji: "🤖",
    filters: [
      { key: "assistant:text" as MessageFilter, label: "Text", emoji: "💬" },
      { key: "assistant:file" as MessageFilter, label: "File", emoji: "📄" },
      { key: "assistant:reasoning" as MessageFilter, label: "Reasoning", emoji: "💭" },
      { key: "assistant:tool-call" as MessageFilter, label: "Tool Call", emoji: "📤" },
    ]
  },
  {
    role: "Tool",
    emoji: "🔧",
    filters: [
      { key: "tool:tool-result" as MessageFilter, label: "Tool Result", emoji: "📥" },
    ]
  },
];

interface MessageTypeFilterProps {
  filters: Set<MessageFilter>;
  onFiltersChange: (filters: Set<MessageFilter>) => void;
  className?: string;
}

export function MessageTypeFilter({
  filters,
  onFiltersChange,
  className,
}: MessageTypeFilterProps) {
  // Helper to toggle a message filter
  const toggleFilter = (filter: MessageFilter) => {
    const newSet = new Set(filters);
    if (filter === "all") {
      // Toggle all on/off
      if (newSet.has("all")) {
        onFiltersChange(new Set());
      } else {
        onFiltersChange(new Set(["all", ...ALL_MESSAGE_FILTERS]));
      }
    } else {
      // Toggle individual filter
      if (newSet.has(filter)) {
        newSet.delete(filter);
        newSet.delete("all");
      } else {
        newSet.add(filter);
        // Check if all are now selected
        if (ALL_MESSAGE_FILTERS.every(f => newSet.has(f))) {
          newSet.add("all");
        }
      }
      onFiltersChange(newSet);
    }
  };

  // Get display text for filter button
  const getDisplayText = () => {
    if (filters.has("all")) return "All Types";
    if (filters.size === 0) return "No Types";
    return `${filters.size} Type${filters.size !== 1 ? 's' : ''}`;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={className}>
          <Filter className="h-4 w-4 mr-2" />
          {getDisplayText()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            Message Type
          </div>
          {filterOptions.map(({ role, emoji, filters: roleFilters }) => (
            <div key={role} className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2 mb-1">
                <span>{emoji}</span>
                <span>{role}</span>
              </div>
              {roleFilters.map(({ key, label, emoji: filterEmoji }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors ml-2"
                >
                  <Checkbox
                    checked={filters.has(key)}
                    onCheckedChange={() => toggleFilter(key)}
                  />
                  <span className="text-sm flex-1">
                    {filterEmoji} {label}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Helper to check if a part passes the message type filter
 */
export function partPassesTypeFilter(
  partType: string,
  msgRole: string,
  filters: Set<MessageFilter>
): boolean {
  if (filters.has("all")) return true;
  const filterKey = `${msgRole}:${partType}` as MessageFilter;
  return filters.has(filterKey);
}

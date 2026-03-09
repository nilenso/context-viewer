import { useState, useMemo, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Maximize2, Minimize2, AlertTriangle, X, Search, ArrowUpDown, Filter, ArrowUpNarrowWide, ArrowDownNarrowWide, Copy, Check, Loader2 } from "lucide-react";
import { MessageView } from "./MessageView";
import { ComponentsView } from "./ComponentsView";
import { StaticComponentsView } from "./StaticComponentsView";
import { StackedBarChartView } from "./StackedBarChartView";
import { MessagePartView } from "./MessagePartView";
import {
  ComponentComparisonView,
  type ConversationComponentData,
  type ViewMode as ComparisonViewMode,
  type LegendMode as ComparisonLegendMode,
  type SortField as ComparisonSortField,
  type SortDirection as ComparisonSortDirection,
} from "./ComponentComparisonView";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getStaticComponentLabel } from "@/lib/static-component-colors";
import type { Conversation, Message, SourceInfo } from "@/schema";
import type { ComponentTimelineSnapshot, DimensionData } from "@/componentisation";
import {
  type MessageFilter,
  type SortOption as UrlSortOption,
  type ConversationTab,
  type GroupTab,
  ALL_MESSAGE_FILTERS,
} from "@/lib/url-state";

// Re-export types for URL state integration
export type TabType = ConversationTab | GroupTab;
export type SortOption = UrlSortOption;
export type { MessageFilter };
export { ALL_MESSAGE_FILTERS };

// Internal message filters that include "all" pseudo-filter for display purposes
type MessageFilterWithAll = MessageFilter | "all";

// Minimal workflow state info needed for computing source conversation components
interface SourceWorkflowState {
  id: string;
  filename: string;
  title?: string;
  conversation?: Conversation;
  componentMapping?: Record<string, string>;
  dimensions?: Record<string, DimensionData>;
}

interface ConversationViewProps {
  conversation: Conversation;
  componentMapping?: Record<string, string>;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  components?: string[];
  // Multi-dimensional component data
  dimensions?: Record<string, DimensionData>;
  activeDimensions?: Set<string>;
  onActiveDimensionsChange?: (dims: Set<string>) => void;
  // Dimension management
  onAddDimension?: (name: string) => void;
  onRemoveDimension?: (name: string) => void;
  onRenameDimension?: (oldName: string, newName: string) => void;
  onEditDimensionPrompt?: (dimensionName: string) => void;
  // Static componentisation (deterministic, no AI)
  staticMapping?: Record<string, string>;
  staticTimeline?: ComponentTimelineSnapshot[];
  warnings?: string[];
  onReprocessComponents?: (options?: { customPrompt?: string; customComponents?: string[] }) => Promise<void>;
  isReprocessing?: boolean;
  // Grouped conversation data
  messageSourceMap?: Record<string, SourceInfo>;
  isGrouped?: boolean;
  groupTitle?: string;
  onConversationClick?: (id: string) => void;
  sourceConversationComponents?: ConversationComponentData[];
  // Source workflow states for grouped conversations (for filtered comparison)
  sourceWorkflowStates?: SourceWorkflowState[];

  // URL-controlled state (optional - falls back to local state if not provided)
  activeTab?: TabType;
  onTabChange?: (tab: TabType) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  sortBy?: SortOption;
  onSortByChange?: (sort: SortOption) => void;
  messageFilters?: Set<MessageFilter>;
  onMessageFiltersChange?: (filters: Set<MessageFilter>) => void;
  selectedComponents?: Set<string>;
  onSelectedComponentsChange?: (components: Set<string>) => void;

  // Comparison tab controlled state
  comparisonViewMode?: ComparisonViewMode;
  onComparisonViewModeChange?: (mode: ComparisonViewMode) => void;
  comparisonLegendMode?: ComparisonLegendMode;
  onComparisonLegendModeChange?: (mode: ComparisonLegendMode) => void;
  comparisonSortField?: ComparisonSortField;
  onComparisonSortFieldChange?: (field: ComparisonSortField) => void;
  comparisonSortDirection?: ComparisonSortDirection;
  onComparisonSortDirectionChange?: (dir: ComparisonSortDirection) => void;
  comparisonColumnCount?: number;
  onComparisonColumnCountChange?: (cols: number) => void;
  comparisonSquaresPerRow?: number;
  onComparisonSquaresPerRowChange?: (spr: number) => void;
}

export function ConversationView({
  conversation,
  componentMapping,
  componentTimeline,
  componentColors,
  components,
  dimensions,
  activeDimensions,
  onActiveDimensionsChange,
  onAddDimension,
  onRemoveDimension,
  onRenameDimension,
  onEditDimensionPrompt,
  staticMapping,
  staticTimeline,
  warnings,
  onReprocessComponents,
  isReprocessing,
  messageSourceMap,
  isGrouped,
  groupTitle,
  onConversationClick,
  sourceConversationComponents,
  sourceWorkflowStates,
  // URL-controlled state
  activeTab: controlledActiveTab,
  onTabChange,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
  sortBy: controlledSortBy,
  onSortByChange,
  messageFilters: controlledMessageFilters,
  onMessageFiltersChange,
  selectedComponents: controlledSelectedComponents,
  onSelectedComponentsChange,
  // Comparison tab controlled state
  comparisonViewMode,
  onComparisonViewModeChange,
  comparisonLegendMode,
  onComparisonLegendModeChange,
  comparisonSortField,
  onComparisonSortFieldChange,
  comparisonSortDirection,
  onComparisonSortDirectionChange,
  comparisonColumnCount,
  onComparisonColumnCountChange,
  comparisonSquaresPerRow,
  onComparisonSquaresPerRowChange,
}: ConversationViewProps) {
  // Local state (used when props are not provided)
  const [localActiveTab, setLocalActiveTab] = useState<TabType>("conversation");
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [localSortBy, setLocalSortBy] = useState<SortOption>("time-asc");
  const [localMessageFilters, setLocalMessageFilters] = useState<Set<MessageFilter>>(
    new Set(ALL_MESSAGE_FILTERS)
  );
  const [localSelectedComponents, setLocalSelectedComponents] = useState<Set<string>>(new Set());

  // Local-only state (not URL-controlled)
  const [expandAll, setExpandAll] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState(false);
  const [selectedStaticComponent, setSelectedStaticComponent] = useState<string | null>(null);
  const [selectedAutoComponent, setSelectedAutoComponent] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "processing" | "copied">("idle");

  // Use controlled values if provided, otherwise use local state
  const activeTab = controlledActiveTab ?? localActiveTab;
  const searchQuery = controlledSearchQuery ?? localSearchQuery;
  const sortBy = controlledSortBy ?? localSortBy;
  const selectedComponents = controlledSelectedComponents ?? localSelectedComponents;

  // For message filters, we use the controlled version directly
  // The "all" pseudo-filter is computed for display purposes
  const messageFiltersSet = controlledMessageFilters ?? localMessageFilters;

  // Setters that call both local state and callback
  const handleTabChange = (tab: TabType) => {
    setLocalActiveTab(tab);
    onTabChange?.(tab);
  };
  const setSearchQuery = (query: string) => {
    setLocalSearchQuery(query);
    onSearchQueryChange?.(query);
  };
  const setSortBy = (sort: SortOption) => {
    setLocalSortBy(sort);
    onSortByChange?.(sort);
  };
  const setSelectedComponents = (comps: Set<string>) => {
    setLocalSelectedComponents(comps);
    onSelectedComponentsChange?.(comps);
  };
  const setMessageFiltersInternal = (filters: Set<MessageFilter>) => {
    setLocalMessageFilters(filters);
    onMessageFiltersChange?.(filters);
  };

  // Initialize selected components when components prop changes
  useEffect(() => {
    if (components && components.length > 0 && !controlledSelectedComponents) {
      setLocalSelectedComponents(new Set(components));
    }
  }, [components, controlledSelectedComponents]);

  // Helper to toggle a component filter
  const toggleComponent = (component: string) => {
    const newSet = new Set(selectedComponents);
    if (newSet.has(component)) {
      newSet.delete(component);
    } else {
      newSet.add(component);
    }
    setSelectedComponents(newSet);
  };

  // Toggle all components
  const toggleAllComponents = () => {
    if (components) {
      if (selectedComponents.size === components.length) {
        setSelectedComponents(new Set());
      } else {
        setSelectedComponents(new Set(components));
      }
    }
  };

  // Get display text for component filter button
  const getComponentFilterDisplayText = () => {
    if (!components || components.length === 0) return "No Components";
    if (selectedComponents.size === components.length) return "All Components";
    if (selectedComponents.size === 0) return "No Components";
    return `${selectedComponents.size} Component${selectedComponents.size !== 1 ? 's' : ''}`;
  };

  // Get combined filter display text
  const getCombinedFilterDisplayText = () => {
    const messageFilterText = getFilterDisplayText();
    const hasComponentFilter = components && components.length > 0;

    if (!hasComponentFilter) {
      return messageFilterText;
    }

    const componentFilterText = getComponentFilterDisplayText();
    const isAllMessages = hasAllFilters;
    const isAllComponents = selectedComponents.size === components.length;

    if (isAllMessages && isAllComponents) {
      return "All Filters";
    }

    // Count active filters
    let activeCount = 0;
    if (!isAllMessages) activeCount += messageFiltersSet.size;
    if (!isAllComponents) activeCount += selectedComponents.size;

    if (activeCount === 0) return "No Filters";
    return `${activeCount} Filter${activeCount !== 1 ? 's' : ''}`;
  };

  // Handle clicking on a component badge - filters to show only that component
  const handleComponentClick = (component: string) => {
    setSelectedComponents(new Set([component]));
  };

  // Get sort icon based on current sort
  const getSortIcon = () => {
    switch (sortBy) {
      case "time-asc":
      case "tokens-asc":
        return <ArrowUpNarrowWide className="h-4 w-4" />;
      case "time-desc":
      case "tokens-desc":
        return <ArrowDownNarrowWide className="h-4 w-4" />;
    }
  };

  // Get sort tooltip text
  const getSortTooltip = () => {
    switch (sortBy) {
      case "time-asc":
        return "Time (Oldest First)";
      case "time-desc":
        return "Time (Newest First)";
      case "tokens-asc":
        return "Tokens (Low to High)";
      case "tokens-desc":
        return "Tokens (High to Low)";
    }
  };

  // Compute whether all filters are selected (for UI display)
  const hasAllFilters = useMemo(() => {
    return messageFiltersSet.size === ALL_MESSAGE_FILTERS.length &&
      ALL_MESSAGE_FILTERS.every(f => messageFiltersSet.has(f));
  }, [messageFiltersSet]);

  // For the internal filter checks, we just use messageFiltersSet directly
  // The "all" check is handled by hasAllFilters

  // Helper to toggle a message filter
  const toggleMessageFilter = (filter: MessageFilterWithAll) => {
    if (filter === "all") {
      // Toggle all on/off
      if (hasAllFilters) {
        setMessageFiltersInternal(new Set());
      } else {
        setMessageFiltersInternal(new Set(ALL_MESSAGE_FILTERS));
      }
    } else {
      // Toggle individual filter
      const newSet = new Set(messageFiltersSet);
      if (newSet.has(filter)) {
        newSet.delete(filter);
      } else {
        newSet.add(filter);
      }
      setMessageFiltersInternal(newSet);
    }
  };

  // Get display text for filter button
  const getFilterDisplayText = () => {
    if (hasAllFilters) return "All Messages";
    if (messageFiltersSet.size === 0) return "No Messages";
    return `${messageFiltersSet.size} Filter${messageFiltersSet.size !== 1 ? 's' : ''}`;
  };

  // Valid message filter options grouped by role
  const filterOptions: Array<{
    role: string;
    emoji: string;
    filters: Array<{ key: MessageFilterWithAll; label: string; emoji: string }>;
  }> = [
    {
      role: "All",
      emoji: "🔍",
      filters: [
        { key: "all", label: "All Messages", emoji: "🔍" },
      ]
    },
    {
      role: "System",
      emoji: "⚙️",
      filters: [
        { key: "system:text", label: "Text", emoji: "💬" },
      ]
    },
    {
      role: "User",
      emoji: "👤",
      filters: [
        { key: "user:text", label: "Text", emoji: "💬" },
        { key: "user:image", label: "Image", emoji: "🖼️" },
        { key: "user:file", label: "File", emoji: "📄" },
      ]
    },
    {
      role: "Assistant",
      emoji: "🤖",
      filters: [
        { key: "assistant:text", label: "Text", emoji: "💬" },
        { key: "assistant:file", label: "File", emoji: "📄" },
        { key: "assistant:reasoning", label: "Reasoning", emoji: "💭" },
        { key: "assistant:tool-call", label: "Tool Call", emoji: "📤" },
      ]
    },
    {
      role: "Tool",
      emoji: "🔧",
      filters: [
        { key: "tool:tool-result", label: "Tool Result", emoji: "📥" },
      ]
    },
  ];

  // Helper function to get total tokens for a message
  const getMessageTokens = (message: Message) => {
    return message.parts.reduce((sum, part) => {
      if ("token_count" in part && part.token_count !== undefined) {
        return sum + part.token_count;
      }
      return sum;
    }, 0);
  };

  // Calculate conversation start time (first message with a timestamp)
  const conversationStartTime = useMemo(() => {
    for (const message of conversation.messages) {
      if (message.timestamp) {
        const ts = new Date(message.timestamp);
        if (!isNaN(ts.getTime())) {
          return ts;
        }
      }
    }
    return undefined;
  }, [conversation.messages]);

  // Helper to check if a part passes the message type filter
  const partPassesMessageTypeFilter = (part: { type: string }, msgRole: string): boolean => {
    if (hasAllFilters) return true;
    const filterKey = `${msgRole}:${part.type}` as MessageFilter;
    return messageFiltersSet.has(filterKey);
  };

  // Compute filtered source conversation components for grouped conversation comparison
  const filteredSourceConversationComponents = useMemo((): ConversationComponentData[] | undefined => {
    // Check if any filters are active
    const hasMessageTypeFilters = !hasAllFilters;
    const hasComponentFilters = components && selectedComponents.size > 0 && selectedComponents.size < components.length;

    // Use pre-computed data if no filters are active or no source states provided
    if (!hasMessageTypeFilters && !hasComponentFilters) {
      return sourceConversationComponents;
    }
    if (!sourceWorkflowStates || sourceWorkflowStates.length === 0) {
      return sourceConversationComponents;
    }

    // Compute filtered data for each source conversation
    return sourceWorkflowStates
      .map((source) => {
        if (!source.conversation || !source.componentMapping) {
          return null;
        }

        const componentTokens: Record<string, number> = {};
        let totalTokens = 0;
        let turnCount = 0;
        let firstTimestamp: Date | undefined;
        let lastTimestamp: Date | undefined;

        for (const message of source.conversation.messages) {
          // Count user messages as turns (only if they pass filter)
          const hasUserPartsPassingFilter = message.role === "user" &&
            message.parts.some(part => {
              if (!partPassesMessageTypeFilter(part, message.role)) return false;
              // Also check component filter for turn counting - AND logic across dimensions
              if (hasComponentFilters) {
                const pcs: string[] = [];
                const pc = source.componentMapping![part.id];
                if (pc) pcs.push(pc);
                if (source.dimensions) {
                  for (const dim of Object.values(source.dimensions)) {
                    const dc = dim.componentMapping[part.id];
                    if (dc && !pcs.includes(dc)) pcs.push(dc);
                  }
                }
                if (pcs.length === 0 || pcs.some(c => !selectedComponents.has(c))) return false;
              }
              return true;
            });
          if (hasUserPartsPassingFilter) {
            turnCount++;
          }

          // Track timestamps for duration calculation
          if (message.timestamp) {
            const ts = new Date(message.timestamp);
            if (!isNaN(ts.getTime())) {
              if (!firstTimestamp || ts < firstTimestamp) {
                firstTimestamp = ts;
              }
              if (!lastTimestamp || ts > lastTimestamp) {
                lastTimestamp = ts;
              }
            }
          }

          for (const part of message.parts) {
            // Apply message type filter
            if (!partPassesMessageTypeFilter(part, message.role)) continue;

            const component = source.componentMapping[part.id];

            // Apply component filter - AND logic across dimensions
            if (hasComponentFilters) {
              const pcs: string[] = [];
              if (component) pcs.push(component);
              if (source.dimensions) {
                for (const dim of Object.values(source.dimensions)) {
                  const dc = dim.componentMapping[part.id];
                  if (dc && !pcs.includes(dc)) pcs.push(dc);
                }
              }
              if (pcs.length === 0 || pcs.some(c => !selectedComponents.has(c))) continue;
            }

            const tokenCount = ("token_count" in part && part.token_count) || 0;
            totalTokens += tokenCount;

            if (component) {
              componentTokens[component] = (componentTokens[component] || 0) + tokenCount;
            } else {
              componentTokens["other"] = (componentTokens["other"] || 0) + tokenCount;
            }
          }
        }

        // Calculate duration if we have both timestamps
        const durationMs = firstTimestamp && lastTimestamp
          ? lastTimestamp.getTime() - firstTimestamp.getTime()
          : undefined;

        // Build messageComponents array for workflow view (filtered)
        const messageComponents: string[] = [];
        for (const message of source.conversation.messages) {
          // Check if any part of this message passes the filters
          let messageComponent: string | null = null;
          for (const part of message.parts) {
            // Apply message type filter
            if (!partPassesMessageTypeFilter(part, message.role)) continue;

            const component = source.componentMapping[part.id];

            // Apply component filter - AND logic across dimensions
            if (hasComponentFilters) {
              const pcs: string[] = [];
              if (component) pcs.push(component);
              if (source.dimensions) {
                for (const dim of Object.values(source.dimensions)) {
                  const dc = dim.componentMapping[part.id];
                  if (dc && !pcs.includes(dc)) pcs.push(dc);
                }
              }
              if (pcs.length === 0 || pcs.some(c => !selectedComponents.has(c))) continue;
            }

            // Found a part that passes filters
            if (component) {
              messageComponent = component;
              break;
            }
          }
          // Only include message if it has parts that pass filters
          if (messageComponent !== null) {
            messageComponents.push(messageComponent);
          }
        }

        const result: ConversationComponentData = {
          id: source.id,
          filename: source.filename,
          componentTokens,
          totalTokens,
          turnCount,
          messageCount: source.conversation.messages.length,
          durationMs,
          messageComponents,
        };
        if (source.title) {
          result.title = source.title;
        }
        return result;
      })
      .filter((item): item is ConversationComponentData => item !== null);
  }, [sourceWorkflowStates, sourceConversationComponents, messageFiltersSet, hasAllFilters, components, selectedComponents]);

  // Filter messages at the part level
  const filteredAndSortedMessages = useMemo(() => {
    // Helper to check if a part passes all filters
    const partPassesFilters = (part: Message["parts"][number], msgRole: Message["role"]) => {
      // Filter by role+type combinations
      if (!hasAllFilters) {
        const filterKey = `${msgRole}:${part.type}` as MessageFilter;
        if (!messageFiltersSet.has(filterKey)) {
          return false;
        }
      }

      // Filter by components - hide part if ANY of its components (across dimensions) is unselected
      if (componentMapping && components && selectedComponents.size > 0 && selectedComponents.size < components.length) {
        // Collect all components this part belongs to across all dimensions
        const partComponents: string[] = [];
        const legacyComp = componentMapping[part.id];
        if (legacyComp) partComponents.push(legacyComp);
        if (dimensions) {
          for (const dim of Object.values(dimensions)) {
            const dc = dim.componentMapping[part.id];
            if (dc && !partComponents.includes(dc)) partComponents.push(dc);
          }
        }
        // Part must have at least one component, and ALL must be selected
        if (partComponents.length === 0 || partComponents.some(c => !selectedComponents.has(c))) {
          return false;
        }
      }

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        if ("text" in part && typeof part.text === "string") {
          if (!part.text.toLowerCase().includes(query)) {
            return false;
          }
        } else if (part.type === "tool-call" || part.type === "tool-result") {
          const toolName = "toolName" in part ? part.toolName : "";
          if (!toolName.toLowerCase().includes(query)) {
            return false;
          }
        } else {
          return false;
        }
      }

      return true;
    };

    // Filter parts within each message and create filtered message objects
    const messagesWithFilteredParts = conversation.messages.map((msg, idx) => {
      const filteredParts = msg.parts.filter(part => partPassesFilters(part, msg.role));
      return {
        message: { ...msg, parts: filteredParts },
        originalIndex: idx,
        tokens: filteredParts.reduce((sum, part) => {
          if ("token_count" in part && part.token_count !== undefined) {
            return sum + part.token_count;
          }
          return sum;
        }, 0),
        hasVisibleParts: filteredParts.length > 0,
      };
    });

    // Only include messages that have at least one visible part
    const filtered = messagesWithFilteredParts.filter(m => m.hasVisibleParts);

    // Sort messages
    let sorted = [...filtered];
    switch (sortBy) {
      case "time-asc":
        sorted.sort((a, b) => a.originalIndex - b.originalIndex);
        break;
      case "time-desc":
        sorted.sort((a, b) => b.originalIndex - a.originalIndex);
        break;
      case "tokens-asc":
        sorted.sort((a, b) => a.tokens - b.tokens);
        break;
      case "tokens-desc":
        sorted.sort((a, b) => b.tokens - a.tokens);
        break;
    }

    return sorted;
  }, [conversation.messages, messageFiltersSet, hasAllFilters, searchQuery, sortBy, componentMapping, components, selectedComponents]);

  // Generate markdown and copy to clipboard
  const copyToMarkdown = useCallback(async () => {
    setCopyStatus("processing");

    try {
      // Build filter description
      const activeFilters: string[] = [];
      if (searchQuery.trim()) {
        activeFilters.push(`Search: "${searchQuery}"`);
      }
      if (!hasAllFilters) {
        const filterNames = Array.from(messageFiltersSet).map(f => f.replace(":", " → "));
        activeFilters.push(`Message types: ${filterNames.join(", ")}`);
      }
      if (components && selectedComponents.size > 0 && selectedComponents.size < components.length) {
        activeFilters.push(`Components: ${Array.from(selectedComponents).join(", ")}`);
      }

      // Build sort description
      const sortDescriptions: Record<string, string> = {
        "time-asc": "Time (Oldest First)",
        "time-desc": "Time (Newest First)",
        "tokens-asc": "Tokens (Low to High)",
        "tokens-desc": "Tokens (High to Low)",
      };

      // Get unique filenames from messages
      const filenames = new Set<string>();
      if (isGrouped && messageSourceMap) {
        filteredAndSortedMessages.forEach(({ message }) => {
          const sourceInfo = messageSourceMap[message.id];
          if (sourceInfo?.filename) {
            filenames.add(sourceInfo.filename);
          }
        });
      } else {
        filenames.add(conversation.messages.length > 0 ? "conversation" : "empty");
      }

      // Calculate total tokens in filtered view
      const totalFilteredTokens = filteredAndSortedMessages.reduce((sum, { tokens }) => sum + tokens, 0);

      // Build markdown
      const lines: string[] = [];

      // Header
      lines.push("# Export from Context Viewer");
      lines.push("");
      lines.push(`**Files:** ${Array.from(filenames).join(", ")}`);
      lines.push(`**Total tokens (filtered):** ${totalFilteredTokens.toLocaleString()}`);
      lines.push(`**Sort:** ${sortDescriptions[sortBy]}`);
      if (activeFilters.length > 0) {
        lines.push(`**Filters:** ${activeFilters.join(" | ")}`);
      } else {
        lines.push("**Filters:** None (showing all)");
      }
      lines.push("");
      lines.push("---");
      lines.push("");

      // Group messages by source file if grouped conversation
      let currentFile = "";

      for (const { message, originalIndex, tokens } of filteredAndSortedMessages) {
        const sourceInfo = isGrouped && messageSourceMap ? messageSourceMap[message.id] : undefined;
        const filename = sourceInfo?.filename || "conversation";

        // Add file header if file changed
        if (isGrouped && filename !== currentFile) {
          currentFile = filename;
          // Calculate tokens for this file
          const fileTokens = filteredAndSortedMessages
            .filter(m => {
              const mSource = messageSourceMap?.[m.message.id];
              return (mSource?.filename || "conversation") === filename;
            })
            .reduce((sum, m) => sum + m.tokens, 0);
          lines.push(`# ${filename} (${fileTokens.toLocaleString()} tokens)`);
          lines.push("");
        }

        // Message header
        const msgHeader = isGrouped
          ? `## ${message.role} #${originalIndex + 1} (${tokens.toLocaleString()} tokens)`
          : `## ${message.role} #${originalIndex + 1} (${tokens.toLocaleString()} tokens)`;
        lines.push(msgHeader);
        lines.push("");

        // Parts
        for (const part of message.parts) {
          const partTokens = ("token_count" in part && part.token_count) || 0;
          const component = componentMapping?.[part.id];
          const componentStr = component ? ` [${component}]` : "";

          // Part header
          lines.push(`### ${part.type.toUpperCase()} (${partTokens} tokens)${componentStr}`);
          lines.push("");

          // Part content
          if ("text" in part && typeof part.text === "string") {
            lines.push("```");
            lines.push(part.text);
            lines.push("```");
          } else if (part.type === "tool-call") {
            const toolPart = part as { toolName: string; input: unknown };
            lines.push(`**Tool:** ${toolPart.toolName}`);
            lines.push("");
            lines.push("**Input:**");
            lines.push("```json");
            lines.push(JSON.stringify(toolPart.input, null, 2));
            lines.push("```");
          } else if (part.type === "tool-result") {
            const toolPart = part as { toolName: string; output: unknown; isError?: boolean };
            lines.push(`**Tool:** ${toolPart.toolName}${toolPart.isError ? " (Error)" : ""}`);
            lines.push("");
            lines.push("**Output:**");
            lines.push("```");
            lines.push(typeof toolPart.output === "string" ? toolPart.output : JSON.stringify(toolPart.output, null, 2));
            lines.push("```");
          } else if (part.type === "image") {
            lines.push("*[Image content]*");
          } else if (part.type === "file") {
            const filePart = part as { filename?: string; mediaType: string };
            lines.push(`*[File: ${filePart.filename || "unnamed"} (${filePart.mediaType})]*`);
          }
          lines.push("");
        }
      }

      const markdown = lines.join("\n");

      // Copy to clipboard
      await navigator.clipboard.writeText(markdown);

      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 2000);
    } catch (error) {
      console.error("Failed to copy markdown:", error);
      setCopyStatus("idle");
    }
  }, [
    filteredAndSortedMessages,
    messageFiltersSet,
    hasAllFilters,
    searchQuery,
    sortBy,
    components,
    selectedComponents,
    componentMapping,
    isGrouped,
    messageSourceMap,
    conversation.messages.length,
  ]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => handleTabChange(value as TabType)}
      className="flex flex-col h-full"
    >
      {/* Warnings Banner */}
      {warnings && warnings.length > 0 && !dismissedWarnings && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-900 mb-2">
                Some AI features failed
              </h3>
              <ul className="text-sm text-yellow-800 space-y-1">
                {warnings.map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
              <p className="text-xs text-yellow-700 mt-2">
                Check the browser console for detailed error information.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissedWarnings(true)}
              className="shrink-0 h-6 w-6 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <TabsList>
          <TabsTrigger value="conversation">Conversation</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="chart">Timeline Chart</TabsTrigger>
          {isGrouped && filteredSourceConversationComponents && filteredSourceConversationComponents.length > 0 && (
            <TabsTrigger value="comparison">Component Comparison</TabsTrigger>
          )}
        </TabsList>
      </div>

      <TabsContent value="conversation" className="flex-1 mt-0">
        {/* Toolbar */}
        <TooltipProvider>
          <div className="border rounded-lg p-3 mb-3 bg-white">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative w-[240px]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search messages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>

              {/* Combined Filters */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[140px] justify-start">
                    <Filter className="h-4 w-4 mr-2" />
                    {getCombinedFilterDisplayText()}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 max-h-[500px]" align="start">
                  <div className="flex max-h-[500px]">
                    {/* Message Type Filters Section */}
                    <div className="p-3 overflow-y-auto min-w-[280px]">
                      <div className="space-y-3">
                        <div className="text-xs font-medium text-muted-foreground">
                          Message Type
                        </div>
                        {filterOptions.map(({ role, emoji, filters }) => (
                          <div key={role} className="space-y-1">
                            <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2 mb-1">
                              <span>{emoji}</span>
                              <span>{role}</span>
                            </div>
                            {filters.map(({ key, label, emoji: filterEmoji }) => (
                              <label
                                key={key}
                                className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors ml-2"
                              >
                                <Checkbox
                                  checked={key === "all" ? hasAllFilters : messageFiltersSet.has(key)}
                                  onCheckedChange={() => toggleMessageFilter(key)}
                                />
                                <span className="text-sm flex-1">
                                  {filterEmoji} {label}
                                </span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Vertical Separator - only show if components exist */}
                    {components && components.length > 0 && (
                      <Separator orientation="vertical" className="h-auto" />
                    )}

                    {/* Component Filters Section - only show if components exist */}
                    {components && components.length > 0 && (
                      <div className="p-3 overflow-y-auto min-w-[240px] max-w-[300px]">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-medium text-muted-foreground">
                              Component
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={toggleAllComponents}
                              className="h-6 text-xs"
                            >
                              {selectedComponents.size === components.length ? "Clear All" : "Select All"}
                            </Button>
                          </div>
                          <div className="space-y-1">
                            {dimensions && Object.keys(dimensions).length > 1 ? (
                              // Group by dimension
                              Object.entries(dimensions).map(([dimName, dim]) => {
                                const dimComponents = [...new Set(Object.values(dim.componentMapping))].sort();
                                if (dimComponents.length === 0) return null;
                                return (
                                  <div key={dimName}>
                                    <div className="text-xs font-medium text-muted-foreground px-2 pt-2 pb-1">
                                      {dimName}
                                    </div>
                                    {dimComponents.map((component) => (
                                      <label
                                        key={`${dimName}:${component}`}
                                        className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors"
                                      >
                                        <Checkbox
                                          checked={selectedComponents.has(component)}
                                          onCheckedChange={() => toggleComponent(component)}
                                        />
                                        <span className="text-sm flex-1 break-words">
                                          {component}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                );
                              })
                            ) : (
                              // Flat list (single or no dimensions)
                              components.map((component) => (
                                <label
                                  key={component}
                                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors"
                                >
                                  <Checkbox
                                    checked={selectedComponents.has(component)}
                                    onCheckedChange={() => toggleComponent(component)}
                                  />
                                  <span className="text-sm flex-1 break-words">
                                    {component}
                                  </span>
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Sort - Icon Only */}
              <Popover>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon">
                        {getSortIcon()}
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Sort: {getSortTooltip()}</p>
                  </TooltipContent>
                </Tooltip>
                <PopoverContent className="w-[220px] p-3" align="start">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      Sort Messages
                    </div>
                    <label
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors"
                      onClick={() => setSortBy("time-asc")}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sortBy === "time-asc" ? "border-primary" : "border-muted-foreground"}`}>
                        {sortBy === "time-asc" && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm">Time (Oldest First)</span>
                    </label>
                    <label
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors"
                      onClick={() => setSortBy("time-desc")}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sortBy === "time-desc" ? "border-primary" : "border-muted-foreground"}`}>
                        {sortBy === "time-desc" && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm">Time (Newest First)</span>
                    </label>
                    <label
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors"
                      onClick={() => setSortBy("tokens-asc")}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sortBy === "tokens-asc" ? "border-primary" : "border-muted-foreground"}`}>
                        {sortBy === "tokens-asc" && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm">Tokens (Low to High)</span>
                    </label>
                    <label
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-sm transition-colors"
                      onClick={() => setSortBy("tokens-desc")}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sortBy === "tokens-desc" ? "border-primary" : "border-muted-foreground"}`}>
                        {sortBy === "tokens-desc" && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm">Tokens (High to Low)</span>
                    </label>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Expand/Collapse - Icon Only */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setExpandAll(!expandAll)}
                  >
                    {expandAll ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{expandAll ? "Collapse All" : "Expand All"}</p>
                </TooltipContent>
              </Tooltip>

              {/* Copy as Markdown */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyToMarkdown}
                    disabled={copyStatus === "processing"}
                  >
                    {copyStatus === "processing" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : copyStatus === "copied" ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {copyStatus === "processing"
                      ? "Copying..."
                      : copyStatus === "copied"
                      ? "Copied!"
                      : "Copy as Markdown"}
                  </p>
                </TooltipContent>
              </Tooltip>

              {/* Filter summary */}
              <div className="text-xs text-muted-foreground ml-auto whitespace-nowrap flex items-center gap-3">
                {conversationStartTime && (
                  <span title={conversationStartTime.toISOString()}>
                    Started: {conversationStartTime.toLocaleString()}
                  </span>
                )}
                <span>Showing {filteredAndSortedMessages.length} of {conversation.messages.length}</span>
              </div>
            </div>
          </div>
        </TooltipProvider>

        <ScrollArea className="h-full border rounded-lg p-4 bg-white">
          <div className="space-y-3">
            {filteredAndSortedMessages.map(({ message, originalIndex }) => (
              <MessageView
                key={originalIndex}
                message={message as Message}
                index={originalIndex}
                isExpanded={expandAll}
                componentMapping={componentMapping}
                componentColors={componentColors}
                onComponentClick={handleComponentClick}
                sourceInfo={isGrouped ? messageSourceMap?.[message.id] : undefined}
                messageSourceMap={isGrouped ? messageSourceMap : undefined}
                conversationStartTime={conversationStartTime}
                dimensions={dimensions}
                activeDimensions={activeDimensions}
              />
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="components" className="flex-1 mt-0 overflow-auto">
        <div className="space-y-6">
          {/* Static Components */}
          <div className="border rounded-lg bg-white">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Static Components</h3>
              <p className="text-xs text-muted-foreground">Categorized by role and part type</p>
            </div>
            <StaticComponentsView
              conversation={conversation}
              staticMapping={staticMapping}
              staticTimeline={staticTimeline}
              selectedComponent={selectedStaticComponent}
              onComponentSelect={(comp) => {
                setSelectedStaticComponent(comp);
                // Clear auto component selection when static filter changes
                setSelectedAutoComponent(null);
              }}
              messageTypeFilters={messageFiltersSet}
            />
          </div>

          {/* Automatic Components */}
          <div className="border rounded-lg bg-white">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Automatic Components</h3>
              <p className="text-xs text-muted-foreground">AI-identified semantic components</p>
            </div>
            <ComponentsView
              componentMapping={componentMapping}
              conversation={conversation}
              componentTimeline={componentTimeline}
              componentColors={componentColors}
              dimensions={dimensions}
              activeDimensions={activeDimensions}
              onActiveDimensionsChange={onActiveDimensionsChange}
              selectedComponent={selectedAutoComponent}
              onComponentSelect={(comp) => {
                setSelectedAutoComponent(comp);
              }}
              staticMapping={staticMapping}
              filterByStaticComponent={selectedStaticComponent}
              messageTypeFilters={messageFiltersSet}
            />
          </div>

          {/* Shared Message Parts Section */}
          {selectedAutoComponent ? (
            <div className="border rounded-lg bg-white">
              <div className="border-b px-4 py-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {selectedAutoComponent}
                  {selectedStaticComponent && (
                    <span className="font-normal text-muted-foreground">
                      {" "}· {getStaticComponentLabel(selectedStaticComponent)}
                    </span>
                  )}
                </h3>
                <button
                  onClick={() => setSelectedAutoComponent(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              <div className="p-4 space-y-4 max-h-[500px] overflow-auto">
                {conversation.messages.map((message, msgIndex) => {
                  // Filter parts that belong to the selected auto component
                  // AND optionally match the static component filter
                  const relevantParts = message.parts.filter((part) => {
                    const matchesAuto = componentMapping?.[part.id] === selectedAutoComponent;
                    const matchesStatic = !selectedStaticComponent || staticMapping?.[part.id] === selectedStaticComponent;
                    return matchesAuto && matchesStatic;
                  });

                  if (relevantParts.length === 0) return null;

                  const sourceInfo = isGrouped ? messageSourceMap?.[message.id] : undefined;
                  return (
                    <Card key={msgIndex} className="p-4">
                      <div className="mb-3 flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          Message {msgIndex + 1}
                        </Badge>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {message.role}
                        </Badge>
                        {sourceInfo && (
                          <Badge variant="outline" className="text-xs border-purple-400 text-purple-700 bg-purple-50">
                            {sourceInfo.title || sourceInfo.filename}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {relevantParts.length} {relevantParts.length === 1 ? 'part' : 'parts'}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {relevantParts.map((part) => (
                          <div key={part.id}>
                            <MessagePartView
                              part={part as any}
                              isExpanded={false}
                              sourceInfo={isGrouped ? messageSourceMap?.[part.id] : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                }).filter(Boolean)}
              </div>
            </div>
          ) : (
            <div className="border rounded-lg bg-white p-8 text-center text-muted-foreground">
              <p>
                {selectedStaticComponent
                  ? "Click a component in the Automatic chart above to view its message parts"
                  : "Click a static component to filter, then click an automatic component to view parts"}
              </p>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="chart" className="flex-1 mt-0">
        <div className="border rounded-lg bg-white h-full">
          <StackedBarChartView
            componentMapping={componentMapping}
            conversation={conversation}
            componentTimeline={componentTimeline}
            componentColors={componentColors}
            components={components}
            messageTypeFilters={messageFiltersSet}
          />
        </div>
      </TabsContent>

      {isGrouped && filteredSourceConversationComponents && filteredSourceConversationComponents.length > 0 && (
        <TabsContent value="comparison" className="flex-1 mt-0 overflow-auto">
          <ComponentComparisonView
            sourceConversations={filteredSourceConversationComponents}
            componentColors={componentColors}
            hasActiveFilters={!hasAllFilters}
            groupTitle={groupTitle}
            onConversationClick={onConversationClick}
            viewMode={comparisonViewMode}
            onViewModeChange={onComparisonViewModeChange}
            legendMode={comparisonLegendMode}
            onLegendModeChange={onComparisonLegendModeChange}
            sortField={comparisonSortField}
            onSortFieldChange={onComparisonSortFieldChange}
            sortDirection={comparisonSortDirection}
            onSortDirectionChange={onComparisonSortDirectionChange}
            columnCount={comparisonColumnCount}
            onColumnCountChange={onComparisonColumnCountChange}
            squaresPerRow={comparisonSquaresPerRow}
            onSquaresPerRowChange={onComparisonSquaresPerRowChange}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

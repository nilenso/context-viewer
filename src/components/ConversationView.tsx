import { useState, useMemo, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Maximize2, Minimize2, AlertTriangle, X, Search, ArrowUpDown, Filter, ArrowUpNarrowWide, ArrowDownNarrowWide } from "lucide-react";
import { MessageView } from "./MessageView";
import { ComponentsView } from "./ComponentsView";
import { StackedBarChartView } from "./StackedBarChartView";
import { getDefaultComponentIdentificationPrompt } from "@/prompts";
import type { Conversation, Message } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/componentisation";

interface ConversationViewProps {
  conversation: Conversation;
  componentMapping?: Record<string, string>;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  components?: string[];
  warnings?: string[];
  onReprocessComponents?: (customPrompt: string) => Promise<void>;
  isReprocessing?: boolean;
}

export function ConversationView({
  conversation,
  componentMapping,
  componentTimeline,
  componentColors,
  components,
  warnings,
  onReprocessComponents,
  isReprocessing
}: ConversationViewProps) {
  const [expandAll, setExpandAll] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

  // Lift prompt state to persist across tab changes
  const [currentPrompt, setCurrentPrompt] = useState(getDefaultComponentIdentificationPrompt());

  // Filtering and sorting state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"time-asc" | "time-desc" | "tokens-asc" | "tokens-desc">("time-asc");

  // Component filter state - starts with all components selected
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set());

  // Initialize selected components when components prop changes
  useEffect(() => {
    if (components && components.length > 0) {
      setSelectedComponents(new Set(components));
    }
  }, [components]);

  // Helper to toggle a component filter
  const toggleComponent = (component: string) => {
    setSelectedComponents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(component)) {
        newSet.delete(component);
      } else {
        newSet.add(component);
      }
      return newSet;
    });
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
    const isAllMessages = messageFilters.has("all");
    const isAllComponents = selectedComponents.size === components.length;

    if (isAllMessages && isAllComponents) {
      return "All Filters";
    }

    // Count active filters
    let activeCount = 0;
    if (!isAllMessages) activeCount += messageFilters.size;
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

  // Combined role+type filters based on valid schema combinations
  type MessageFilter =
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

  const [messageFilters, setMessageFilters] = useState<Set<MessageFilter>>(
    new Set([
      "all",
      "system:text",
      "user:text",
      "user:image",
      "user:file",
      "assistant:text",
      "assistant:file",
      "assistant:reasoning",
      "assistant:tool-call",
      "tool:tool-result",
    ])
  );

  // Helper to toggle a message filter
  const toggleMessageFilter = (filter: MessageFilter) => {
    setMessageFilters(prev => {
      const newSet = new Set(prev);
      if (filter === "all") {
        // Toggle all on/off
        if (newSet.has("all")) {
          return new Set();
        } else {
          return new Set([
            "all",
            "system:text",
            "user:text",
            "user:image",
            "user:file",
            "assistant:text",
            "assistant:file",
            "assistant:reasoning",
            "assistant:tool-call",
            "tool:tool-result",
          ]);
        }
      } else {
        // Toggle individual filter
        if (newSet.has(filter)) {
          newSet.delete(filter);
          newSet.delete("all");
        } else {
          newSet.add(filter);
          // Check if all are now selected
          const allFilters: MessageFilter[] = [
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
          if (allFilters.every(f => newSet.has(f))) {
            newSet.add("all");
          }
        }
        return newSet;
      }
    });
  };

  // Get display text for filter button
  const getFilterDisplayText = () => {
    if (messageFilters.has("all")) return "All Messages";
    if (messageFilters.size === 0) return "No Messages";
    return `${messageFilters.size} Filter${messageFilters.size !== 1 ? 's' : ''}`;
  };

  // Valid message filter options grouped by role
  const filterOptions = [
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

  // Helper function to get total tokens for a message
  const getMessageTokens = (message: Message) => {
    return message.parts.reduce((sum, part) => {
      if ("token_count" in part && part.token_count !== undefined) {
        return sum + part.token_count;
      }
      return sum;
    }, 0);
  };

  // Filter messages at the part level
  const filteredAndSortedMessages = useMemo(() => {
    // Helper to check if a part passes all filters
    const partPassesFilters = (part: Message["parts"][number], msgRole: Message["role"]) => {
      // Filter by role+type combinations
      if (!messageFilters.has("all")) {
        const filterKey = `${msgRole}:${part.type}` as MessageFilter;
        if (!messageFilters.has(filterKey)) {
          return false;
        }
      }

      // Filter by components
      if (componentMapping && components && selectedComponents.size > 0 && selectedComponents.size < components.length) {
        const partComponent = componentMapping[part.id];
        if (!partComponent || !selectedComponents.has(partComponent)) {
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
  }, [conversation.messages, messageFilters, searchQuery, sortBy, componentMapping, components, selectedComponents]);

  return (
    <Tabs defaultValue="conversation" className="flex flex-col h-full">
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
                                  checked={messageFilters.has(key)}
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
                            {components.map((component) => (
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
                            ))}
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

              {/* Filter summary */}
              <div className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                Showing {filteredAndSortedMessages.length} of {conversation.messages.length}
              </div>
            </div>
          </div>
        </TooltipProvider>

        <ScrollArea className="h-full border rounded-lg p-4 bg-white">
          <div className="space-y-3">
            {filteredAndSortedMessages.map(({ message, originalIndex }) => (
              <MessageView
                key={originalIndex}
                message={message}
                index={originalIndex}
                isExpanded={expandAll}
                componentMapping={componentMapping}
                componentColors={componentColors}
                onComponentClick={handleComponentClick}
              />
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="components" className="flex-1 mt-0">
        <div className="border rounded-lg bg-white h-full">
          <ComponentsView
            componentMapping={componentMapping}
            conversation={conversation}
            componentTimeline={componentTimeline}
            componentColors={componentColors}
            onReprocessComponents={onReprocessComponents}
            isReprocessing={isReprocessing}
            currentPrompt={currentPrompt}
            setCurrentPrompt={setCurrentPrompt}
          />
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
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}

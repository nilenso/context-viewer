import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/schema";

interface ComponentsViewProps {
  componentMapping?: Record<string, string>;
  conversation: Conversation;
}

// Color schemes for different component types
const getComponentColor = (component: string): string => {
  const lower = component.toLowerCase();

  // Tool-related components (orange/red)
  if (lower.includes("tool") || lower.includes("call")) {
    return "bg-orange-100 text-orange-700 border-orange-300";
  }

  // Document-related components (green/teal)
  if (lower.includes("doc") || lower.includes("file") || lower.includes("context")) {
    return "bg-emerald-100 text-emerald-700 border-emerald-300";
  }

  // Memory-related components (purple)
  if (lower.includes("memory") || lower.includes("history")) {
    return "bg-purple-100 text-purple-700 border-purple-300";
  }

  // Instruction/knowledge components (blue)
  if (lower.includes("instruction") || lower.includes("knowledge") || lower.includes("domain")) {
    return "bg-blue-100 text-blue-700 border-blue-300";
  }

  // Structure/breakdown components (slate)
  if (lower.includes("structure") || lower.includes("breakdown") || lower.includes("block")) {
    return "bg-slate-100 text-slate-700 border-slate-300";
  }

  // Task-related components (indigo)
  if (lower.includes("task") || lower.includes("source") || lower.includes("reflection")) {
    return "bg-indigo-100 text-indigo-700 border-indigo-300";
  }

  // Default (gray)
  return "bg-gray-100 text-gray-700 border-gray-300";
};

export function ComponentsView({ componentMapping, conversation }: ComponentsViewProps) {
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

  // Build a map of part ID to token count
  const partTokenCounts = new Map<string, number>();
  conversation.messages.forEach((message) => {
    message.parts.forEach((part) => {
      const tokenCount = ("token_count" in part && part.token_count) || 0;
      partTokenCounts.set(part.id, tokenCount);
    });
  });

  // Group by component and calculate token counts
  const componentGroups = Object.entries(componentMapping).reduce(
    (acc, [id, component]) => {
      if (!acc[component]) {
        acc[component] = { ids: [], totalTokens: 0 };
      }
      acc[component].ids.push(id);
      acc[component].totalTokens += partTokenCounts.get(id) || 0;
      return acc;
    },
    {} as Record<string, { ids: string[]; totalTokens: number }>
  );

  // Sort components by total token count (descending)
  const components = Object.keys(componentGroups).sort(
    (a, b) => (componentGroups[b]?.totalTokens || 0) - (componentGroups[a]?.totalTokens || 0)
  );

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Component Visualization */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Component Overview</h3>
          <Card className="p-6 bg-gradient-to-br from-gray-50 to-white border-2 border-dashed border-gray-300">
            <div className="flex flex-wrap gap-3">
              {components.map((component) => (
                <div
                  key={component}
                  className={cn(
                    "px-4 py-3 rounded-lg border-2 font-medium text-sm shadow-sm transition-all hover:shadow-md hover:scale-105",
                    getComponentColor(component)
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span>{component}</span>
                    <Badge variant="secondary" className="bg-white/80 text-xs font-semibold">
                      {(componentGroups[component]?.totalTokens || 0).toLocaleString()} tokens
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Detailed Mapping */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Component Mapping</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {components.length} components mapped to {Object.keys(componentMapping).length} message parts
          </p>

          <div className="space-y-3">
            {Object.entries(componentGroups).map(([component, data]) => (
              <Card key={component} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "w-3 h-3 rounded-full",
                        getComponentColor(component)
                      )}
                    />
                    <h4 className="font-semibold text-base">{component}</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {data.totalTokens.toLocaleString()} tokens
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {data.ids.length} parts
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1">
                  {data.ids.map((id) => {
                    const tokens = partTokenCounts.get(id) || 0;
                    return (
                      <div
                        key={id}
                        className="flex items-center justify-between text-xs font-mono py-1 px-2 bg-muted rounded"
                      >
                        <span className="text-muted-foreground">{id}</span>
                        <span className="text-xs font-semibold text-foreground">
                          {tokens.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

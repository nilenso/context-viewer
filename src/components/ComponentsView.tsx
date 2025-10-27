import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Edit3, Play, X, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getComponentColorClasses } from "@/lib/component-colors";
import { getDefaultComponentIdentificationPrompt } from "@/prompts";
import { MessagePartView } from "./MessagePartView";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/componentisation";

interface ComponentsViewProps {
  componentMapping?: Record<string, string>;
  conversation: Conversation;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  onReprocessComponents?: (customPrompt: string) => Promise<void>;
  isReprocessing?: boolean;
  currentPrompt: string;
  setCurrentPrompt: (prompt: string) => void;
}

export function ComponentsView({
  componentMapping,
  conversation,
  componentTimeline,
  componentColors,
  onReprocessComponents,
  isReprocessing = false,
  currentPrompt,
  setCurrentPrompt
}: ComponentsViewProps) {
  // Initialize slider to the last message
  const [currentMessageIndex, setCurrentMessageIndex] = useState(
    conversation.messages.length - 1
  );

  // Track selected component for filtering
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);

  // Prompt editing state (only editing prompt is local to this component)
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(currentPrompt);

  const handleRunReprocessing = async () => {
    if (!onReprocessComponents) return;

    try {
      await onReprocessComponents(editingPrompt);
      setCurrentPrompt(editingPrompt);
      setIsEditingPrompt(false);
    } catch (error) {
      console.error("Failed to reprocess components:", error);
    }
  };

  const handleCancelEdit = () => {
    setEditingPrompt(currentPrompt);
    setIsEditingPrompt(false);
  };

  const handleStartEdit = () => {
    setEditingPrompt(currentPrompt);
    setIsEditingPrompt(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRunReprocessing();
    }
  };

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

  // Get component data for the current message from timeline (for overview)
  let componentTokensForOverview: Record<string, number> = {};
  let totalTokensAtMessage = 0;

  if (componentTimeline && componentTimeline[currentMessageIndex]) {
    const snapshot = componentTimeline[currentMessageIndex];
    componentTokensForOverview = snapshot.componentTokens;
    totalTokensAtMessage = snapshot.totalTokens;
  } else {
    // Fallback: calculate on the fly if timeline not available
    conversation.messages.forEach((message, msgIndex) => {
      if (msgIndex <= currentMessageIndex) {
        message.parts.forEach((part) => {
          const component = componentMapping[part.id];
          if (component) {
            const tokenCount = ("token_count" in part && part.token_count) || 0;
            componentTokensForOverview[component] =
              (componentTokensForOverview[component] || 0) + tokenCount;
            totalTokensAtMessage += tokenCount;
          }
        });
      }
    });
  }

  // Sort components for overview by token count at current message (descending)
  const componentsForOverview = Object.keys(componentTokensForOverview)
    .filter(component => (componentTokensForOverview[component] || 0) > 0)
    .sort((a, b) => (componentTokensForOverview[b] || 0) - (componentTokensForOverview[a] || 0));

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Prompt Editor */}
        {onReprocessComponents && !isEditingPrompt && (
          <div className="mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartEdit}
              className="gap-2"
              disabled={isReprocessing}
            >
              <Edit3 className="h-4 w-4" />
              Edit Prompt
            </Button>
          </div>
        )}

        {onReprocessComponents && isEditingPrompt && (
          <div className="border rounded-lg p-4 bg-gray-50 mb-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Componentisation Prompt</h3>
            </div>

            <div className="space-y-3">
              <div>
                <Textarea
                  value={editingPrompt}
                  onChange={(e) => setEditingPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="min-h-[120px] font-mono text-sm"
                  placeholder="Enter your componentisation prompt..."
                  disabled={isReprocessing}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Edit this to specify a different way to componentise the conversation. Keep it simple for best results. Press Cmd+Enter to run.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleRunReprocessing}
                  disabled={isReprocessing || !editingPrompt.trim()}
                  className="gap-2"
                  size="sm"
                >
                  {isReprocessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Run
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  disabled={isReprocessing}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
                  <AlertCircle className="h-4 w-4" />
                  <span>This will re-run componentisation, visualization, and analysis</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Component Visualization */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Component Overview</h3>

          {/* Timeline Slider */}
          <div className="mb-4 px-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">
                Message {currentMessageIndex + 1} of {conversation.messages.length}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {totalTokensAtMessage.toLocaleString()} tokens
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

          <Card className="p-6 bg-gradient-to-br from-gray-50 to-white border-2 border-dashed border-gray-300">
            <div className="flex flex-wrap gap-3">
              {componentsForOverview.map((component) => (
                <button
                  key={component}
                  onClick={() => setSelectedComponent(selectedComponent === component ? null : component)}
                  className={cn(
                    "px-4 py-3 rounded-lg border-2 font-medium text-sm shadow-sm transition-all hover:shadow-md hover:scale-105 cursor-pointer",
                    getComponentColorClasses(component, componentColors),
                    selectedComponent === component && "ring-2 ring-offset-2 ring-blue-500"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span>{component}</span>
                    <Badge variant="secondary" className="bg-white/80 text-xs font-semibold">
                      {(componentTokensForOverview[component] || 0).toLocaleString()} tokens
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Filtered Messages */}
        {selectedComponent ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">
                Messages for: {selectedComponent}
              </h3>
              <button
                onClick={() => setSelectedComponent(null)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear selection
              </button>
            </div>

            <div className="space-y-4">
              {conversation.messages.map((message, msgIndex) => {
                // Filter parts that belong to the selected component
                const relevantParts = message.parts.filter(
                  (part) => componentMapping[part.id] === selectedComponent
                );

                if (relevantParts.length === 0) return null;

                return (
                  <Card key={msgIndex} className="p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Message {msgIndex + 1}
                      </Badge>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {message.role}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {relevantParts.length} {relevantParts.length === 1 ? 'part' : 'parts'}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {relevantParts.map((part) => {
                        return (
                          <div key={part.id}>
                            {/* Full content (collapsible) */}
                            <MessagePartView part={part as any} isExpanded={false} />
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              }).filter(Boolean)}
            </div>
          </div>
        ) : (
          <div className="text-center p-8 text-muted-foreground">
            <p>Click a component above to view its messages and parts</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

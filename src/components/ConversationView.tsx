import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Maximize2, Minimize2, AlertTriangle, X } from "lucide-react";
import { MessageView } from "./MessageView";
import { ComponentsView } from "./ComponentsView";
import { StackedBarChartView } from "./StackedBarChartView";
import type { Conversation } from "@/schema";
import type { ComponentTimelineSnapshot } from "@/componentisation";

interface ConversationViewProps {
  conversation: Conversation;
  componentMapping?: Record<string, string>;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;
  components?: string[];
  warnings?: string[];
}

export function ConversationView({ conversation, componentMapping, componentTimeline, componentColors, components, warnings }: ConversationViewProps) {
  const [expandAll, setExpandAll] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

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
                The conversation was parsed successfully, but AI-powered features require a valid API key.
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
        <div className="flex items-center justify-between mb-3">
          <div></div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandAll(!expandAll)}
            className="gap-2"
          >
            {expandAll ? (
              <>
                <Minimize2 className="h-4 w-4" />
                Collapse All
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4" />
                Expand All
              </>
            )}
          </Button>
        </div>
        <ScrollArea className="h-full border rounded-lg p-4 bg-white">
          <div className="space-y-3">
            {conversation.messages.map((message, index) => (
              <MessageView
                key={index}
                message={message}
                index={index}
                isExpanded={expandAll}
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

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Maximize2, Minimize2 } from "lucide-react";
import { MessageView } from "./MessageView";
import { ComponentsView } from "./ComponentsView";
import type { Conversation } from "@/schema";

interface ConversationViewProps {
  conversation: Conversation;
  componentMapping?: Record<string, string>;
}

export function ConversationView({ conversation, componentMapping }: ConversationViewProps) {
  const [expandAll, setExpandAll] = useState(false);

  return (
    <Tabs defaultValue="conversation" className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <TabsList>
          <TabsTrigger value="conversation">Conversation</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
        </TabsList>
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

      <TabsContent value="conversation" className="flex-1 mt-0">
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
          <ComponentsView componentMapping={componentMapping} />
        </div>
      </TabsContent>
    </Tabs>
  );
}

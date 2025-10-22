import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2 } from "lucide-react";
import { MessageView } from "./MessageView";
import type { Conversation } from "@/schema";

interface ConversationViewProps {
  conversation: Conversation;
}

export function ConversationView({ conversation }: ConversationViewProps) {
  const [expandAll, setExpandAll] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Conversation</h2>
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
      <ScrollArea className="flex-1 border rounded-lg p-4 bg-white">
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
    </div>
  );
}

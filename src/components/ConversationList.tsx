import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type ConversationStatus = "pending" | "processing" | "success" | "failed";
type ProcessingStep = "parsing" | "counting-tokens" | "summarizing";

interface ParsedConversation {
  id: string;
  filename: string;
  status: ConversationStatus;
  step?: ProcessingStep;
  summary?: {
    totalMessages: number;
  };
  error?: string;
}

interface ConversationListProps {
  conversations: ParsedConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: ConversationListProps) {
  const getStepLabel = (step?: ProcessingStep) => {
    switch (step) {
      case "parsing":
        return "Parsing...";
      case "counting-tokens":
        return "Counting tokens...";
      case "summarizing":
        return "Summarizing...";
      default:
        return "Processing...";
    }
  };

  if (conversations.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No conversations uploaded yet</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Uploaded Conversations</h2>
      <ScrollArea className="h-[calc(100vh-12rem)]">
        <div className="space-y-2 pr-4">
          {conversations.map((conversation) => (
            <Button
              key={conversation.id}
              variant="ghost"
              className={cn(
                "w-full justify-start text-left h-auto py-3 px-3",
                selectedId === conversation.id &&
                  "bg-accent text-accent-foreground",
                conversation.status === "failed" &&
                  "border border-red-200 bg-red-50"
              )}
              onClick={() => onSelect(conversation.id)}
            >
              <div className="flex flex-col gap-1 w-full">
                <div className="flex items-center gap-2">
                  {conversation.status === "pending" && (
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  {conversation.status === "processing" && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                  )}
                  {conversation.status === "success" && (
                    <FileText className="h-4 w-4 shrink-0" />
                  )}
                  {conversation.status === "failed" && (
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <span className="font-medium text-sm truncate">
                    {conversation.filename}
                  </span>
                </div>

                {conversation.status === "pending" && (
                  <Badge variant="secondary" className="self-start text-xs">
                    Waiting...
                  </Badge>
                )}

                {conversation.status === "processing" && (
                  <Badge
                    variant="secondary"
                    className="self-start text-xs text-blue-700"
                  >
                    {getStepLabel(conversation.step)}
                  </Badge>
                )}

                {conversation.status === "success" && conversation.summary && (
                  <Badge variant="secondary" className="self-start text-xs">
                    {conversation.summary.totalMessages} messages
                  </Badge>
                )}

                {conversation.status === "failed" && (
                  <Badge
                    variant="destructive"
                    className="self-start text-xs"
                  >
                    Failed
                  </Badge>
                )}
              </div>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

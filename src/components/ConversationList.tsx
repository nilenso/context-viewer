import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParsedConversation {
  id: string;
  filename: string;
  summary: {
    totalMessages: number;
  };
}

interface ParseProgress {
  currentFile: number;
  totalFiles: number;
  filename: string;
  step: "parsing" | "counting-tokens" | "summarizing";
}

interface ConversationListProps {
  conversations: ParsedConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  progress?: ParseProgress | null;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  progress,
}: ConversationListProps) {
  const getStepLabel = (step: ParseProgress["step"]) => {
    switch (step) {
      case "parsing":
        return "Parsing...";
      case "counting-tokens":
        return "Counting tokens...";
      case "summarizing":
        return "Summarizing...";
    }
  };

  if (conversations.length === 0 && !progress) {
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
          {/* Show progress for file being processed */}
          {progress && (
            <div className="border rounded-md p-3 bg-blue-50 border-blue-200">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                  <span className="font-medium text-sm truncate">
                    {progress.filename}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-blue-700">
                  <span>{getStepLabel(progress.step)}</span>
                  <Badge variant="secondary" className="text-xs">
                    {progress.currentFile} / {progress.totalFiles}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {/* Show uploaded conversations */}
          {conversations.map((conversation) => (
            <Button
              key={conversation.id}
              variant="ghost"
              className={cn(
                "w-full justify-start text-left h-auto py-3 px-3",
                selectedId === conversation.id &&
                  "bg-accent text-accent-foreground"
              )}
              onClick={() => onSelect(conversation.id)}
            >
              <div className="flex flex-col gap-1 w-full">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="font-medium text-sm truncate">
                    {conversation.filename}
                  </span>
                </div>
                <Badge variant="secondary" className="self-start text-xs">
                  {conversation.summary.totalMessages} messages
                </Badge>
              </div>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

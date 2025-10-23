import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, AlertCircle, Clock, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type ConversationStatus = "pending" | "processing" | "success" | "failed";
type ProcessingStep = "parsing" | "counting-tokens" | "segmenting" | "summarizing";

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
  onFilesSelected: (files: File[]) => void;
  isUploading?: boolean;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onFilesSelected,
  isUploading = false,
}: ConversationListProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onFilesSelected,
    accept: {
      "text/plain": [".txt"],
      "application/json": [".json"],
    },
    multiple: true,
    disabled: isUploading,
    noClick: conversations.length > 0, // Disable click when there are conversations
  });

  const getStepLabel = (step?: ProcessingStep) => {
    switch (step) {
      case "parsing":
        return "Parsing...";
      case "counting-tokens":
        return "Counting tokens...";
      case "segmenting":
        return "Segmenting...";
      case "summarizing":
        return "Summarizing...";
      default:
        return "Processing...";
    }
  };

  if (conversations.length === 0) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Uploaded Conversations</h2>
        <Card
          {...getRootProps()}
          className={cn(
            "p-6 border-2 border-dashed cursor-pointer transition-colors",
            isDragActive && "border-primary bg-primary/5",
            isUploading && "opacity-50 cursor-not-allowed"
          )}
        >
          <input {...getInputProps()} />
          <div className="text-center text-muted-foreground">
            <Upload className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">
              {isDragActive ? "Drop files here" : "Drop files here or click to select"}
            </p>
            <p className="text-xs mt-1">
              Accepts .json and .txt files
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Uploaded Conversations</h2>
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-md transition-colors",
          isDragActive && "border-primary bg-primary/5",
          !isDragActive && "border-border"
        )}
      >
        <input {...getInputProps()} />
        <div className="relative">
          <ScrollArea className="h-[calc(100vh-14rem)]">
            <div className="space-y-2 p-4">
              {conversations.map((conversation) => {
                // Show as processing if there's a step (even if status is success)
                const isStillProcessing = conversation.step && conversation.status === "success";

                return (
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
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent dropzone click
                      onSelect(conversation.id);
                    }}
                  >
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex items-center gap-2">
                        {conversation.status === "pending" && (
                          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        {(conversation.status === "processing" || isStillProcessing) && (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                        )}
                        {conversation.status === "success" && !isStillProcessing && (
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

                      {(conversation.status === "processing" || isStillProcessing) && (
                        <Badge
                          variant="secondary"
                          className="self-start text-xs text-blue-700"
                        >
                          {getStepLabel(conversation.step)}
                        </Badge>
                      )}

                      {conversation.status === "success" && !isStillProcessing && conversation.summary && (
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
                );
              })}
            </div>
          </ScrollArea>

          {/* Drop zone overlay hint */}
          {isDragActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10 rounded-md pointer-events-none">
              <div className="bg-background/95 border-2 border-primary rounded-lg p-6 shadow-lg">
                <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium text-primary">Drop files to add</p>
              </div>
            </div>
          )}
        </div>

        {/* Drop indicator - below the list */}
        {!isDragActive && (
          <div className="px-4 py-3 border-t border-dashed">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Upload className="h-3 w-3" />
              <span>Drop files here to add more</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown } from "lucide-react";
import type {
  TextPart,
  ReasoningPart,
  ToolCallPart,
  ToolResultPart,
  ImagePart,
  FilePart,
} from "@/schema";

type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart
  | ImagePart
  | FilePart;

interface MessagePartViewProps {
  part: MessagePart;
  isExpanded?: boolean;
}

export function MessagePartView({ part, isExpanded = false }: MessagePartViewProps) {
  const [isOpen, setIsOpen] = useState(isExpanded);

  // Sync with parent's isExpanded prop
  useEffect(() => {
    setIsOpen(isExpanded);
  }, [isExpanded]);

  const getPartLabel = () => {
    switch (part.type) {
      case "text":
        return "Text";
      case "reasoning":
        return "Reasoning";
      case "tool-call":
        return "Tool Call";
      case "tool-result":
        return "Tool Result";
      case "image":
        return "Image";
      case "file":
        return "File";
      default:
        return "Unknown";
    }
  };

  const getTokenCount = () => {
    if ("token_count" in part && part.token_count !== undefined) {
      return part.token_count;
    }
    return null;
  };

  const renderPartContent = () => {
    switch (part.type) {
      case "text":
        return <div className="whitespace-pre-wrap text-sm break-words overflow-hidden">{part.text}</div>;

      case "reasoning":
        return <div className="whitespace-pre-wrap text-sm text-muted-foreground break-words overflow-hidden">{part.text}</div>;

      case "tool-call":
        return (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="font-medium">ID:</span> {part.toolCallId}
            </div>
            <div className="text-sm">
              <span className="font-medium">Tool:</span> {part.toolName}
            </div>
            <pre className="bg-slate-950 text-slate-50 p-3 rounded-md whitespace-pre-wrap break-words text-xs max-w-full">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          </div>
        );

      case "tool-result":
        return (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="font-medium">ID:</span> {part.toolCallId}
            </div>
            <div className="text-sm">
              <span className="font-medium">Tool:</span> {part.toolName}
            </div>
            <pre className="bg-slate-950 text-slate-50 p-3 rounded-md whitespace-pre-wrap break-words text-xs max-w-full">
              {JSON.stringify(part.output, null, 2)}
            </pre>
            {part.isError && (
              <Badge variant="destructive" className="text-xs">
                Error
              </Badge>
            )}
          </div>
        );

      case "image":
        return (
          <div className="text-sm text-muted-foreground">
            Media type: {part.mediaType ?? "unknown"}
          </div>
        );

      case "file":
        return (
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              Media type: {part.mediaType}
            </div>
            <div className="text-sm text-muted-foreground">
              Data: {part.data.slice(0, 120)}...
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const tokenCount = getTokenCount();

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-md">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {getPartLabel()}
          </span>
          {tokenCount !== null && (
            <Badge variant="secondary" className="text-xs">
              {tokenCount} tokens
            </Badge>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{renderPartContent()}</CollapsibleContent>
    </Collapsible>
  );
}

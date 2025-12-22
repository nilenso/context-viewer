import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown } from "lucide-react";
import { MessagePartView } from "./MessagePartView";
import type { Message, SourceInfo } from "@/schema";
import { cn } from "@/lib/utils";

interface MessageViewProps {
  message: Message;
  index: number;
  isExpanded?: boolean;
  componentMapping?: Record<string, string>;
  componentColors?: Record<string, string>;
  onComponentClick?: (component: string) => void;
  // For grouped conversations
  sourceInfo?: SourceInfo;
  messageSourceMap?: Record<string, SourceInfo>;
}

export function MessageView({ message, index, isExpanded = false, componentMapping, componentColors, onComponentClick, sourceInfo, messageSourceMap }: MessageViewProps) {
  const [isOpen, setIsOpen] = useState(isExpanded);

  // Sync with parent's isExpanded prop
  useEffect(() => {
    setIsOpen(isExpanded);
  }, [isExpanded]);

  const getRoleBgColor = () => {
    switch (message.role) {
      case "system":
        return "bg-blue-50 border-blue-200";
      case "user":
        return "bg-green-50 border-green-200";
      case "assistant":
        return "bg-amber-50 border-amber-200";
      case "tool":
        return "bg-purple-50 border-purple-200";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  const getRoleBadgeColor = () => {
    switch (message.role) {
      case "system":
        return "bg-blue-100 text-blue-800 hover:bg-blue-100";
      case "user":
        return "bg-green-100 text-green-800 hover:bg-green-100";
      case "assistant":
        return "bg-amber-100 text-amber-800 hover:bg-amber-100";
      case "tool":
        return "bg-purple-100 text-purple-800 hover:bg-purple-100";
      default:
        return "";
    }
  };

  const getRoleEmoji = () => {
    switch (message.role) {
      case "system":
        return "⚙️";
      case "user":
        return "👤";
      case "assistant":
        return "🤖";
      case "tool":
        return "🔧";
      default:
        return "";
    }
  };

  const getTotalTokens = () => {
    return message.parts.reduce((sum, part) => {
      if ("token_count" in part && part.token_count !== undefined) {
        return sum + part.token_count;
      }
      return sum;
    }, 0);
  };

  const totalTokens = getTotalTokens();

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn("border rounded-lg", getRoleBgColor())}
    >
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-black/5 transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="text-base">{getRoleEmoji()}</span>
          <Badge className={getRoleBadgeColor()}>{message.role}</Badge>
          <span className="text-sm text-muted-foreground">#{index + 1}</span>
          {sourceInfo && (
            <Badge variant="outline" className="text-xs border-purple-400 text-purple-700 bg-purple-50">
              {sourceInfo.filename}
            </Badge>
          )}
          {totalTokens > 0 && (
            <Badge variant="outline" className="text-xs">
              {totalTokens} tokens total
            </Badge>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="p-3 pt-0">
        <div className="space-y-2 mt-2">
          {message.parts.map((part, partIndex) => (
            <MessagePartView
              key={partIndex}
              part={part}
              isExpanded={isOpen}
              componentMapping={componentMapping}
              componentColors={componentColors}
              onComponentClick={onComponentClick}
              sourceInfo={messageSourceMap?.[part.id]}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

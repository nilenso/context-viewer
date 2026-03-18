import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown } from "lucide-react";
import { getComponentBadgeStyles } from "@/lib/component-colors";
import { getPartLabel, getPartEmoji } from "@/lib/part-type-config";
import { cn } from "@/lib/utils";
import type {
  TextPart,
  ReasoningPart,
  ToolCallPart,
  ToolResultPart,
  ImagePart,
  FilePart,
  OriginInfo,
} from "@/schema";
import type { DimensionData } from "@/component-types";

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
  componentMapping?: Record<string, string>;
  componentColors?: Record<string, string>;
  onComponentClick?: (component: string) => void;
  originInfo?: OriginInfo;
  // Multi-dimension support
  dimensions?: Record<string, DimensionData>;
  activeDimensions?: Set<string>;
}

export function MessagePartView({ part, isExpanded = false, componentMapping, componentColors, onComponentClick, originInfo, dimensions, activeDimensions }: MessagePartViewProps) {
  const [isOpen, setIsOpen] = useState(isExpanded);

  // Sync with parent's isExpanded prop
  useEffect(() => {
    setIsOpen(isExpanded);
  }, [isExpanded]);

  const partLabel = getPartLabel(part.type);
  const partEmoji = getPartEmoji(part.type);

  const getTokenCount = () => {
    if ("token_count" in part && part.token_count !== undefined) {
      return part.token_count;
    }
    return null;
  };

  // Helper to format content as JSON if it's a JSON string
  const formatJSON = (value: unknown): string => {
    // If it's already an object, stringify it
    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value, null, 2);
    }

    // If it's a string, check if it's JSON
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return JSON.stringify(parsed, null, 2);
      } catch {
        // Not JSON, return as-is
        return value;
      }
    }

    // For other types, convert to string
    return String(value);
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
              {formatJSON(part.input)}
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
              {formatJSON(part.output)}
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

  // Get component(s) for this part - support multi-dimension
  const component = componentMapping?.[part.id];
  const dimNames = dimensions ? Object.keys(dimensions) : [];
  const dimensionBadges = dimensions && dimNames.length > 1
    ? dimNames.map((dimName) => {
        const dim = dimensions[dimName];
        if (!dim) return null;
        const comp = dim.componentMapping[part.id];
        if (!comp) return null;
        return { dimName, component: comp, colors: dim.componentColors };
      }).filter((b): b is { dimName: string; component: string; colors: Record<string, string> } => b !== null)
    : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-md">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm">{partEmoji}</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {partLabel}
          </span>
          {tokenCount !== null && (
            <Badge variant="secondary" className="text-xs">
              {tokenCount} tokens
            </Badge>
          )}
          {/* Multi-dimension badges */}
          {dimensionBadges ? dimensionBadges.map(({ dimName, component: comp, colors }) => {
            const { classes, style } = getComponentBadgeStyles(comp, colors);
            return (
              <Badge
                key={dimName}
                variant="outline"
                className={cn(
                  "text-xs font-medium border",
                  classes,
                  onComponentClick && "cursor-pointer hover:opacity-80 transition-opacity"
                )}
                style={style || undefined}
                onClick={(e) => {
                  if (onComponentClick) {
                    e.stopPropagation();
                    onComponentClick(comp);
                  }
                }}
              >
                <span className="text-muted-foreground">{dimName}:</span> {comp}
              </Badge>
            );
          }) : component && (() => {
            const { classes, style } = getComponentBadgeStyles(component, componentColors);
            return (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-medium border",
                  classes,
                  onComponentClick && "cursor-pointer hover:opacity-80 transition-opacity"
                )}
                style={style || undefined}
                onClick={(e) => {
                  if (onComponentClick) {
                    e.stopPropagation();
                    onComponentClick(component);
                  }
                }}
              >
                {component}
              </Badge>
            );
          })()}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{renderPartContent()}</CollapsibleContent>
    </Collapsible>
  );
}

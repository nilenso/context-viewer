import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, ChevronLeft, Menu } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConversationMetadataCard } from "./ConversationMetadataCard";
import type { ConversationMetadata } from "../parser";
import type { Conversation } from "../schema";

interface AISummaryProps {
  summary?: string;
  analysis?: string;
  isSummaryStreaming?: boolean;
  isAnalysisStreaming?: boolean;
  activeTab?: string;
  onTabChange?: (value: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  metadata?: ConversationMetadata;
  conversation?: Conversation;
}

export function AISummary({ summary, analysis, isSummaryStreaming, isAnalysisStreaming, activeTab, onTabChange, isCollapsed = false, onToggleCollapse, metadata, conversation }: AISummaryProps) {
  const noContent = !summary && !isSummaryStreaming && !analysis && !isAnalysisStreaming;

  // Collapsed state - show minimal toggle button
  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className="h-8 w-8 p-0"
          title="Open insights panel"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground mt-2 [writing-mode:vertical-lr] rotate-180">
          Insights
        </span>
      </div>
    );
  }

  if (noContent) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Insights</h2>
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="h-8 w-8 p-0"
              title="Collapse insights panel"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Summary and analysis will appear here once processing begins...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderMarkdown = (content?: string, isStreaming?: boolean) => (
    <div className="text-sm text-foreground/90">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h3 className="text-base font-semibold mt-3 mb-2 first:mt-0" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h4 className="text-sm font-semibold mt-3 mb-1 first:mt-0" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h5 className="text-sm font-medium mt-2 mb-1 first:mt-0" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="mb-2 leading-relaxed" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="list-disc ml-4 mb-2 space-y-0.5" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="list-decimal ml-4 mb-2 space-y-0.5" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-relaxed" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-foreground" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="italic" {...props} />
          ),
          table: ({ node, ...props }) => (
            <table className="w-full border-collapse my-2" {...props} />
          ),
          thead: ({ node, ...props }) => (
            <thead className="bg-muted/50" {...props} />
          ),
          th: ({ node, ...props }) => (
            <th className="border border-border px-2 py-1 text-left font-medium" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-border px-2 py-1" {...props} />
          ),
        }}
      >
        {content}
      </Markdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-600 animate-pulse" />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Insights</h2>
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="h-8 w-8 p-0"
            title="Collapse insights panel"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Static metadata card */}
      <ConversationMetadataCard metadata={metadata} conversation={conversation} />

      <Tabs
        value={activeTab || "summary"}
        onValueChange={onTabChange}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="summary" className="flex items-center gap-1.5">
            Summary
            {isSummaryStreaming && (
              <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
            )}
          </TabsTrigger>
          <TabsTrigger value="analysis" className="flex items-center gap-1.5">
            Analysis
            {isAnalysisStreaming && (
              <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {summary || isSummaryStreaming ? (
                renderMarkdown(summary, isSummaryStreaming)
              ) : (
                <p className="text-sm text-muted-foreground">
                  Summary will appear here once processing begins...
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {analysis || isAnalysisStreaming ? (
                renderMarkdown(analysis, isAnalysisStreaming)
              ) : (
                <p className="text-sm text-muted-foreground">
                  Analysis will appear after componentization completes...
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

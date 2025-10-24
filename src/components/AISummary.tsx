import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import Markdown from "react-markdown";

interface AISummaryProps {
  summary?: string;
  analysis?: string;
  isSummaryStreaming?: boolean;
  isAnalysisStreaming?: boolean;
}

export function AISummary({ summary, analysis, isSummaryStreaming, isAnalysisStreaming }: AISummaryProps) {
  const noContent = !summary && !isSummaryStreaming && !analysis && !isAnalysisStreaming;

  if (noContent) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Insights</h2>
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
      <h2 className="text-xl font-semibold">Insights</h2>
      <Tabs defaultValue="summary" className="w-full">
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

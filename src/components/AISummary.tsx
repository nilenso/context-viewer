import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import Markdown from "react-markdown";

interface AISummaryProps {
  summary?: string;
  isStreaming?: boolean;
}

export function AISummary({ summary, isStreaming }: AISummaryProps) {
  if (!summary && !isStreaming) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Summary</h2>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Summary will appear here once processing begins...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Summary</h2>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            Conversation Analysis
            {isStreaming && (
              <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
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
              {summary}
            </Markdown>
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-600 animate-pulse" />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ConversationSummary as Summary } from "@/conversation-summary";

interface ConversationSummaryProps {
  summary: Summary;
}

export function ConversationSummary({ summary }: ConversationSummaryProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Summary</h2>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Messages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.totalMessages}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Messages by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(summary.messagesByRole).map(([role, count]) => (
              <div key={role} className="flex items-center justify-between">
                <Badge variant="outline" className="capitalize">
                  {role}
                </Badge>
                <span className="text-sm font-medium">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Content Structure</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Text-only</span>
              <span className="text-sm font-medium">
                {summary.textOnlyMessageCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Structured</span>
              <span className="text-sm font-medium">
                {summary.structuredContentMessageCount}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {Object.keys(summary.partCounts).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Parts by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(summary.partCounts).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <Badge variant="secondary" className="capitalize">
                    {type}
                  </Badge>
                  <span className="text-sm font-medium">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

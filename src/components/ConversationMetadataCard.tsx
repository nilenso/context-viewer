import { Card, CardContent } from "@/components/ui/card";
import type { ConversationMetadata } from "../parser";
import type { Conversation } from "../schema";

interface ConversationMetadataCardProps {
  metadata?: ConversationMetadata;
  conversation?: Conversation;
}

/**
 * Calculate conversation statistics from messages
 */
function calculateStats(conversation: Conversation) {
  const messages = conversation.messages;
  const messageCount = messages.length;

  // Count turns (user messages)
  const turnCount = messages.filter((m) => m.role === "user").length;

  // Calculate duration from timestamps
  let durationMs: number | undefined;
  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;

  for (const message of messages) {
    if (message.timestamp) {
      const ts = new Date(message.timestamp);
      if (!isNaN(ts.getTime())) {
        if (!firstTimestamp || ts < firstTimestamp) {
          firstTimestamp = ts;
        }
        if (!lastTimestamp || ts > lastTimestamp) {
          lastTimestamp = ts;
        }
      }
    }
  }

  if (firstTimestamp && lastTimestamp) {
    durationMs = lastTimestamp.getTime() - firstTimestamp.getTime();
  }

  return { messageCount, turnCount, durationMs };
}

/**
 * Format duration in a human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export function ConversationMetadataCard({
  metadata,
  conversation,
}: ConversationMetadataCardProps) {
  if (!conversation) {
    return null;
  }

  const stats = calculateStats(conversation);

  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Format",
      value: metadata?.parserName || "Unknown",
    },
  ];

  // Add agent field for OpenCode format
  if (metadata?.agent) {
    rows.push({
      label: "Agent",
      value: metadata.agent,
    });
  }

  rows.push(
    {
      label: "Model",
      value: metadata?.model || "Unknown",
    },
    {
      label: "Messages",
      value: stats.messageCount.toString(),
    },
    {
      label: "Turns",
      value: stats.turnCount.toString(),
    },
    {
      label: "Duration",
      value: stats.durationMs ? formatDuration(stats.durationMs) : "N/A",
    }
  );

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 text-muted-foreground font-medium pr-4">
                  {row.label}
                </td>
                <td className="py-1.5 text-right font-mono">
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

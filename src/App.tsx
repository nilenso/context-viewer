import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { parserRegistry } from "./parser";
import "./parsers";
import type { Conversation } from "./schema";
import {
  summarizeConversation,
  type ConversationSummary,
} from "./conversation-summary";
import { addTokenCounts } from "./add-token-counts";
import { FileUploader } from "./components/FileUploader";
import { ConversationList } from "./components/ConversationList";
import { ConversationView } from "./components/ConversationView";
import { ConversationSummary as SummaryView } from "./components/ConversationSummary";
import { Card } from "./components/ui/card";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}`;

interface ParsedConversation {
  id: string;
  filename: string;
  conversation: Conversation;
  summary: ConversationSummary;
}

interface FailedParse {
  id: string;
  filename: string;
  error: string;
}

interface ParseResult {
  success: ParsedConversation[];
  failed: FailedParse[];
}

interface ParseProgress {
  currentFile: number;
  totalFiles: number;
  filename: string;
  step: "parsing" | "counting-tokens" | "summarizing";
}

async function parseFiles(
  files: File[],
  onProgress?: (progress: ParseProgress) => void
): Promise<ParseResult> {
  const success: ParsedConversation[] = [];
  const failed: FailedParse[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;

    try {
      onProgress?.({
        currentFile: i + 1,
        totalFiles: files.length,
        filename: file.name,
        step: "parsing",
      });

      const text = await file.text();
      const data = JSON.parse(text);
      const parsedConversation = parserRegistry.parse(data);

      onProgress?.({
        currentFile: i + 1,
        totalFiles: files.length,
        filename: file.name,
        step: "counting-tokens",
      });

      const conversationWithTokens = await addTokenCounts(parsedConversation);

      onProgress?.({
        currentFile: i + 1,
        totalFiles: files.length,
        filename: file.name,
        step: "summarizing",
      });

      const summary = summarizeConversation(conversationWithTokens);
      success.push({
        id: generateId(),
        filename: file.name,
        conversation: conversationWithTokens,
        summary,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown parsing error";
      failed.push({
        id: generateId(),
        filename: file.name,
        error: message,
      });
    }
  }

  return { success, failed };
}

export default function App() {
  const [parsedConversations, setParsedConversations] = useState<
    ParsedConversation[]
  >([]);
  const [failedParses, setFailedParses] = useState<FailedParse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ParseProgress | null>(null);

  const parseMutation = useMutation({
    mutationFn: (files: File[]) => parseFiles(files, setProgress),
    onSuccess: ({ success, failed }) => {
      setParsedConversations((prev) => [...prev, ...success]);
      setFailedParses((prev) => [...prev, ...failed]);
      setProgress(null);

      if (success.length > 0) {
        const [firstSuccess] = success;
        if (firstSuccess) {
          setSelectedId((prev) => prev ?? firstSuccess.id);
        }
      }
    },
    onError: () => {
      setProgress(null);
    },
  });

  const selectedConversation = useMemo(() => {
    if (parsedConversations.length === 0) return undefined;
    return (
      parsedConversations.find((conv) => conv.id === selectedId) ??
      parsedConversations[0]
    );
  }, [parsedConversations, selectedId]);

  useEffect(() => {
    if (parsedConversations.length === 0) {
      setSelectedId(null);
      return;
    }

    const [firstConversation] = parsedConversations;
    if (!firstConversation) {
      setSelectedId(null);
      return;
    }

    if (!selectedId) {
      setSelectedId(firstConversation.id);
      return;
    }

    if (!parsedConversations.some((conv) => conv.id === selectedId)) {
      setSelectedId(firstConversation.id);
    }
  }, [parsedConversations, selectedId]);

  // Debug: Expose current conversation to window for console exploration
  useEffect(() => {
    if (import.meta.env.DEV && selectedConversation) {
      (window as any).__debug = {
        conversation: selectedConversation.conversation,
        summary: selectedConversation.summary,
        msg: (index: number) => selectedConversation.conversation.messages[index],
        part: (msgIndex: number, partIndex: number) =>
          selectedConversation.conversation.messages[msgIndex]?.content[partIndex],
      };
      console.log("🔍 Debug mode: Access conversation via window.__debug");
      console.log("  - window.__debug.conversation (full conversation)");
      console.log("  - window.__debug.summary (conversation summary)");
      console.log("  - window.__debug.msg(0) (get message by index)");
      console.log("  - window.__debug.part(0, 0) (get part by message/part index)");
    }
  }, [selectedConversation]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="w-[1440px] space-y-6">
        {/* Header */}
        <header>
          <h1 className="text-3xl font-bold">Context Viewer</h1>
          <p className="text-muted-foreground mt-1">
            Upload conversation logs to analyze their structure and token usage
          </p>
        </header>

        {/* File Uploader */}
        <FileUploader
          onFilesSelected={(files) => parseMutation.mutate(files)}
          isUploading={parseMutation.isPending}
        />

        {/* Error Panel */}
        {failedParses.length > 0 && (
          <Card className="bg-red-50 border-red-200 p-4">
            <h2 className="text-lg font-semibold text-red-900 mb-2">
              Failed to parse
            </h2>
            <ul className="space-y-1">
              {failedParses.map((failure) => (
                <li key={failure.id} className="text-sm text-red-800">
                  <span className="font-medium">{failure.filename}</span>:{" "}
                  {failure.error}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-[280px_minmax(800px,800px)_320px] gap-6">
          {/* Sidebar: Conversation List */}
          <aside className="space-y-4">
            <ConversationList
              conversations={parsedConversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              progress={progress}
            />
          </aside>

          {/* Main Panel: Conversation View */}
          <main>
            {selectedConversation ? (
              <ConversationView conversation={selectedConversation.conversation} />
            ) : (
              <Card className="p-12 text-center">
                <h2 className="text-xl font-semibold text-muted-foreground mb-2">
                  No conversation selected
                </h2>
                <p className="text-sm text-muted-foreground">
                  Upload files to see their parsed conversations
                </p>
              </Card>
            )}
          </main>

          {/* Right Sidebar: Summary */}
          <aside>
            {selectedConversation && (
              <SummaryView summary={selectedConversation.summary} />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

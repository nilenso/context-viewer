import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { parserRegistry } from "./parser";
import "./parsers";
import type { Conversation } from "./schema";
import {
  summarizeConversation,
  type ConversationSummary,
} from "./conversation-summary";
import { addTokenCounts } from "./add-token-counts";
import { segmentConversation } from "./segmentation";
import { ConversationList } from "./components/ConversationList";
import { ConversationView } from "./components/ConversationView";
import { ConversationSummary as SummaryView } from "./components/ConversationSummary";
import { Card } from "./components/ui/card";
import { Clock, Loader2, AlertCircle } from "lucide-react";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}`;

type ConversationStatus = "pending" | "processing" | "success" | "failed";
type ProcessingStep = "parsing" | "counting-tokens" | "segmenting" | "summarizing";

interface ParsedConversation {
  id: string;
  filename: string;
  status: ConversationStatus;
  step?: ProcessingStep;
  conversation?: Conversation;
  summary?: ConversationSummary;
  error?: string;
}

interface ParseResult {
  conversations: ParsedConversation[];
}

async function parseFiles(
  files: File[],
  fileIds: Map<number, string>, // Map of file index to id
  onStepUpdate?: (id: string, step: ProcessingStep) => void,
  onFileComplete?: (conversation: ParsedConversation) => void
): Promise<ParseResult> {
  const conversations: ParsedConversation[] = [];

  // Give React a chance to render the placeholders before we start processing
  await new Promise(resolve => setTimeout(resolve, 0));

  console.log(`🔄 parseFiles: Starting to process ${files.length} files`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;

    const id = fileIds.get(i) || generateId();
    console.log(`📄 Processing file ${i + 1}/${files.length}: ${file.name} (id: ${id})`);

    try {
      // Step 1: Parsing
      console.log(`  ⚙️  Step 1: Parsing ${file.name}`);
      onStepUpdate?.(id, "parsing");

      const text = await file.text();
      const data = JSON.parse(text);
      const parsedConversation = parserRegistry.parse(data);

      // Generate summary immediately after parsing
      const summary = summarizeConversation(parsedConversation);

      // Show the conversation and summary immediately after parsing!
      const afterParsing: ParsedConversation = {
        id,
        filename: file.name,
        status: "success",
        conversation: parsedConversation,
        summary,
        step: "counting-tokens", // Still processing in background
      };
      onFileComplete?.(afterParsing);
      console.log(`  ✅ Parsing complete, rendering UI for ${file.name}`);

      // Step 2: Counting tokens (in background from user's perspective)
      console.log(`  ⚙️  Step 2: Counting tokens for ${file.name}`);
      onStepUpdate?.(id, "counting-tokens");
      const conversationWithTokens = await addTokenCounts(parsedConversation);

      // Update with token counts (keep existing summary)
      const afterTokens: ParsedConversation = {
        id,
        filename: file.name,
        status: "success",
        conversation: conversationWithTokens,
        summary,
        step: "segmenting", // Still processing segmentation
      };
      onFileComplete?.(afterTokens);
      console.log(`  ✅ Token counting complete for ${file.name}`);

      // Step 3: Segmenting large parts
      console.log(`  ⚙️  Step 3: Segmenting large parts for ${file.name}`);
      onStepUpdate?.(id, "segmenting");
      const segmentedConversation = await segmentConversation(
        conversationWithTokens,
        (processed, total) => {
          console.log(`    📊 Segmentation progress: ${processed}/${total}`);
        }
      );

      // Re-count tokens after segmentation (new parts need token counts)
      const conversationAfterSegmentation = await addTokenCounts(segmentedConversation);

      // Final update with segmented conversation (keep existing summary)
      const completed: ParsedConversation = {
        id,
        filename: file.name,
        status: "success",
        conversation: conversationAfterSegmentation,
        summary,
      };

      conversations.push(completed);
      onFileComplete?.(completed);
      console.log(`  ✅ Completed ${file.name}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown parsing error";
      const failed: ParsedConversation = {
        id,
        filename: file.name,
        status: "failed",
        error: message,
      };

      conversations.push(failed);
      onFileComplete?.(failed);
      console.log(`  ❌ Failed ${file.name}: ${message}`);
    }
  }

  console.log(`✅ parseFiles: Completed processing all ${files.length} files`);
  return { conversations };
}

export default function App() {
  const [parsedConversations, setParsedConversations] = useState<
    ParsedConversation[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileIdsRef = useRef<Map<number, string>>(new Map());

  const parseMutation = useMutation({
    mutationFn: (files: File[]) => {
      console.log(`🚀 Mutation started with ${files.length} files`);
      return parseFiles(
        files,
        fileIdsRef.current,
        (id, step) => {
          // Update step (and set status to processing)
          console.log(`  🔄 Step update: ${id} → ${step}`);
          setParsedConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, status: "processing" as const, step }
                : conv
            )
          );
        },
        (completed) => {
          // Update the conversation in place as each file completes
          console.log(`  ✅ File complete: ${completed.filename} (${completed.status})`);
          setParsedConversations((prev) =>
            prev.map((conv) =>
              conv.id === completed.id ? completed : conv
            )
          );
        }
      );
    },
    onMutate: (files: File[]) => {
      console.log(`📥 onMutate: Creating placeholders for ${files.length} files`);
      // Create placeholder entries immediately
      const fileIds = new Map<number, string>();
      const placeholders: ParsedConversation[] = files.map((file, index) => {
        const id = generateId();
        fileIds.set(index, id);
        console.log(`  📝 Placeholder [${index}]: ${file.name} → ${id}`);
        return {
          id,
          filename: file.name,
          status: "pending",
        };
      });

      fileIdsRef.current = fileIds;
      setParsedConversations((prev) => [...prev, ...placeholders]);

      // Auto-select first file if nothing selected
      if (!selectedId && placeholders[0]) {
        setSelectedId(placeholders[0].id);
      }
    },
    onSuccess: () => {
      fileIdsRef.current = new Map();
    },
    onError: () => {
      fileIdsRef.current = new Map();
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
    if (import.meta.env.DEV && selectedConversation?.conversation) {
      (window as any).__debug = {
        conversation: selectedConversation.conversation,
        summary: selectedConversation.summary,
        msg: (index: number) => selectedConversation.conversation!.messages[index],
        part: (msgIndex: number, partIndex: number) =>
          selectedConversation.conversation!.messages[msgIndex]?.parts[partIndex],
      };
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

        {/* Main Content */}
        <div className="grid grid-cols-[280px_minmax(800px,800px)_320px] gap-6">
          {/* Sidebar: Conversation List */}
          <aside className="space-y-4">
            <ConversationList
              conversations={parsedConversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onFilesSelected={(files) => parseMutation.mutate(files)}
              isUploading={parseMutation.isPending}
            />
          </aside>

          {/* Main Panel: Conversation View */}
          <main>
            {selectedConversation ? (
              selectedConversation.conversation ? (
                // Show conversation as soon as it's available (even if still processing tokens/summary)
                <ConversationView
                  conversation={selectedConversation.conversation}
                />
              ) : selectedConversation.status === "pending" ? (
                <Card className="p-12 text-center">
                  <Clock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <h2 className="text-xl font-semibold text-muted-foreground mb-2">
                    Waiting to process
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedConversation.filename} will be processed soon
                  </p>
                </Card>
              ) : selectedConversation.status === "processing" ? (
                <Card className="p-12 text-center">
                  <Loader2 className="h-12 w-12 mx-auto mb-4 text-blue-600 animate-spin" />
                  <h2 className="text-xl font-semibold text-muted-foreground mb-2">
                    Parsing...
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedConversation.filename}
                  </p>
                </Card>
              ) : selectedConversation.status === "failed" ? (
                <Card className="p-12 text-center border-red-200 bg-red-50">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-600" />
                  <h2 className="text-xl font-semibold text-red-900 mb-2">
                    Failed to parse
                  </h2>
                  <p className="text-sm text-red-800 mb-4">
                    {selectedConversation.filename}
                  </p>
                  <p className="text-sm text-red-700 font-mono bg-red-100 p-4 rounded">
                    {selectedConversation.error || "Unknown error"}
                  </p>
                </Card>
              ) : null
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
            {selectedConversation && selectedConversation.summary && (
              <SummaryView summary={selectedConversation.summary} />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

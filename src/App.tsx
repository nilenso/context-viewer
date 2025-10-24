import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { parserRegistry } from "./parser";
import "./parsers";
import type { Conversation } from "./schema";
import {
  summarizeConversation,
  type ConversationSummary,
} from "./conversation-summary";
import { addTokenCounts } from "./add-token-counts";
import { segmentConversation } from "./segmentation";
import {
  componentiseConversation,
  assignComponentColors,
  getComponentisationConfig,
  type ComponentTimelineSnapshot
} from "./componentisation";
import { generateConversationSummary, generateContextAnalysis } from "./ai-summary";
import { ConversationList } from "./components/ConversationList";
import { ConversationView } from "./components/ConversationView";
import { AISummary } from "./components/AISummary";
import { Card } from "./components/ui/card";
import { Clock, Loader2, AlertCircle, Upload } from "lucide-react";
import { cn } from "./lib/utils";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}`;

type ConversationStatus = "pending" | "processing" | "success" | "failed";
type ProcessingStep = "parsing" | "counting-tokens" | "segmenting" | "finding-components" | "coloring" | "analysis";

interface ParsedConversation {
  id: string;
  filename: string;
  status: ConversationStatus;
  step?: ProcessingStep;
  conversation?: Conversation;
  summary?: ConversationSummary;
  aiSummary?: string; // Streaming AI-generated summary
  analysis?: string; // Streaming AI-generated analysis
  components?: string[];
  componentMapping?: Record<string, string>;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>; // component name → color name
  error?: string;
  warnings?: string[]; // Non-fatal warnings (e.g., AI features that failed)
}

interface ParseResult {
  conversations: ParsedConversation[];
}

async function parseFiles(
  files: File[],
  fileIds: Map<number, string>, // Map of file index to id
  onStepUpdate?: (id: string, step: ProcessingStep) => void,
  onFileComplete?: (conversation: ParsedConversation) => void,
  onAISummaryChunk?: (id: string, chunk: string) => void,
  onAnalysisChunk?: (id: string, chunk: string) => void
): Promise<ParseResult> {
  // Give React a chance to render the placeholders before we start processing
  await new Promise(resolve => setTimeout(resolve, 0));

  // Process all files in parallel
  const conversations = await Promise.all(
    files.map(async (file, i) => {
      if (!file) return null;

      const id = fileIds.get(i) || generateId();

      try {
        // Step 1: Parsing
        onStepUpdate?.(id, "parsing");

        const text = await file.text();
        const data = JSON.parse(text);
        const parsedConversation = parserRegistry.parse(data);

        // Generate summary immediately after parsing
        const summary = summarizeConversation(parsedConversation);

        // Show the conversation and summary immediately after parsing
        const afterParsing: ParsedConversation = {
          id,
          filename: file.name,
          status: "success",
          conversation: parsedConversation,
          summary,
          step: "counting-tokens",
        };
        onFileComplete?.(afterParsing);

        // Step 2: Counting tokens
        onStepUpdate?.(id, "counting-tokens");
        const conversationWithTokens = await addTokenCounts(parsedConversation);

        // Update with token counts
        const afterTokens: ParsedConversation = {
          id,
          filename: file.name,
          status: "success",
          conversation: conversationWithTokens,
          summary,
          step: "segmenting",
        };
        onFileComplete?.(afterTokens);

        // Step 3: Segmentation and AI Summary in parallel
        onStepUpdate?.(id, "segmenting");

        const warnings: string[] = [];

        const [
          segmentationResult,
          summaryResult,
        ] = await Promise.all([
          // Segmentation
          (async () => {
            const result = await segmentConversation(conversationWithTokens);
            if (result.error) {
              warnings.push(result.error);
            }
            const reCountedAfterSegmentation = await addTokenCounts(result.conversation);
            return reCountedAfterSegmentation;
          })(),

          // AI Summary (streaming)
          (async () => {
            const result = await generateConversationSummary(
              conversationWithTokens,
              (chunk) => {
                onAISummaryChunk?.(id, chunk);
              }
            );
            if (result.error) {
              warnings.push(result.error);
            }
            return result.summary;
          })(),
        ]);

        const conversationAfterSegmentation = segmentationResult;
        const aiSummaryText = summaryResult;

        // Update with segmented conversation
        const afterSegmentation: ParsedConversation = {
          id,
          filename: file.name,
          status: "success",
          conversation: conversationAfterSegmentation,
          summary,
          aiSummary: aiSummaryText,
          warnings: warnings.length > 0 ? warnings : undefined,
          step: "finding-components",
        };
        onFileComplete?.(afterSegmentation);

        // Step 4: Componentization (uses full conversation)
        onStepUpdate?.(id, "finding-components");
        const componentResult = await componentiseConversation(
          conversationAfterSegmentation
        );

        if (componentResult.error) {
          warnings.push(componentResult.error);
        }

        const { components, mapping, timeline } = componentResult;

        // Update with components before coloring (all gray)
        const afterComponentisation: ParsedConversation = {
          id,
          filename: file.name,
          status: "success",
          conversation: conversationAfterSegmentation,
          summary,
          aiSummary: aiSummaryText,
          components,
          componentMapping: mapping,
          componentTimeline: timeline,
          warnings: warnings.length > 0 ? warnings : undefined,
          step: "coloring",
        };
        onFileComplete?.(afterComponentisation);

        // Step 5: Assign colors to components using AI
        onStepUpdate?.(id, "coloring");
        let componentColors: Record<string, string> = {};

        const colorConfig = getComponentisationConfig();
        if (colorConfig && components.length > 0) {
          componentColors = await assignComponentColors(components, colorConfig);
        }

        // Update with colors
        const afterColoring: ParsedConversation = {
          id,
          filename: file.name,
          status: "success",
          conversation: conversationAfterSegmentation,
          summary,
          aiSummary: aiSummaryText,
          components,
          componentMapping: mapping,
          componentTimeline: timeline,
          componentColors,
          warnings: warnings.length > 0 ? warnings : undefined,
          step: "analysis",
        };
        onFileComplete?.(afterColoring);

        // Step 6: Generate context analysis
        onStepUpdate?.(id, "analysis");
        let analysisText = "";

        if (aiSummaryText && components.length > 0 && timeline.length > 0) {
          const analysisResult = await generateContextAnalysis(
            conversationAfterSegmentation,
            timeline,
            components,
            aiSummaryText,
            (chunk) => {
              onAnalysisChunk?.(id, chunk);
            }
          );
          analysisText = analysisResult.analysis;
          if (analysisResult.error) {
            warnings.push(analysisResult.error);
          }
        }

        // Final update with analysis
        const completed: ParsedConversation = {
          id,
          filename: file.name,
          status: "success",
          conversation: conversationAfterSegmentation,
          summary,
          aiSummary: aiSummaryText,
          analysis: analysisText,
          components,
          componentMapping: mapping,
          componentTimeline: timeline,
          componentColors,
          warnings: warnings.length > 0 ? warnings : undefined,
        };

        onFileComplete?.(completed);
        return completed;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown parsing error";
        const failed: ParsedConversation = {
          id,
          filename: file.name,
          status: "failed",
          error: message,
        };

        onFileComplete?.(failed);
        return failed;
      }
    })
  );

  // Filter out any null values from skipped files
  return { conversations: conversations.filter((c): c is ParsedConversation => c !== null) };
}

export default function App() {
  const [parsedConversations, setParsedConversations] = useState<
    ParsedConversation[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [insightsTab, setInsightsTab] = useState<string>("summary");
  const fileIdsRef = useRef<Map<number, string>>(new Map());

  const parseMutation = useMutation({
    mutationFn: (files: File[]) => {
      return parseFiles(
        files,
        fileIdsRef.current,
        (id, step) => {
          // Update step
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
          setParsedConversations((prev) =>
            prev.map((conv) =>
              conv.id === completed.id ? completed : conv
            )
          );
        },
        (id, chunk) => {
          // Update AI summary as chunks arrive (streaming)
          setParsedConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, aiSummary: (conv.aiSummary || "") + chunk }
                : conv
            )
          );
        },
        (id, chunk) => {
          // Update analysis as chunks arrive (streaming)
          setParsedConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, analysis: (conv.analysis || "") + chunk }
                : conv
            )
          );
        }
      );
    },
    onMutate: (files: File[]) => {
      // Create placeholder entries immediately
      const fileIds = new Map<number, string>();
      const placeholders: ParsedConversation[] = files.map((file, index) => {
        const id = generateId();
        fileIds.set(index, id);
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

  // Switch to analysis tab when analysis starts streaming
  useEffect(() => {
    if (selectedConversation?.status === "processing" &&
        selectedConversation.step === "analysis") {
      setInsightsTab("analysis");
    }
  }, [selectedConversation?.status, selectedConversation?.step]);

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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files: File[]) => parseMutation.mutate(files),
    accept: {
      "text/plain": [".txt"],
      "application/json": [".json"],
    },
    multiple: true,
    noClick: parsedConversations.length > 0, // Only enable click when empty
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header Banner */}
      <header className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 px-6 py-4 mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2 text-slate-700">
          <img
            src="/nilenso-logo.svg"
            alt="Nilenso"
            className="h-5 w-auto"
          />
          <span className="font-normal text-slate-400">/</span>
          <span>context-viewer</span>
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload conversation logs to analyze their structure and token usage
        </p>
      </header>

      <div className="space-y-6 px-6">
        {parsedConversations.length === 0 ? (
          /* Empty State - Full Page Drop Zone */
          <div
            {...getRootProps()}
            className={cn(
              "min-h-[calc(100vh-12rem)] border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors",
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/50"
            )}
          >
            <input {...getInputProps()} />
            <div className="text-center p-12">
              <Upload className="h-20 w-20 mx-auto mb-6 text-muted-foreground/50" />
              <h2 className="text-2xl font-semibold text-muted-foreground mb-3">
                {isDragActive ? "Drop files here" : "Drop conversation files here"}
              </h2>
              <p className="text-muted-foreground mb-2">
                or click to browse
              </p>
              <p className="text-sm text-muted-foreground">
                Accepts .json and .txt files
              </p>
            </div>
          </div>
        ) : (
          /* Main Content */
          <div className="grid grid-cols-[260px_minmax(500px,1fr)_minmax(420px,30%)] gap-6">
          {/* Sidebar: Conversation List */}
          <aside className="space-y-4">
            <ConversationList
              conversations={parsedConversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onFilesSelected={(files) => parseMutation.mutate(files)}
            />
          </aside>

          {/* Main Panel: Conversation View */}
          <main>
            {selectedConversation ? (
              selectedConversation.conversation ? (
                // Show conversation as soon as it's available (even if still processing tokens/summary)
                <ConversationView
                  conversation={selectedConversation.conversation}
                  componentMapping={selectedConversation.componentMapping}
                  componentTimeline={selectedConversation.componentTimeline}
                  componentColors={selectedConversation.componentColors}
                  components={selectedConversation.components}
                  warnings={selectedConversation.warnings}
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

          {/* Right Sidebar: AI Summary & Analysis */}
          <aside>
            {selectedConversation && (
              <AISummary
                summary={selectedConversation.aiSummary}
                analysis={selectedConversation.analysis}
                isSummaryStreaming={
                  selectedConversation.status === "processing" &&
                  selectedConversation.step !== "analysis" &&
                  !!selectedConversation.conversation &&
                  !selectedConversation.componentColors
                }
                isAnalysisStreaming={
                  selectedConversation.status === "processing" &&
                  selectedConversation.step === "analysis"
                }
                activeTab={insightsTab}
                onTabChange={setInsightsTab}
              />
            )}
          </aside>
        </div>
        )}
      </div>
    </div>
  );
}

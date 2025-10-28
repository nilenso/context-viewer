import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, AlertCircle, Clock, Upload, ChevronRight, Check, Circle, AlertTriangle, Menu, ChevronLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ConversationStatus = "pending" | "processing" | "success" | "failed";
type ProcessingStep = "parsing" | "counting-tokens" | "segmenting" | "finding-components" | "coloring" | "analysis";

/**
 * Represents the persisted state of a workflow execution.
 * Minimal subset needed for the conversation list display.
 */
interface WorkflowState {
  id: string;
  filename: string;
  status?: ConversationStatus;
  step?: ProcessingStep;
  summary?: {
    totalMessages: number;
  };
  error?: string;
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep, number>>;
}

interface ConversationListProps {
  conversations: WorkflowState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFilesSelected: (files: File[]) => void;
  onEditPrompt?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onLockSidebar?: () => void;
  isHovered?: boolean;
  isLocked?: boolean;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onFilesSelected,
  onEditPrompt,
  isCollapsed = false,
  onToggleCollapse,
  onLockSidebar,
  isHovered = false,
  isLocked = false,
}: ConversationListProps) {
  // Initialize with all conversations expanded by default
  const [collapsedProgress, setCollapsedProgress] = useState<Set<string>>(new Set());

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onFilesSelected,
    accept: {
      "text/plain": [".txt"],
      "application/json": [".json"],
    },
    multiple: true,
    noClick: conversations.length > 0, // Disable click when there are conversations
  });

  const toggleProgress = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedProgress((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const processingSteps: { key: ProcessingStep; label: string }[] = [
    { key: "parsing", label: "Parse conversation" },
    { key: "counting-tokens", label: "Count tokens" },
    { key: "segmenting", label: "Segment content" },
    { key: "finding-components", label: "Find components" },
    { key: "coloring", label: "Assign colors" },
    { key: "analysis", label: "Generate analysis" },
  ];

  const getStepStatus = (conversation: WorkflowState, stepKey: ProcessingStep): "pending" | "in-progress" | "completed" => {
    if (conversation.status === "failed") return "pending";
    if (conversation.status === "pending") return "pending";

    const stepIndex = processingSteps.findIndex((s) => s.key === stepKey);
    const currentStepIndex = processingSteps.findIndex((s) => s.key === conversation.step);

    if (currentStepIndex === -1 && conversation.status === "success") {
      // All steps completed
      return "completed";
    }

    if (stepIndex < currentStepIndex) return "completed";
    if (stepIndex === currentStepIndex) return "in-progress";
    return "pending";
  };

  // When collapsed, show minimal UI (just hamburger when not hovered)
  if (isCollapsed && !isHovered) {
    return (
      <div className="h-full flex flex-col bg-background border rounded-md transition-all duration-200 w-12">
        {/* Collapsed header with hamburger */}
        <div className="flex items-center justify-center p-3 border-b">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="h-8 w-8 p-0"
            title="Open sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // When collapsed but hovered, show full content as overlay
  const isOverlay = isCollapsed && isHovered;

  if (conversations.length === 0) {
    return (
      <div className={cn(
        "space-y-3",
        isOverlay && "absolute left-0 top-0 w-[280px] shadow-xl z-50 bg-background border rounded-md p-4"
      )}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Uploaded Conversations</h2>
          {onToggleCollapse && !isOverlay && !isLocked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="h-8 w-8 p-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {onToggleCollapse && isLocked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="h-8 w-8 p-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {isOverlay && onLockSidebar && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLockSidebar}
              className="h-8 w-8 p-0"
              title="Lock sidebar open"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Card
          {...getRootProps()}
          className={cn(
            "p-6 border-2 border-dashed cursor-pointer transition-colors",
            isDragActive && "border-primary bg-primary/5"
          )}
        >
          <input {...getInputProps()} />
          <div className="text-center text-muted-foreground">
            <Upload className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">
              {isDragActive ? "Drop files here" : "Drop files here or click to select"}
            </p>
            <p className="text-xs mt-1">
              Accepts .json and .txt files
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn(
      "space-y-3",
      isOverlay && "absolute left-0 top-0 w-[280px] shadow-xl z-50 bg-background border rounded-md p-4 h-full flex flex-col"
    )}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Uploaded Conversations</h2>
        {onToggleCollapse && !isOverlay && !isLocked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="h-8 w-8 p-0"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        {onToggleCollapse && isLocked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="h-8 w-8 p-0"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        {isOverlay && onLockSidebar && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onLockSidebar}
            className="h-8 w-8 p-0"
            title="Lock sidebar open"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-md transition-colors",
          isDragActive && "border-primary bg-primary/5",
          !isDragActive && "border-border",
          isOverlay && "flex-1 flex flex-col"
        )}
      >
        <input {...getInputProps()} />
        <div className="relative">
          <ScrollArea className="h-[calc(100vh-14rem)]">
            <div className="space-y-2">
              {conversations.map((conversation) => {
                const isProcessing = conversation.status === "processing" ||
                  (conversation.status === "success" && conversation.step);
                const isExpanded = !collapsedProgress.has(conversation.id);

                return (
                  <div
                    key={conversation.id}
                    onClick={() => onSelect(conversation.id)}
                    className={cn(
                      "rounded-md border border-gray-200 cursor-pointer",
                      selectedId === conversation.id && "border-blue-400 bg-blue-50/50",
                      conversation.status === "failed" && "border-red-200 bg-red-50"
                    )}
                  >
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-start text-left h-auto py-3 px-3",
                        selectedId === conversation.id && "hover:bg-blue-50"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(conversation.id);
                      }}
                    >
                      <div className="flex flex-col gap-1 w-full">
                        <div className="flex items-center gap-2">
                          {conversation.status === "pending" && (
                            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          {isProcessing && (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                          )}
                          {conversation.status === "success" && !conversation.step && !conversation.warnings && (
                            <FileText className="h-4 w-4 shrink-0" />
                          )}
                          {conversation.status === "success" && !conversation.step && conversation.warnings && (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
                          )}
                          {conversation.status === "failed" && (
                            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                          )}
                          <span className="font-medium text-sm truncate flex-1">
                            {conversation.filename}
                          </span>
                          {(isProcessing || conversation.status === "success") && (
                            <div
                              onClick={(e) => toggleProgress(conversation.id, e)}
                              className="shrink-0 p-0.5 hover:bg-accent rounded cursor-pointer"
                            >
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 transition-transform",
                                  isExpanded && "rotate-90"
                                )}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 items-center flex-wrap">
                          {conversation.status === "success" && !conversation.step && conversation.summary && (
                            <Badge variant="secondary" className="self-start text-xs">
                              {conversation.summary.totalMessages} messages
                            </Badge>
                          )}

                          {conversation.status === "failed" && (
                            <Badge variant="destructive" className="self-start text-xs">
                              Failed
                            </Badge>
                          )}

                          {conversation.status === "success" && !conversation.step && conversation.warnings && (
                            <Badge variant="outline" className="self-start text-xs border-yellow-600 text-yellow-700 bg-yellow-50">
                              {conversation.warnings.length} warning{conversation.warnings.length > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Button>

                    {/* Progress Checklist */}
                    {isExpanded && (isProcessing || conversation.status === "success") && (
                      <div className="px-3 pb-3 pt-1 border-t">
                        <div className="space-y-1">
                          {processingSteps.map((step) => {
                            const status = getStepStatus(conversation, step.key);
                            const timing = conversation.stepTimings?.[step.key];
                            const isFindComponentsStep = step.key === "finding-components";
                            return (
                              <div key={step.key}>
                                <div className="flex items-center gap-2 text-xs">
                                  {status === "completed" && (
                                    <Check className="h-3 w-3 text-green-600" />
                                  )}
                                  {status === "in-progress" && (
                                    <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                                  )}
                                  {status === "pending" && (
                                    <Circle className="h-3 w-3 text-gray-300" />
                                  )}
                                  <span
                                    className={cn(
                                      "flex-1",
                                      status === "completed" && "text-green-700",
                                      status === "in-progress" && "text-blue-700 font-medium",
                                      status === "pending" && "text-muted-foreground"
                                    )}
                                  >
                                    {step.label}
                                  </span>
                                  {status === "completed" && timing !== undefined && (
                                    <span className="text-gray-500 text-xs">
                                      ({timing}s)
                                    </span>
                                  )}
                                </div>
                                {/* Edit prompt link - show below "Find components" step */}
                                {isFindComponentsStep && onEditPrompt && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditPrompt();
                                    }}
                                    className="ml-5 mt-0.5 text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                  >
                                    Edit prompt
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Drop zone overlay hint */}
          {isDragActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10 rounded-md pointer-events-none">
              <div className="bg-background/95 border-2 border-primary rounded-lg p-6 shadow-lg">
                <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium text-primary">Drop files to add</p>
              </div>
            </div>
          )}
        </div>

        {/* Drop indicator - below the list */}
        {!isDragActive && (
          <div className="px-4 py-3 border-t border-dashed">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Upload className="h-3 w-3" />
              <span>Drop files here to add more</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

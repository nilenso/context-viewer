import { useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Card } from "@/ui/components/ui/card";
import { Eye, EyeOff, Key, Check, Play, RefreshCw } from "lucide-react";
import {
  STAGE_MODEL_OPTIONS,
  getAnalyzerConfig,
  getRuntimeApiKey,
  getRuntimeStageModels,
  setRuntimeApiKey,
  setRuntimeStageModel,
  isApiKeyFromEnv,
  type AIStage,
} from "@/lib/ai-config";
import { useConversationStore } from "@/stores/conversation-store";
import { useUrlStore } from "@/stores/url-store";
import { useUIStore } from "@/stores/ui-store";
import { hasStageRun } from "@/lib/stage-groups";
import { getChangedModelStages, reprocessStageModels, saveStageModel } from "@/stores/actions";

interface ApiKeyInputProps {
  onApiKeyChange: (hasKey: boolean) => void;
  pausedPipelineCount: number;
  onResumePipelines: () => void;
}

export function ApiKeyInput({
  onApiKeyChange,
  pausedPipelineCount,
  onResumePipelines,
}: ApiKeyInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setModelVersion] = useState(0);
  const selectedId = useUrlStore((state) => state.conversationId);
  const conversations = useConversationStore((state) => state.conversations);
  const conversation = conversations.find((candidate) => candidate.id === selectedId);
  const group = useConversationStore((state) => selectedId ? state.groups[selectedId] : undefined);
  const reprocessingId = useUIStore((state) => state.reprocessingId);

  const currentKey = getRuntimeApiKey();
  const isEnvConfigured = isApiKeyFromEnv();
  const hasKey = !!(currentKey || isEnvConfigured);

  const handleSave = () => {
    const trimmedKey = inputValue.trim();

    if (!trimmedKey) {
      setError("API key is required");
      return;
    }

    if (!trimmedKey.startsWith("sk-")) {
      setError("API key should start with 'sk-'");
      return;
    }

    setRuntimeApiKey(trimmedKey);
    setInputValue("");
    setError(null);
    onApiKeyChange(true);
  };

  const handleClear = () => {
    setRuntimeApiKey(null);
    setInputValue("");
    setError(null);
    onApiKeyChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    }
  };

  const stages: Array<{ stage: AIStage; label: string }> = [
    { stage: "segmenting", label: "Segmentation" },
    { stage: "identifying-components", label: "Topic identification" },
    { stage: "classifying-components", label: "Classification" },
    { stage: "coloring", label: "Coloring" },
  ];
  const stageModels = group?.stageModels || conversation?.stageModels || getRuntimeStageModels();
  const targetIds = group?.fileIds || (conversation ? [conversation.id] : []);
  const hasPreviousRun = conversations.some((candidate) =>
    targetIds.includes(candidate.id)
      && (["segmenting", "finding-components", "coloring"] as const)
        .some((stage) => hasStageRun(candidate.workflowMetrics, stage)),
  );
  const modelSelectors = (
    <div className="mt-3 pt-3 border-t space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Models by stage</div>
      {stages.map(({ stage, label }) => (
        <label key={stage} className="grid gap-1 text-xs">
          <span>{label}</span>
          <select
            value={stageModels[stage] || getAnalyzerConfig().model}
            onChange={(event) => {
              if (selectedId) saveStageModel(selectedId, stage, event.target.value);
              else {
                setRuntimeStageModel(stage, event.target.value);
                setModelVersion((version) => version + 1);
              }
            }}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2"
          >
            {STAGE_MODEL_OPTIONS[stage].map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      ))}
      {selectedId && (
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocessStageModels(selectedId, false)}
            disabled={!hasPreviousRun || reprocessingId === selectedId || getChangedModelStages(selectedId).length === 0}
            className="h-8 text-xs"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${reprocessingId === selectedId ? "animate-spin" : ""}`} />
            Re-run stage
          </Button>
          <Button
            size="sm"
            onClick={() => reprocessStageModels(selectedId, true)}
            disabled={reprocessingId === selectedId}
            className="h-8 text-xs"
          >
            Run all stages
          </Button>
        </div>
      )}
    </div>
  );

  // If configured via environment variable
  if (isEnvConfigured) {
    return (
      <Card className="p-3 mt-3 bg-green-50 border-green-200">
        <div className="flex items-center gap-2 text-sm text-green-700">
          <Check className="h-4 w-4" />
          <span>OpenRouter key configured via environment</span>
        </div>
        {modelSelectors}
      </Card>
    );
  }

  // If key is set at runtime
  if (hasKey && currentKey) {
    return (
      <Card className="p-3 mt-3 bg-green-50 border-green-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <Check className="h-4 w-4" />
            <span>OpenRouter key configured</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-7 text-xs text-green-700 hover:text-green-800 hover:bg-green-100"
          >
            Change
          </Button>
        </div>
        {pausedPipelineCount > 0 && (
          <Button
            variant="default"
            size="sm"
            onClick={onResumePipelines}
            className="w-full mt-2 h-8 text-xs"
          >
            <Play className="h-3 w-3 mr-1" />
            Resume {pausedPipelineCount} paused pipeline
            {pausedPipelineCount > 1 ? "s" : ""}
          </Button>
        )}
        {modelSelectors}
      </Card>
    );
  }

  // No key configured - show input
  return (
    <Card className="p-3 mt-3 bg-amber-50 border-amber-200">
      <div className="flex items-center gap-2 text-sm text-amber-700 mb-2">
        <Key className="h-4 w-4" />
        <span>Enter OpenRouter API key for AI features</span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={showPassword ? "text" : "password"}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="sk-or-v1-..."
            className="h-8 text-sm pr-8"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          className="h-8 text-xs"
          disabled={!inputValue.trim()}
        >
          Save
        </Button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <p className="text-xs text-amber-600 mt-1">
        Key is stored in memory only (lost on tab close)
      </p>
      {modelSelectors}
    </Card>
  );
}

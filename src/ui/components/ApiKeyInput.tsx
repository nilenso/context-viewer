import { useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Card } from "@/ui/components/ui/card";
import { Eye, EyeOff, Key, Check, Play } from "lucide-react";
import {
  getRuntimeApiKey,
  setRuntimeApiKey,
  isApiKeyFromEnv,
} from "@/stages/ai/config";

interface ApiKeyInputProps {
  onApiKeyChange: (hasKey: boolean) => void;
  pausedWorkflowCount: number;
  onResumeWorkflows: () => void;
}

export function ApiKeyInput({
  onApiKeyChange,
  pausedWorkflowCount,
  onResumeWorkflows,
}: ApiKeyInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // If configured via environment variable
  if (isEnvConfigured) {
    return (
      <Card className="p-3 mt-3 bg-green-50 border-green-200">
        <div className="flex items-center gap-2 text-sm text-green-700">
          <Check className="h-4 w-4" />
          <span>API key configured via environment</span>
        </div>
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
            <span>API key configured</span>
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
        {pausedWorkflowCount > 0 && (
          <Button
            variant="default"
            size="sm"
            onClick={onResumeWorkflows}
            className="w-full mt-2 h-8 text-xs"
          >
            <Play className="h-3 w-3 mr-1" />
            Resume {pausedWorkflowCount} paused workflow
            {pausedWorkflowCount > 1 ? "s" : ""}
          </Button>
        )}
      </Card>
    );
  }

  // No key configured - show input
  return (
    <Card className="p-3 mt-3 bg-amber-50 border-amber-200">
      <div className="flex items-center gap-2 text-sm text-amber-700 mb-2">
        <Key className="h-4 w-4" />
        <span>Enter OpenAI API key for AI features</span>
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
            placeholder="sk-..."
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
    </Card>
  );
}

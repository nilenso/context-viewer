import { cn } from "@/ui/lib/utils";
import type { PresetSummary, PresetConfig } from "@/lib/preset-loader";
import { Sparkles, FileText, GitBranch, Check } from "lucide-react";

interface PresetSelectorProps {
  presets: PresetSummary[];
  selectedPresetId: string | null;
  onSelectPreset: (presetId: string | null) => void;
  isLoading?: boolean;
}

const presetIcons: Record<string, React.ReactNode> = {
  "system-prompts": <FileText className="h-5 w-5" />,
  "workflow-phases": <GitBranch className="h-5 w-5" />,
};

export function PresetSelector({
  presets,
  selectedPresetId,
  onSelectPreset,
  isLoading,
}: PresetSelectorProps) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Component Taxonomy
      </h3>
      <div className="flex flex-wrap gap-3">
        {/* Auto (AI) option */}
        <button
          onClick={() => onSelectPreset(null)}
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-all",
            "hover:border-primary/50 hover:bg-accent/50",
            selectedPresetId === null
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border bg-card"
          )}
        >
          <div
            className={cn(
              "p-1.5 rounded-md",
              selectedPresetId === null
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">Auto (AI)</span>
              {selectedPresetId === null && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              AI identifies components
            </span>
          </div>
        </button>

        {/* Preset options */}
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelectPreset(preset.id)}
            disabled={isLoading}
            className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-all",
              "hover:border-primary/50 hover:bg-accent/50",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              selectedPresetId === preset.id
                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                : "border-border bg-card"
            )}
          >
            <div
              className={cn(
                "p-1.5 rounded-md",
                selectedPresetId === preset.id
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {presetIcons[preset.id] || <FileText className="h-5 w-5" />}
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{preset.name}</span>
                {selectedPresetId === preset.id && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {preset.description}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

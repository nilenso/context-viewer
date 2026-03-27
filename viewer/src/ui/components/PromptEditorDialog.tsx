import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Button } from "@/ui/components/ui/button";
import { Textarea } from "@/ui/components/ui/textarea";
import { Input } from "@/ui/components/ui/input";
import { AlertCircle } from "lucide-react";

interface PromptEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
  placeholder?: string;
  warningText: string;
  applyButtonText?: string;
  /** Optional segmentation threshold control */
  threshold?: number;
  onThresholdChange?: (value: number) => void;
  thresholdDefault?: number;
}

export function PromptEditorDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  onChange,
  onApply,
  placeholder = "Enter your prompt...",
  warningText,
  applyButtonText = "Apply & Reprocess",
  threshold,
  onThresholdChange,
  thresholdDefault,
}: PromptEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          <p className="text-sm text-muted-foreground">{description}</p>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && value.trim()) {
                e.preventDefault();
                onApply();
              }
            }}
            placeholder={placeholder}
            className="min-h-[300px] font-mono text-sm resize-none border-2 focus-visible:ring-0"
          />
          {onThresholdChange && threshold != null && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium whitespace-nowrap">
                Min token threshold
              </label>
              <Input
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => onThresholdChange(Number(e.target.value))}
                className="w-28 h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                Only message parts with more than this many tokens will be segmented
                {thresholdDefault != null && (
                  <> (default: {thresholdDefault})</>
                )}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>{warningText}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onApply} disabled={!value.trim()}>
            {applyButtonText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

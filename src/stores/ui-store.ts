import { create } from "zustand";
import {
  getDefaultComponentIdentificationPrompt,
  getDefaultSegmentationPrompt,
  getDefaultSummaryPrompt,
  getDefaultAnalysisPrompt,
  getDefaultColoringPrompt,
} from "../prompts";
import { DEFAULT_SEGMENTATION_THRESHOLD } from "../segmentation";
import { hasApiKey } from "../ai-config";
import type { PresetConfig, PresetSummary } from "../lib/preset-loader";

interface UIStore {
  // Selection state
  selectedIds: Set<string>;
  toggleSelect: (id: string, isSelected: boolean) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;

  // API key state
  hasApiKeyState: boolean;
  setHasApiKeyState: (value: boolean) => void;

  // Prompt editor dialog state
  isPromptDialogOpen: boolean;
  editingPrompt: string;
  setIsPromptDialogOpen: (open: boolean) => void;
  setEditingPrompt: (prompt: string) => void;

  // Components editor dialog state
  isComponentsDialogOpen: boolean;
  editingComponents: string;
  setIsComponentsDialogOpen: (open: boolean) => void;
  setEditingComponents: (components: string) => void;

  // Segmentation prompt editor
  isSegmentationPromptDialogOpen: boolean;
  editingSegmentationPrompt: string;
  editingSegmentationThreshold: number;
  setIsSegmentationPromptDialogOpen: (open: boolean) => void;
  setEditingSegmentationPrompt: (prompt: string) => void;
  setEditingSegmentationThreshold: (threshold: number) => void;

  // Summary prompt editor
  isSummaryPromptDialogOpen: boolean;
  editingSummaryPrompt: string;
  setIsSummaryPromptDialogOpen: (open: boolean) => void;
  setEditingSummaryPrompt: (prompt: string) => void;

  // Analysis prompt editor
  isAnalysisPromptDialogOpen: boolean;
  editingAnalysisPrompt: string;
  setIsAnalysisPromptDialogOpen: (open: boolean) => void;
  setEditingAnalysisPrompt: (prompt: string) => void;

  // Coloring prompt editor
  isColoringPromptDialogOpen: boolean;
  editingColoringPrompt: string;
  setIsColoringPromptDialogOpen: (open: boolean) => void;
  setEditingColoringPrompt: (prompt: string) => void;

  // Multi-dimension state
  activeDimensions: Set<string>;
  editingDimensionName: string | null;
  setActiveDimensions: (dims: Set<string>) => void;
  setEditingDimensionName: (name: string | null) => void;

  // Preset state
  availablePresets: PresetSummary[];
  selectedPresetId: string | null;
  loadedPreset: PresetConfig | null;
  isPresetLoading: boolean;
  presetError: string | null;
  setAvailablePresets: (presets: PresetSummary[]) => void;
  setSelectedPresetId: (id: string | null) => void;
  setLoadedPreset: (preset: PresetConfig | null) => void;
  setIsPresetLoading: (loading: boolean) => void;
  setPresetError: (error: string | null) => void;

  // URL auto-import state
  importError: string | null;
  isUrlImporting: boolean;
  setImportError: (error: string | null) => void;
  setIsUrlImporting: (importing: boolean) => void;

  // Reprocessing state
  reprocessingId: string | null;
  setReprocessingId: (id: string | null) => void;

  // Display settings
  percentPrecision: number; // 0, 1, or 2 decimal places
  setPercentPrecision: (precision: number) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  // Selection state
  selectedIds: new Set(),
  toggleSelect: (id, isSelected) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (isSelected) next.add(id);
      else next.delete(id);
      return { selectedIds: next };
    }),
  clearSelection: () => set({ selectedIds: new Set() }),
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),

  // API key state
  hasApiKeyState: hasApiKey(),
  setHasApiKeyState: (value) => set({ hasApiKeyState: value }),

  // Prompt editor
  isPromptDialogOpen: false,
  editingPrompt: getDefaultComponentIdentificationPrompt(),
  setIsPromptDialogOpen: (open) => set({ isPromptDialogOpen: open }),
  setEditingPrompt: (prompt) => set({ editingPrompt: prompt }),

  // Components editor
  isComponentsDialogOpen: false,
  editingComponents: "",
  setIsComponentsDialogOpen: (open) => set({ isComponentsDialogOpen: open }),
  setEditingComponents: (components) => set({ editingComponents: components }),

  // Segmentation prompt editor
  isSegmentationPromptDialogOpen: false,
  editingSegmentationPrompt: getDefaultSegmentationPrompt(),
  editingSegmentationThreshold: DEFAULT_SEGMENTATION_THRESHOLD,
  setIsSegmentationPromptDialogOpen: (open) => set({ isSegmentationPromptDialogOpen: open }),
  setEditingSegmentationPrompt: (prompt) => set({ editingSegmentationPrompt: prompt }),
  setEditingSegmentationThreshold: (threshold) => set({ editingSegmentationThreshold: threshold }),

  // Summary prompt editor
  isSummaryPromptDialogOpen: false,
  editingSummaryPrompt: getDefaultSummaryPrompt(),
  setIsSummaryPromptDialogOpen: (open) => set({ isSummaryPromptDialogOpen: open }),
  setEditingSummaryPrompt: (prompt) => set({ editingSummaryPrompt: prompt }),

  // Analysis prompt editor
  isAnalysisPromptDialogOpen: false,
  editingAnalysisPrompt: getDefaultAnalysisPrompt(),
  setIsAnalysisPromptDialogOpen: (open) => set({ isAnalysisPromptDialogOpen: open }),
  setEditingAnalysisPrompt: (prompt) => set({ editingAnalysisPrompt: prompt }),

  // Coloring prompt editor
  isColoringPromptDialogOpen: false,
  editingColoringPrompt: getDefaultColoringPrompt(),
  setIsColoringPromptDialogOpen: (open) => set({ isColoringPromptDialogOpen: open }),
  setEditingColoringPrompt: (prompt) => set({ editingColoringPrompt: prompt }),

  // Multi-dimension state
  activeDimensions: new Set(["default"]),
  editingDimensionName: null,
  setActiveDimensions: (dims) => set({ activeDimensions: dims }),
  setEditingDimensionName: (name) => set({ editingDimensionName: name }),

  // Preset state
  availablePresets: [],
  selectedPresetId: null,
  loadedPreset: null,
  isPresetLoading: false,
  presetError: null,
  setAvailablePresets: (presets) => set({ availablePresets: presets }),
  setSelectedPresetId: (id) => set({ selectedPresetId: id }),
  setLoadedPreset: (preset) => set({ loadedPreset: preset }),
  setIsPresetLoading: (loading) => set({ isPresetLoading: loading }),
  setPresetError: (error) => set({ presetError: error }),

  // URL auto-import state
  importError: null,
  isUrlImporting: false,
  setImportError: (error) => set({ importError: error }),
  setIsUrlImporting: (importing) => set({ isUrlImporting: importing }),

  // Reprocessing state
  reprocessingId: null,
  setReprocessingId: (id) => set({ reprocessingId: id }),

  // Display settings
  percentPrecision: 0,
  setPercentPrecision: (precision) => set({ percentPrecision: precision }),
}));

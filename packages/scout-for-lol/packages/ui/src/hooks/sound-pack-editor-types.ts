import type {
  SoundPack,
  SoundRule,
  SoundPool,
  SoundEntry,
  EventType,
} from "@scout-for-lol/data";
import type {
  SoundPackAdapter,
  Champion,
  LocalPlayer,
} from "@scout-for-lol/ui/types/adapter.ts";

// =============================================================================
// Context Types
// =============================================================================

export type SoundPackEditorState = {
  /** The sound pack being edited */
  soundPack: SoundPack;
  /** Whether the pack has unsaved changes */
  isDirty: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Available champions for autocomplete */
  champions: Champion[];
  /** Local player info (if available) */
  localPlayer: LocalPlayer | null;
};

export type SoundPackEditorActions = {
  // Pack-level operations
  updatePack: (updates: Partial<SoundPack>) => void;
  resetPack: () => void;
  savePack: () => Promise<void>;
  loadPack: () => Promise<void>;
  importPack: () => Promise<void>;
  exportPack: () => Promise<void>;

  // Settings operations
  setMasterVolume: (volume: number) => void;
  setNormalization: (enabled: boolean) => void;

  // Default sounds operations
  setDefaultPool: (eventType: EventType, pool: SoundPool) => void;
  addDefaultSound: (
    eventType: EventType,
    entry: Omit<SoundEntry, "id">,
  ) => void;
  updateDefaultSound: (
    eventType: EventType,
    soundId: string,
    updates: Partial<SoundEntry>,
  ) => void;
  removeDefaultSound: (eventType: EventType, soundId: string) => void;

  // Rule operations
  addRule: (rule?: Partial<SoundRule>) => void;
  updateRule: (ruleId: string, updates: Partial<SoundRule>) => void;
  removeRule: (ruleId: string) => void;
  reorderRules: (fromIndex: number, toIndex: number) => void;

  // Rule sound operations
  addRuleSound: (ruleId: string, entry: Omit<SoundEntry, "id">) => void;
  updateRuleSound: (
    ruleId: string,
    soundId: string,
    updates: Partial<SoundEntry>,
  ) => void;
  removeRuleSound: (ruleId: string, soundId: string) => void;

  // Preview operations
  previewSound: (
    source: { type: "file"; path: string } | { type: "url"; url: string },
  ) => Promise<void>;
  stopPreview: () => void;

  // Utility
  clearError: () => void;
};

export type SoundPackEditorContextValue = SoundPackEditorState &
  SoundPackEditorActions & {
    adapter: SoundPackAdapter;
  };

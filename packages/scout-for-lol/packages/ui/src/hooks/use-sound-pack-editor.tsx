/**
 * Sound Pack Editor Hook and Context
 *
 * Provides state management and operations for editing sound packs.
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { SoundPack, SoundRule, SoundPool, SoundEntry, EventType } from "@scout-for-lol/data";
import { createEmptySoundPack, createEmptySoundPool, createEmptyRule, generateId } from "@scout-for-lol/data";
import type { SoundPackAdapter, Champion, LocalPlayer } from "@scout-for-lol/ui/types/adapter.ts";

// =============================================================================
// Context Types
// =============================================================================

type SoundPackEditorState = {
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

type SoundPackEditorActions = {
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
  addDefaultSound: (eventType: EventType, entry: Omit<SoundEntry, "id">) => void;
  updateDefaultSound: (eventType: EventType, soundId: string, updates: Partial<SoundEntry>) => void;
  removeDefaultSound: (eventType: EventType, soundId: string) => void;

  // Rule operations
  addRule: (rule?: Partial<SoundRule>) => void;
  updateRule: (ruleId: string, updates: Partial<SoundRule>) => void;
  removeRule: (ruleId: string) => void;
  reorderRules: (fromIndex: number, toIndex: number) => void;

  // Rule sound operations
  addRuleSound: (ruleId: string, entry: Omit<SoundEntry, "id">) => void;
  updateRuleSound: (ruleId: string, soundId: string, updates: Partial<SoundEntry>) => void;
  removeRuleSound: (ruleId: string, soundId: string) => void;

  // Preview operations
  previewSound: (source: { type: "file"; path: string } | { type: "url"; url: string }) => Promise<void>;
  stopPreview: () => void;

  // Utility
  clearError: () => void;
};

type SoundPackEditorContextValue = SoundPackEditorState &
  SoundPackEditorActions & {
    adapter: SoundPackAdapter;
  };

// =============================================================================
// Context
// =============================================================================

const SoundPackEditorContext = createContext<SoundPackEditorContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

type SoundPackEditorProviderProps = {
  adapter: SoundPackAdapter;
  children: ReactNode;
  /** Initial sound pack (optional, will load from storage if not provided) */
  initialPack?: SoundPack;
};

export function SoundPackEditorProvider({ adapter, children, initialPack }: SoundPackEditorProviderProps) {
  const [soundPack, setSoundPack] = useState<SoundPack>(
    initialPack ?? createEmptySoundPack(generateId(), "My Sound Pack"),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [localPlayer, setLocalPlayer] = useState<LocalPlayer | null>(null);

  // Load champions on mount
  // eslint-disable-next-line custom-rules/no-use-effect -- Needed to load initial data from adapter
  useEffect(() => {
    const loadChampions = async () => {
      try {
        const result = await adapter.getChampions();
        setChampions(result);
      } catch (error) {
        console.error(error);
      }
    };
    void loadChampions();
  }, [adapter]);

  // Load local player on mount
  // eslint-disable-next-line custom-rules/no-use-effect -- Needed to load initial data from adapter
  useEffect(() => {
    const loadLocalPlayer = async () => {
      try {
        const result = await adapter.getLocalPlayer();
        setLocalPlayer(result);
      } catch {
        setLocalPlayer(null);
      }
    };
    void loadLocalPlayer();
  }, [adapter]);

  // Load pack on mount if no initial pack provided
  // eslint-disable-next-line custom-rules/no-use-effect -- Needed to load initial data from adapter
  useEffect(() => {
    if (!initialPack) {
      const loadPack = async () => {
        try {
          const pack = await adapter.loadSoundPack();
          if (pack) {
            setSoundPack(pack);
          }
        } catch (error) {
          console.error(error);
        }
      };
      void loadPack();
    }
  }, [adapter, initialPack]);

  // ==========================================================================
  // Pack-level operations
  // ==========================================================================

  const updatePack = useCallback((updates: Partial<SoundPack>) => {
    setSoundPack((prev) => ({ ...prev, ...updates }));
    setIsDirty(true);
  }, []);

  const resetPack = useCallback(() => {
    setSoundPack(createEmptySoundPack(generateId(), "My Sound Pack"));
    setIsDirty(false);
  }, []);

  const savePack = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await adapter.saveSoundPack(soundPack);
      setIsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save sound pack");
    } finally {
      setIsLoading(false);
    }
  }, [adapter, soundPack]);

  const loadPack = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const pack = await adapter.loadSoundPack();
      if (pack) {
        setSoundPack(pack);
        setIsDirty(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sound pack");
    } finally {
      setIsLoading(false);
    }
  }, [adapter]);

  const importPack = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const pack = await adapter.importSoundPack();
      if (pack) {
        setSoundPack(pack);
        setIsDirty(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import sound pack");
    } finally {
      setIsLoading(false);
    }
  }, [adapter]);

  const exportPack = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await adapter.exportSoundPack(soundPack);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export sound pack");
    } finally {
      setIsLoading(false);
    }
  }, [adapter, soundPack]);

  // ==========================================================================
  // Settings operations
  // ==========================================================================

  const setMasterVolume = useCallback((volume: number) => {
    setSoundPack((prev) => ({
      ...prev,
      settings: { ...prev.settings, masterVolume: volume },
    }));
    setIsDirty(true);
  }, []);

  const setNormalization = useCallback((enabled: boolean) => {
    setSoundPack((prev) => ({
      ...prev,
      settings: { ...prev.settings, normalization: enabled },
    }));
    setIsDirty(true);
  }, []);

  // ==========================================================================
  // Default sounds operations
  // ==========================================================================

  const setDefaultPool = useCallback((eventType: EventType, pool: SoundPool) => {
    setSoundPack((prev) => ({
      ...prev,
      defaults: { ...prev.defaults, [eventType]: pool },
    }));
    setIsDirty(true);
  }, []);

  const addDefaultSound = useCallback((eventType: EventType, entry: Omit<SoundEntry, "id">) => {
    setSoundPack((prev) => {
      const existingPool = prev.defaults[eventType] ?? createEmptySoundPool();
      return {
        ...prev,
        defaults: {
          ...prev.defaults,
          [eventType]: {
            ...existingPool,
            sounds: [...existingPool.sounds, { ...entry, id: generateId() }],
          },
        },
      };
    });
    setIsDirty(true);
  }, []);

  const updateDefaultSound = useCallback((eventType: EventType, soundId: string, updates: Partial<SoundEntry>) => {
    setSoundPack((prev) => {
      const existingPool = prev.defaults[eventType];
      if (!existingPool) {
        return prev;
      }
      return {
        ...prev,
        defaults: {
          ...prev.defaults,
          [eventType]: {
            ...existingPool,
            sounds: existingPool.sounds.map((s) => (s.id === soundId ? { ...s, ...updates } : s)),
          },
        },
      };
    });
    setIsDirty(true);
  }, []);

  const removeDefaultSound = useCallback((eventType: EventType, soundId: string) => {
    setSoundPack((prev) => {
      const existingPool = prev.defaults[eventType];
      if (!existingPool) {
        return prev;
      }
      return {
        ...prev,
        defaults: {
          ...prev.defaults,
          [eventType]: {
            ...existingPool,
            sounds: existingPool.sounds.filter((s) => s.id !== soundId),
          },
        },
      };
    });
    setIsDirty(true);
  }, []);

  // ==========================================================================
  // Rule operations
  // ==========================================================================

  const addRule = useCallback((rule?: Partial<SoundRule>) => {
    const newRule = createEmptyRule(generateId(), rule?.name ?? "New Rule");
    setSoundPack((prev) => ({
      ...prev,
      rules: [...prev.rules, { ...newRule, ...rule }],
    }));
    setIsDirty(true);
  }, []);

  const updateRule = useCallback((ruleId: string, updates: Partial<SoundRule>) => {
    setSoundPack((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r)),
    }));
    setIsDirty(true);
  }, []);

  const removeRule = useCallback((ruleId: string) => {
    setSoundPack((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== ruleId),
    }));
    setIsDirty(true);
  }, []);

  const reorderRules = useCallback((fromIndex: number, toIndex: number) => {
    setSoundPack((prev) => {
      const rules = [...prev.rules];
      const [removed] = rules.splice(fromIndex, 1);
      if (removed) {
        rules.splice(toIndex, 0, removed);
      }
      return { ...prev, rules };
    });
    setIsDirty(true);
  }, []);

  // ==========================================================================
  // Rule sound operations
  // ==========================================================================

  const addRuleSound = useCallback((ruleId: string, entry: Omit<SoundEntry, "id">) => {
    setSoundPack((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === ruleId
          ? {
              ...r,
              sounds: {
                ...r.sounds,
                sounds: [...r.sounds.sounds, { ...entry, id: generateId() }],
              },
            }
          : r,
      ),
    }));
    setIsDirty(true);
  }, []);

  const updateRuleSound = useCallback((ruleId: string, soundId: string, updates: Partial<SoundEntry>) => {
    setSoundPack((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === ruleId
          ? {
              ...r,
              sounds: {
                ...r.sounds,
                sounds: r.sounds.sounds.map((s) => (s.id === soundId ? { ...s, ...updates } : s)),
              },
            }
          : r,
      ),
    }));
    setIsDirty(true);
  }, []);

  const removeRuleSound = useCallback((ruleId: string, soundId: string) => {
    setSoundPack((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === ruleId
          ? {
              ...r,
              sounds: {
                ...r.sounds,
                sounds: r.sounds.sounds.filter((s) => s.id !== soundId),
              },
            }
          : r,
      ),
    }));
    setIsDirty(true);
  }, []);

  // ==========================================================================
  // Preview operations
  // ==========================================================================

  const previewSound = useCallback(
    async (source: { type: "file"; path: string } | { type: "url"; url: string }) => {
      try {
        await adapter.playSound(source);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to preview sound");
      }
    },
    [adapter],
  );

  const stopPreview = useCallback(() => {
    adapter.stopSound();
  }, [adapter]);

  // ==========================================================================
  // Utility
  // ==========================================================================

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ==========================================================================
  // Context value
  // ==========================================================================

  const value: SoundPackEditorContextValue = {
    // State
    soundPack,
    isDirty,
    isLoading,
    error,
    champions,
    localPlayer,
    adapter,
    // Pack operations
    updatePack,
    resetPack,
    savePack,
    loadPack,
    importPack,
    exportPack,
    // Settings operations
    setMasterVolume,
    setNormalization,
    // Default sounds operations
    setDefaultPool,
    addDefaultSound,
    updateDefaultSound,
    removeDefaultSound,
    // Rule operations
    addRule,
    updateRule,
    removeRule,
    reorderRules,
    // Rule sound operations
    addRuleSound,
    updateRuleSound,
    removeRuleSound,
    // Preview operations
    previewSound,
    stopPreview,
    // Utility
    clearError,
  };

  return <SoundPackEditorContext.Provider value={value}>{children}</SoundPackEditorContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access the sound pack editor context
 * Must be used within a SoundPackEditorProvider
 */
export function useSoundPackEditor(): SoundPackEditorContextValue {
  const context = useContext(SoundPackEditorContext);
  if (!context) {
    throw new Error("useSoundPackEditor must be used within a SoundPackEditorProvider");
  }
  return context;
}

/**
 * Rule and rule sound operations for the sound pack editor
 */
import { useCallback } from "react";
import type { SoundPack, SoundRule, SoundEntry } from "@scout-for-lol/data";
import { createEmptyRule, generateId } from "@scout-for-lol/data";

type SetSoundPack = (updater: (prev: SoundPack) => SoundPack) => void;
type SetIsDirty = (dirty: boolean) => void;

export function useRuleOperations(
  setSoundPack: SetSoundPack,
  setIsDirty: SetIsDirty,
) {
  const addRule = useCallback(
    (rule?: Partial<SoundRule>) => {
      const newRule = createEmptyRule(generateId(), rule?.name ?? "New Rule");
      setSoundPack((prev) => ({
        ...prev,
        rules: [...prev.rules, { ...newRule, ...rule }],
      }));
      setIsDirty(true);
    },
    [setSoundPack, setIsDirty],
  );

  const updateRule = useCallback(
    (ruleId: string, updates: Partial<SoundRule>) => {
      setSoundPack((prev) => ({
        ...prev,
        rules: prev.rules.map((r) =>
          r.id === ruleId ? { ...r, ...updates } : r,
        ),
      }));
      setIsDirty(true);
    },
    [setSoundPack, setIsDirty],
  );

  const removeRule = useCallback(
    (ruleId: string) => {
      setSoundPack((prev) => ({
        ...prev,
        rules: prev.rules.filter((r) => r.id !== ruleId),
      }));
      setIsDirty(true);
    },
    [setSoundPack, setIsDirty],
  );

  const reorderRules = useCallback(
    (fromIndex: number, toIndex: number) => {
      setSoundPack((prev) => {
        const rules = [...prev.rules];
        const [removed] = rules.splice(fromIndex, 1);
        if (removed) {
          rules.splice(toIndex, 0, removed);
        }
        return { ...prev, rules };
      });
      setIsDirty(true);
    },
    [setSoundPack, setIsDirty],
  );

  const addRuleSound = useCallback(
    (ruleId: string, entry: Omit<SoundEntry, "id">) => {
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
    },
    [setSoundPack, setIsDirty],
  );

  const updateRuleSound = useCallback(
    (ruleId: string, soundId: string, updates: Partial<SoundEntry>) => {
      setSoundPack((prev) => ({
        ...prev,
        rules: prev.rules.map((r) =>
          r.id === ruleId
            ? {
                ...r,
                sounds: {
                  ...r.sounds,
                  sounds: r.sounds.sounds.map((s) =>
                    s.id === soundId ? { ...s, ...updates } : s,
                  ),
                },
              }
            : r,
        ),
      }));
      setIsDirty(true);
    },
    [setSoundPack, setIsDirty],
  );

  const removeRuleSound = useCallback(
    (ruleId: string, soundId: string) => {
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
    },
    [setSoundPack, setIsDirty],
  );

  return {
    addRule,
    updateRule,
    removeRule,
    reorderRules,
    addRuleSound,
    updateRuleSound,
    removeRuleSound,
  };
}

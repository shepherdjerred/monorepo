import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import type { ExperienceLevel } from "@clauderon/shared";

interface UserPreferences {
  experience_level: ExperienceLevel;
  sessions_created_count: number;
  sessions_attached_count: number;
  advanced_operations_used_count: number;
  first_session_at: string | null;
  last_activity_at: string;
  dismissed_hints: string[];
  created_at: string;
  updated_at: string;
}

type PreferencesContextValue = {
  preferences: UserPreferences | null;
  isLoading: boolean;
  experienceLevel: ExperienceLevel;
  shouldShowFirstRun: boolean;
  trackOperation: (operation: "session_created" | "session_attached" | "advanced_operation") => void;
  dismissHint: (hintId: string) => void;
  completeFirstRun: () => void;
  isHintDismissed: (hintId: string) => boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

const STORAGE_KEY = "clauderon:preferences";

function createDefaultPreferences(): UserPreferences {
  const now = new Date().toISOString();
  return {
    experience_level: "FirstTime",
    sessions_created_count: 0,
    sessions_attached_count: 0,
    advanced_operations_used_count: 0,
    first_session_at: null,
    last_activity_at: now,
    dismissed_hints: [],
    created_at: now,
    updated_at: now,
  };
}

function calculateExperienceLevel(prefs: UserPreferences): ExperienceLevel {
  const daysSinceFirst = prefs.first_session_at
    ? Math.floor(
        (Date.now() - new Date(prefs.first_session_at).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 0;

  // Advanced: 10+ sessions OR 30+ days OR 3+ advanced operations
  if (
    prefs.sessions_created_count >= 10 ||
    daysSinceFirst >= 30 ||
    prefs.advanced_operations_used_count >= 3
  ) {
    return "Advanced";
  }

  // Regular: 3+ sessions OR 7+ days
  if (prefs.sessions_created_count >= 3 || daysSinceFirst >= 7) {
    return "Regular";
  }

  return "FirstTime";
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const prefs = JSON.parse(stored) as UserPreferences;
        // Recalculate experience level on load
        prefs.experience_level = calculateExperienceLevel(prefs);
        prefs.updated_at = new Date().toISOString();
        setPreferences(prefs);
        // Save updated experience level
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } else {
        // Create default preferences
        const defaultPrefs = createDefaultPreferences();
        setPreferences(defaultPrefs);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultPrefs));
      }
    } catch (err) {
      console.error("Failed to load preferences from localStorage:", err);
      const defaultPrefs = createDefaultPreferences();
      setPreferences(defaultPrefs);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save preferences to localStorage
  const savePreferences = useCallback((prefs: UserPreferences) => {
    try {
      prefs.updated_at = new Date().toISOString();
      prefs.experience_level = calculateExperienceLevel(prefs);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      setPreferences({ ...prefs });
    } catch (err) {
      console.error("Failed to save preferences to localStorage:", err);
    }
  }, []);

  // Track operation
  const trackOperation = useCallback(
    (operation: "session_created" | "session_attached" | "advanced_operation") => {
      if (!preferences) return;

      const updated = { ...preferences };
      const now = new Date().toISOString();

      switch (operation) {
        case "session_created":
          updated.sessions_created_count += 1;
          if (!updated.first_session_at) {
            updated.first_session_at = now;
          }
          break;
        case "session_attached":
          updated.sessions_attached_count += 1;
          break;
        case "advanced_operation":
          updated.advanced_operations_used_count += 1;
          break;
      }

      updated.last_activity_at = now;
      savePreferences(updated);
    },
    [preferences, savePreferences]
  );

  // Dismiss hint
  const dismissHint = useCallback(
    (hintId: string) => {
      if (!preferences) return;

      const updated = { ...preferences };
      if (!updated.dismissed_hints.includes(hintId)) {
        updated.dismissed_hints = [...updated.dismissed_hints, hintId];
        savePreferences(updated);
      }
    },
    [preferences, savePreferences]
  );

  // Complete first run
  const completeFirstRun = useCallback(() => {
    if (!preferences) return;

    const updated = { ...preferences };
    if (!updated.dismissed_hints.includes("first-run-complete")) {
      updated.dismissed_hints = [
        ...updated.dismissed_hints,
        "first-run-complete",
      ];
      savePreferences(updated);
    }
  }, [preferences, savePreferences]);

  // Check if hint is dismissed
  const isHintDismissed = useCallback(
    (hintId: string) => {
      return preferences?.dismissed_hints?.includes(hintId) ?? false;
    },
    [preferences]
  );

  // Derived values
  const experienceLevel = useMemo(
    () => preferences?.experience_level ?? "FirstTime",
    [preferences]
  );

  const shouldShowFirstRun = useMemo(
    () =>
      preferences?.sessions_created_count === 0 &&
      !preferences?.dismissed_hints?.includes("first-run-complete"),
    [preferences]
  );

  const value = useMemo(
    () => ({
      preferences,
      isLoading,
      experienceLevel,
      shouldShowFirstRun,
      trackOperation,
      dismissHint,
      completeFirstRun,
      isHintDismissed,
    }),
    [
      preferences,
      isLoading,
      experienceLevel,
      shouldShowFirstRun,
      trackOperation,
      dismissHint,
      completeFirstRun,
      isHintDismissed,
    ]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}

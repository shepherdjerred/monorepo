import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { UserPreferences, ExperienceLevel } from "../types/generated";

interface PreferencesContextValue {
  preferences: UserPreferences | null;
  experienceLevel: ExperienceLevel;
  shouldShowFirstRun: boolean;
  isLoading: boolean;
  trackOperation: (
    operation: "session_created" | "session_attached" | "advanced_operation"
  ) => Promise<void>;
  dismissHint: (hintId: string) => Promise<void>;
  completeFirstRun: () => Promise<void>;
  isHintDismissed: (hintId: string) => boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined
);

const PREFERENCES_STORAGE_KEY = "@clauderon:preferences";

function createDefaultPreferences(): UserPreferences {
  const now = new Date().toISOString();
  return {
    user_id: "local-user",
    experience_level: "FirstTime",
    sessions_created_count: 0,
    sessions_attached_count: 0,
    advanced_operations_used_count: 0,
    first_session_at: null,
    last_activity_at: now,
    dismissed_hints: [],
    ui_preferences: {},
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

interface PreferencesProviderProps {
  children: ReactNode;
}

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load preferences from AsyncStorage on mount
  const loadPreferences = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (stored) {
        const prefs = JSON.parse(stored) as UserPreferences;
        // Recalculate experience level on load
        prefs.experience_level = calculateExperienceLevel(prefs);
        prefs.updated_at = new Date().toISOString();
        setPreferences(prefs);
        // Save updated experience level
        await AsyncStorage.setItem(
          PREFERENCES_STORAGE_KEY,
          JSON.stringify(prefs)
        );
      } else {
        // Create default preferences
        const defaultPrefs = createDefaultPreferences();
        setPreferences(defaultPrefs);
        await AsyncStorage.setItem(
          PREFERENCES_STORAGE_KEY,
          JSON.stringify(defaultPrefs)
        );
      }
    } catch (err) {
      console.error("Failed to load preferences from AsyncStorage:", err);
      const defaultPrefs = createDefaultPreferences();
      setPreferences(defaultPrefs);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  // Save preferences to AsyncStorage
  const savePreferences = useCallback(async (prefs: UserPreferences) => {
    try {
      prefs.updated_at = new Date().toISOString();
      prefs.experience_level = calculateExperienceLevel(prefs);
      await AsyncStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify(prefs)
      );
      setPreferences({ ...prefs });
    } catch (err) {
      console.error("Failed to save preferences to AsyncStorage:", err);
    }
  }, []);

  // Track operation
  const trackOperation = useCallback(
    async (
      operation: "session_created" | "session_attached" | "advanced_operation"
    ) => {
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
      await savePreferences(updated);
    },
    [preferences, savePreferences]
  );

  // Dismiss hint
  const dismissHint = useCallback(
    async (hintId: string) => {
      if (!preferences) return;

      const updated = { ...preferences };
      if (!updated.dismissed_hints.includes(hintId)) {
        updated.dismissed_hints = [...updated.dismissed_hints, hintId];
        await savePreferences(updated);
      }
    },
    [preferences, savePreferences]
  );

  // Complete first run
  const completeFirstRun = useCallback(async () => {
    if (!preferences) return;

    const updated = { ...preferences };
    if (!updated.dismissed_hints.includes("first-run-complete")) {
      updated.dismissed_hints = [
        ...updated.dismissed_hints,
        "first-run-complete",
      ];
      await savePreferences(updated);
    }
  }, [preferences, savePreferences]);

  // Check if hint is dismissed
  const isHintDismissed = useCallback(
    (hintId: string): boolean => {
      return preferences?.dismissed_hints.includes(hintId) ?? false;
    },
    [preferences]
  );

  // Compute derived values
  const experienceLevel = useMemo<ExperienceLevel>(
    () => preferences?.experience_level ?? "FirstTime",
    [preferences]
  );

  const shouldShowFirstRun = useMemo(
    () =>
      (preferences?.sessions_created_count ?? 0) === 0 &&
      !isHintDismissed("first-run-complete"),
    [preferences, isHintDismissed]
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      experienceLevel,
      shouldShowFirstRun,
      isLoading,
      trackOperation,
      dismissHint,
      completeFirstRun,
      isHintDismissed,
    }),
    [
      preferences,
      experienceLevel,
      shouldShowFirstRun,
      isLoading,
      trackOperation,
      dismissHint,
      completeFirstRun,
      isHintDismissed,
    ]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error(
      "usePreferences must be used within a PreferencesProvider"
    );
  }
  return context;
}

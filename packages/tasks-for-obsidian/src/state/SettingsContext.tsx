import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance, useColorScheme } from "react-native";

import { type Colors, colors as lightColors } from "../styles/colors";
import { darkColors } from "../styles/dark-colors";
import { setFeedbackGlobalEnabled } from "../lib/feedback";
import {
  getAuthToken,
  setAuthToken as setSecureAuthToken,
} from "../lib/secure-storage";
import {
  appearanceOverride,
  type AppearancePreference,
  AppearancePreferenceSchema,
  loadAppearancePreference,
  resolveAppearance,
  serializeAppearancePreference,
} from "../styles/appearance";

const STORAGE_KEYS = {
  apiUrl: "@tasknotes/api-url",
  appearance: "@tasknotes/appearance-v1",
  legacyDarkMode: "@tasknotes/dark-mode",
  feedbackEnabled: "@tasknotes/feedback-enabled",
} as const;

type SettingsContextValue = {
  apiUrl: string;
  setApiUrl: (url: string) => Promise<void>;
  authToken: string;
  setAuthToken: (token: string) => Promise<void>;
  appearance: AppearancePreference;
  setAppearance: (appearance: AppearancePreference) => Promise<void>;
  isDarkMode: boolean;
  setIsDarkMode: (dark: boolean) => Promise<void>;
  feedbackEnabled: boolean;
  setFeedbackEnabled: (enabled: boolean) => Promise<void>;
  colors: Colors;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const systemAppearance = useColorScheme();
  const [apiUrl, setApiUrlState] = useState(
    "https://tasknotes.tailnet-1a49.ts.net",
  );
  const [authToken, setAuthTokenState] = useState("");
  const [appearance, setAppearanceState] =
    useState<AppearancePreference>("system");
  const [feedbackEnabled, setFeedbackEnabledState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const [
        savedUrl,
        savedToken,
        savedAppearance,
        legacyDarkMode,
        savedFeedback,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.apiUrl),
        getAuthToken(),
        AsyncStorage.getItem(STORAGE_KEYS.appearance),
        AsyncStorage.getItem(STORAGE_KEYS.legacyDarkMode),
        AsyncStorage.getItem(STORAGE_KEYS.feedbackEnabled),
      ]);
      const loadedAppearance = loadAppearancePreference(
        savedAppearance,
        legacyDarkMode,
      );

      if (savedUrl) setApiUrlState(savedUrl);
      if (savedToken) setAuthTokenState(savedToken);
      setAppearanceState(loadedAppearance.appearance);
      Appearance.setColorScheme(
        appearanceOverride(loadedAppearance.appearance),
      );
      if (loadedAppearance.needsMigration) {
        await Promise.all([
          AsyncStorage.setItem(
            STORAGE_KEYS.appearance,
            serializeAppearancePreference(loadedAppearance.appearance),
          ),
          AsyncStorage.removeItem(STORAGE_KEYS.legacyDarkMode),
        ]);
      }
      if (savedFeedback !== null) {
        const enabled = savedFeedback !== "false";
        setFeedbackEnabledState(enabled);
        setFeedbackGlobalEnabled(enabled);
      }
      setLoaded(true);
    }
    void load();
  }, []);

  const setApiUrl = useCallback(async (url: string) => {
    setApiUrlState(url);
    await AsyncStorage.setItem(STORAGE_KEYS.apiUrl, url);
  }, []);

  const setAuthToken = useCallback(async (token: string) => {
    setAuthTokenState(token);
    await setSecureAuthToken(token);
  }, []);

  const setAppearance = useCallback(async (next: AppearancePreference) => {
    const parsed = AppearancePreferenceSchema.parse(next);
    setAppearanceState(parsed);
    Appearance.setColorScheme(appearanceOverride(parsed));
    await AsyncStorage.setItem(
      STORAGE_KEYS.appearance,
      serializeAppearancePreference(parsed),
    );
  }, []);

  const setIsDarkMode = useCallback(
    (dark: boolean) => setAppearance(dark ? "dark" : "light"),
    [setAppearance],
  );

  const setFeedbackEnabled = useCallback(async (enabled: boolean) => {
    setFeedbackEnabledState(enabled);
    setFeedbackGlobalEnabled(enabled);
    await AsyncStorage.setItem(STORAGE_KEYS.feedbackEnabled, String(enabled));
  }, []);

  const isDarkMode = resolveAppearance(appearance, systemAppearance) === "dark";

  const theColors = useMemo(
    () => (isDarkMode ? darkColors : lightColors),
    [isDarkMode],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      apiUrl,
      setApiUrl,
      authToken,
      setAuthToken,
      appearance,
      setAppearance,
      isDarkMode,
      setIsDarkMode,
      feedbackEnabled,
      setFeedbackEnabled,
      colors: theColors,
    }),
    [
      apiUrl,
      setApiUrl,
      authToken,
      setAuthToken,
      appearance,
      setAppearance,
      isDarkMode,
      setIsDarkMode,
      feedbackEnabled,
      setFeedbackEnabled,
      theColors,
    ],
  );

  if (!loaded) return null;

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context)
    throw new Error("useSettingsContext must be used within SettingsProvider");
  return context;
}

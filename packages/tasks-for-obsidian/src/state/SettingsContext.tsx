import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { type Colors, colors as lightColors } from "../styles/colors";
import { darkColors } from "../styles/darkColors";
import { setFeedbackGlobalEnabled } from "../lib/feedback";

const STORAGE_KEYS = {
  apiUrl: "@tasknotes/api-url",
  authToken: "@tasknotes/auth-token",
  isDarkMode: "@tasknotes/dark-mode",
  feedbackEnabled: "@tasknotes/feedback-enabled",
} as const;

type SettingsContextValue = {
  apiUrl: string;
  setApiUrl: (url: string) => Promise<void>;
  authToken: string;
  setAuthToken: (token: string) => Promise<void>;
  isDarkMode: boolean;
  setIsDarkMode: (dark: boolean) => Promise<void>;
  feedbackEnabled: boolean;
  setFeedbackEnabled: (enabled: boolean) => Promise<void>;
  colors: Colors;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [apiUrl, setApiUrlState] = useState("http://macbook.tailnet-1a49.ts.net:8080");
  const [authToken, setAuthTokenState] = useState("");
  const [isDarkMode, setIsDarkModeState] = useState(false);
  const [feedbackEnabled, setFeedbackEnabledState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const [savedUrl, savedToken, savedDark, savedFeedback] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.apiUrl),
        AsyncStorage.getItem(STORAGE_KEYS.authToken),
        AsyncStorage.getItem(STORAGE_KEYS.isDarkMode),
        AsyncStorage.getItem(STORAGE_KEYS.feedbackEnabled),
      ]);
      if (savedUrl) setApiUrlState(savedUrl);
      if (savedToken) setAuthTokenState(savedToken);
      if (savedDark !== null) setIsDarkModeState(savedDark === "true");
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
    await AsyncStorage.setItem(STORAGE_KEYS.authToken, token);
  }, []);

  const setIsDarkMode = useCallback(async (dark: boolean) => {
    setIsDarkModeState(dark);
    await AsyncStorage.setItem(STORAGE_KEYS.isDarkMode, String(dark));
  }, []);

  const setFeedbackEnabled = useCallback(async (enabled: boolean) => {
    setFeedbackEnabledState(enabled);
    setFeedbackGlobalEnabled(enabled);
    await AsyncStorage.setItem(STORAGE_KEYS.feedbackEnabled, String(enabled));
  }, []);

  const theColors = useMemo(() => (isDarkMode ? darkColors : lightColors), [isDarkMode]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      apiUrl,
      setApiUrl,
      authToken,
      setAuthToken,
      isDarkMode,
      setIsDarkMode,
      feedbackEnabled,
      setFeedbackEnabled,
      colors: theColors,
    }),
    [apiUrl, setApiUrl, authToken, setAuthToken, isDarkMode, setIsDarkMode, feedbackEnabled, setFeedbackEnabled, theColors],
  );

  if (!loaded) return null;

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettingsContext must be used within SettingsProvider");
  return context;
}

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { useColorScheme } from "react-native";
import { storage } from "../lib/storage";
import { colors as lightColors } from "../styles/colors";
import { darkColors } from "../styles/darkColors";

const THEME_STORAGE_KEY = "clauderon_theme";

export type ThemeMode = "light" | "dark" | "system";

export type ThemeColors = typeof lightColors;

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved theme preference
  useEffect(() => {
    const loadTheme = async () => {
      const saved = await storage.get<ThemeMode>(THEME_STORAGE_KEY);
      if (saved && (saved === "light" || saved === "dark" || saved === "system")) {
        setModeState(saved);
      }
      setIsLoaded(true);
    };
    void loadTheme();
  }, []);

  const setMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    await storage.set(THEME_STORAGE_KEY, newMode);
  }, []);

  const isDark = useMemo(() => {
    if (mode === "system") {
      return systemColorScheme === "dark";
    }
    return mode === "dark";
  }, [mode, systemColorScheme]);

  const colors = useMemo(() => {
    return isDark ? darkColors : lightColors;
  }, [isDark]);

  const value: ThemeContextValue = useMemo(
    () => ({
      mode,
      isDark,
      colors,
      setMode,
    }),
    [mode, isDark, colors, setMode],
  );

  // Don't render until theme is loaded to prevent flash
  if (!isLoaded) {
    return null;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

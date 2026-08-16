import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyScoutTheme,
  DEFAULT_SCOUT_THEME_PREFERENCE,
  readScoutThemePreferenceOrDefault,
  resolveScoutMode,
  SCOUT_THEME_STORAGE_KEY,
  ScoutThemePreferenceV1Schema,
  writeScoutThemePreference,
  type ScoutModePreference,
  type ScoutResolvedMode,
  type ScoutSkin,
  type ScoutThemePreferenceV1,
} from "./theme.ts";

export type ScoutThemeSurface = "marketing" | "docs" | "app" | "workbench";
export type ScoutThemeChangedPayload = {
  skin: ScoutSkin;
  mode_preference: ScoutModePreference;
  resolved_mode: ScoutResolvedMode;
  surface: ScoutThemeSurface;
};

type ScoutThemeContextValue = {
  preference: ScoutThemePreferenceV1;
  resolvedMode: ScoutResolvedMode;
  setSkin: (skin: ScoutSkin) => void;
  setMode: (mode: ScoutModePreference) => void;
};

const ScoutThemeContext = createContext<ScoutThemeContextValue | null>(null);

export function systemColorSchemeMediaQuery(
  matchMedia: typeof globalThis.matchMedia | undefined,
): MediaQueryList | null {
  if (typeof matchMedia !== "function") return null;
  return matchMedia("(prefers-color-scheme: dark)");
}

function systemPrefersDark(): boolean {
  return systemColorSchemeMediaQuery(globalThis.matchMedia)?.matches ?? false;
}

function initialPreference(): ScoutThemePreferenceV1 {
  if (typeof document === "undefined") {
    return DEFAULT_SCOUT_THEME_PREFERENCE;
  }
  try {
    return readScoutThemePreferenceOrDefault(globalThis.localStorage);
  } catch {
    return DEFAULT_SCOUT_THEME_PREFERENCE;
  }
}

export function ScoutThemeProvider(props: {
  children: ReactNode;
  surface: ScoutThemeSurface;
  onThemeChanged?: (payload: ScoutThemeChangedPayload) => void;
}) {
  const { onThemeChanged, surface } = props;
  const [preference, setPreference] =
    useState<ScoutThemePreferenceV1>(initialPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolvedMode = resolveScoutMode(preference.mode, systemDark);

  useEffect(() => {
    const media = systemColorSchemeMediaQuery(globalThis.matchMedia);
    if (media === null) return;
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    applyScoutTheme(document.documentElement, preference, systemDark);
  }, [preference, systemDark]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== SCOUT_THEME_STORAGE_KEY || event.newValue === null) {
        return;
      }
      try {
        const parsed = ScoutThemePreferenceV1Schema.safeParse(
          JSON.parse(event.newValue),
        );
        if (parsed.success) {
          setPreference(parsed.data);
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throw error;
        }
      }
    };
    globalThis.addEventListener("storage", onStorage);
    return () => {
      globalThis.removeEventListener("storage", onStorage);
    };
  }, []);

  const commit = useCallback(
    (next: ScoutThemePreferenceV1): void => {
      setPreference(next);
      try {
        writeScoutThemePreference(globalThis.localStorage, next);
      } catch {
        // Browser storage is an optional boundary; the in-memory theme remains usable.
      }
      onThemeChanged?.({
        skin: next.skin,
        mode_preference: next.mode,
        resolved_mode: resolveScoutMode(next.mode, systemDark),
        surface,
      });
    },
    [onThemeChanged, surface, systemDark],
  );

  const value = useMemo<ScoutThemeContextValue>(
    () => ({
      preference,
      resolvedMode,
      setSkin: (skin) => {
        commit({ ...preference, skin });
      },
      setMode: (mode) => {
        commit({ ...preference, mode });
      },
    }),
    [commit, preference, resolvedMode],
  );

  return (
    <ScoutThemeContext.Provider value={value}>
      {props.children}
    </ScoutThemeContext.Provider>
  );
}

export function useScoutTheme(): ScoutThemeContextValue {
  const value = useContext(ScoutThemeContext);
  if (value === null) {
    throw new Error("useScoutTheme must be used inside ScoutThemeProvider");
  }
  return value;
}

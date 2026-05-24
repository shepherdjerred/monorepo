import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const STORAGE_KEY = "scout-app-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  // SPA — always browser context. No SSR guard needed.
  const raw = globalThis.window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function systemPrefersDark(): boolean {
  return globalThis.window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = globalThis.document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider(props: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredPreference(),
  );
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    systemPrefersDark(),
  );

  useEffect(() => {
    const media = globalThis.window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  const resolved: ResolvedTheme =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: (next) => {
        globalThis.window.localStorage.setItem(STORAGE_KEY, next);
        setPreferenceState(next);
      },
    }),
    [preference, resolved],
  );

  return (
    <ThemeContext.Provider value={value}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}

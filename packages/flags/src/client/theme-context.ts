import { createContext, use } from "react";
import type { ResolvedTheme, ThemeStore } from "@shepherdjerred/console-ui";

/** The page's theme store, for components such as Monaco that theme themselves. */
export const ThemeContext = createContext<ThemeStore | undefined>(undefined);

/** The theme on screen; the page must render inside a `ThemeContext`. */
export function useResolvedTheme(): ResolvedTheme {
  const store = use(ThemeContext);
  if (store === undefined) throw new Error("ThemeContext is not provided");
  return store.useResolvedTheme();
}

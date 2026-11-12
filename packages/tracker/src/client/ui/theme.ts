import { z } from "zod";

export const ThemeSchema = z.enum(["system", "light", "dark"]);
export type Theme = z.infer<typeof ThemeSchema>;
// The page background of each scheme; the browser tints its chrome with it.
const themeColors = { light: "#ffffff", dark: "#1b1b1f" };

export function savedTheme(): Theme {
  const saved = ThemeSchema.safeParse(localStorage.getItem("tracker.theme"));
  return saved.success ? saved.data : "system";
}

/**
 * The only writer of the saved theme. `index.html` reads the same key before
 * first paint so an explicit choice never flashes the other scheme.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset["theme"] = theme;
  localStorage.setItem("tracker.theme", theme);
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = themeColors[theme === "system" ? scheme : theme];
  }
}

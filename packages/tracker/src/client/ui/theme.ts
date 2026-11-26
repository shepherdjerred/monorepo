import { createThemeStore, tokens } from "@shepherdjerred/console-ui";

/**
 * Tracker's theme preference, persisted under `tracker.theme` beside its
 * other `tracker.*` keys and reflected as `html[data-theme]`. `index.html`
 * reads the same key before first paint so an explicit choice never flashes
 * the other scheme.
 */
export const trackerTheme = createThemeStore("tracker.theme");

/** The browser tints its chrome with the sidebar surface of the shown theme. */
function tintBrowserChrome() {
  const preference = trackerTheme.getPreference();
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = tokens[preference === "system" ? scheme : preference].bg;
  }
}
trackerTheme.subscribe(tintBrowserChrome);

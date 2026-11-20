import { setThemePreference, useThemePreference } from "#client/theme.ts";
import { PromotionContent } from "./page.tsx";

/**
 * The promotion report for the standalone local launcher, which serves this
 * one page without the Hub shell: a minimal bar with the brand and the theme
 * switch, then the same content Hub shows at `/promotion`.
 */
export function StandalonePromotion() {
  const theme = useThemePreference();
  return (
    <>
      <header className="p-topbar">
        <a className="brand" href="/">
          Hub
        </a>
        <button
          className="p-theme"
          onClick={() => {
            setThemePreference(theme === "dark" ? "light" : "dark");
          }}
        >
          Theme: {theme}
        </button>
      </header>
      <div className="app-content">
        <PromotionContent />
      </div>
    </>
  );
}

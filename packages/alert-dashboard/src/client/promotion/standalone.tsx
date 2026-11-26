import { ThemeRow } from "@shepherdjerred/console-ui";
import { themeStore } from "#client/theme.ts";
import { PromotionContent } from "./page.tsx";

/**
 * The promotion report for the standalone local launcher, which serves this
 * one page without the Hub shell: one panel with a minimal bar (the brand and
 * the console's theme switch), then the same content Hub shows at
 * `/promotion`.
 */
export function StandalonePromotion() {
  return (
    <div className="ui-panel p-standalone">
      <header className="p-topbar">
        <a className="brand" href="/">
          Hub
        </a>
        <ThemeRow store={themeStore} />
      </header>
      <div className="app-content">
        <PromotionContent />
      </div>
    </div>
  );
}

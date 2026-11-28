import { THEME_ICON } from "@shepherdjerred/console-ui/icons.ts";
import {
  nextThemePreference,
  type ThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui/theme.ts";

export type ThemeRowProps = {
  readonly store: ThemeStore;
};

/** The sidebar's bottom row: cycles the theme through system → light → dark. */
export function ThemeRow({ store }: ThemeRowProps): React.JSX.Element {
  const preference: ThemePreference = store.useThemePreference();
  const Icon = THEME_ICON[preference];
  return (
    <button
      type="button"
      className="ui-nav-item ui-theme-row"
      aria-label={`Theme: ${preference}`}
      onClick={() => {
        store.setThemePreference(nextThemePreference(preference));
      }}
    >
      <Icon className="ui-nav-icon" aria-hidden="true" />
      {/* The space keeps the visible words apart, so the accessible name
          contains the visible text (WCAG 2.5.3, axe label-content-name-mismatch). */}
      <span className="ui-nav-text">Theme</span>{" "}
      <span className="ui-nav-count">{preference}</span>
    </button>
  );
}

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  nextThemePreference,
  type ThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui/theme.ts";

const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

export type ThemeRowProps = {
  readonly store: ThemeStore;
};

/** The sidebar's bottom row: cycles the theme through system → light → dark. */
export function ThemeRow({ store }: ThemeRowProps): React.JSX.Element {
  const preference: ThemePreference = store.useThemePreference();
  const Icon = ICON[preference];
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
      <span className="ui-nav-text">Theme</span>
      <span className="ui-nav-count">{preference}</span>
    </button>
  );
}

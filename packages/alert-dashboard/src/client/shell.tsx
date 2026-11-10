import { MonitorIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { Changes } from "./changes.tsx";
import type { ResolvedNavItem } from "./platform/module.ts";
import { CommandPalette, setPaletteOpen } from "./platform/palette.tsx";
import {
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from "./theme.ts";

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

function ThemeToggle(): React.JSX.Element {
  const preference = useThemePreference();
  const Icon = THEME_ICON[preference];
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`Theme: ${preference}. Switch to ${NEXT_THEME[preference]}.`}
      title={`Theme: ${preference}`}
      onClick={() => {
        setThemePreference(NEXT_THEME[preference]);
      }}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

export function Shell({
  nav,
}: {
  readonly nav: readonly ResolvedNavItem[];
}): React.JSX.Element {
  return (
    <>
      <Changes />
      <CommandPalette />
      <header className="app-header">
        <NavLink className="brand" to="/" end>
          Hub
        </NavLink>
        <nav aria-label="Primary navigation">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              <item.icon aria-hidden="true" /> {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="palette-trigger"
          type="button"
          aria-label="Search and commands"
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => {
            setPaletteOpen(true);
          }}
        >
          <SearchIcon aria-hidden="true" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <ThemeToggle />
      </header>
      <Outlet />
    </>
  );
}

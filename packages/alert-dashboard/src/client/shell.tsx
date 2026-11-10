import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { Changes } from "./changes.tsx";
import type { ResolvedNavItem } from "./platform/module.ts";
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
      <header className="app-header">
        <NavLink className="brand" to="/" end>
          Ops
        </NavLink>
        <nav aria-label="Primary navigation">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              <item.icon aria-hidden="true" /> {item.label}
            </NavLink>
          ))}
        </nav>
        <ThemeToggle />
      </header>
      <Outlet />
    </>
  );
}

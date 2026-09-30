import {
  ActivityIcon,
  BotIcon,
  BoxesIcon,
  CalendarRangeIcon,
  GaugeIcon,
  GitPullRequestIcon,
  HistoryIcon,
  MonitorIcon,
  MoonIcon,
  ServerCogIcon,
  SunIcon,
  WrenchIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { Changes } from "./changes.tsx";
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

export function Shell(): React.JSX.Element {
  return (
    <>
      <Changes />
      <header className="app-header">
        <NavLink className="brand" to="/" end>
          Ops
        </NavLink>
        <nav aria-label="Primary navigation">
          <NavLink to="/" end>
            <GaugeIcon aria-hidden="true" /> Overview
          </NavLink>
          <NavLink to="/services">
            <BoxesIcon aria-hidden="true" /> Services
          </NavLink>
          <NavLink to="/delivery">
            <GitPullRequestIcon aria-hidden="true" /> Delivery
          </NavLink>
          <NavLink to="/ai">
            <BotIcon aria-hidden="true" /> AI
          </NavLink>
          <NavLink to="/maintenance">
            <WrenchIcon aria-hidden="true" /> Maintenance
          </NavLink>
          <NavLink to="/review">
            <CalendarRangeIcon aria-hidden="true" /> Review
          </NavLink>
          <NavLink to="/alerts">
            <ActivityIcon aria-hidden="true" /> Alerts
          </NavLink>
          <NavLink to="/history">
            <HistoryIcon aria-hidden="true" /> History
          </NavLink>
          <NavLink to="/system">
            <ServerCogIcon aria-hidden="true" /> System
          </NavLink>
        </nav>
        <ThemeToggle />
      </header>
      <Outlet />
    </>
  );
}

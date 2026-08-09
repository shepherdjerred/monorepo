import { ActivityIcon, HistoryIcon, ServerCogIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { Changes } from "./changes.tsx";

export function Shell(): React.JSX.Element {
  return (
    <>
      <Changes />
      <header className="app-header">
        <NavLink className="brand" to="/">
          Alerts
        </NavLink>
        <nav aria-label="Primary navigation">
          <NavLink to="/">
            <ActivityIcon /> Active
          </NavLink>
          <NavLink to="/history">
            <HistoryIcon /> History
          </NavLink>
          <NavLink to="/system">
            <ServerCogIcon /> System
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </>
  );
}

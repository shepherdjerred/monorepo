import { NavLink } from "react-router";
import { cn } from "#src/lib/cn.ts";

/**
 * Profile / Manage switcher for a player.
 *
 * These are routes rather than local tab state so a profile is linkable — the
 * point of the surface is that someone pastes it into Discord.
 */
export function PlayerTabsNav(props: { guildId: string; alias: string }) {
  const base = `/g/${props.guildId}/players/${encodeURIComponent(props.alias)}`;
  const tabs = [
    { to: base, label: "Profile", end: true },
    { to: `${base}/manage`, label: "Manage", end: false },
  ];

  return (
    <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-2 text-sm font-medium",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

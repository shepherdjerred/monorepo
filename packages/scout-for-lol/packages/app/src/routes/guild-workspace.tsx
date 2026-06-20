import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { cn } from "#src/lib/cn.ts";

const NAV_ITEMS = [
  { to: "subscriptions", label: "Subscriptions" },
  { to: "players", label: "Players" },
  { to: "competitions", label: "Competitions" },
  { to: "reports", label: "Reports" },
  { to: "admin", label: "Admin" },
  { to: "audit", label: "Audit" },
] as const;

export function GuildWorkspace() {
  const { guildId } = useParams();

  if (guildId === undefined) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <p className="text-sm text-destructive">Missing guild id</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Guild
            </p>
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              {guildId}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/welcome"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Setup guide
            </Link>
            <NavLink
              to="/"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Change guild
            </NavLink>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </main>
  );
}

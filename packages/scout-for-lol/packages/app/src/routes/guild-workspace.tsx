import { Link, NavLink, Outlet, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { Permission } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { cn } from "#src/lib/cn.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { ForbiddenPanel } from "#src/components/forbidden-panel.tsx";

const NAV_ITEMS: {
  to: string;
  label: string;
  permission: Permission;
}[] = [
  {
    to: "subscriptions",
    label: "Subscriptions",
    permission: { resource: "subscriptions", action: "read" },
  },
  {
    to: "players",
    label: "Players",
    permission: { resource: "players", action: "read" },
  },
  {
    to: "competitions",
    label: "Competitions",
    permission: { resource: "competitions", action: "read" },
  },
  {
    to: "reports",
    label: "Reports",
    permission: { resource: "reports", action: "read" },
  },
  {
    to: "audit",
    label: "Audit",
    permission: { resource: "audit", action: "read" },
  },
  {
    to: "access",
    label: "Access",
    permission: { resource: "roles", action: "read" },
  },
];

export function GuildWorkspace() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  // Reuse the guild list already fetched by the picker (same query key →
  // served from cache; auto-fetches if the user deep-linked here).
  const { data: guilds } = useQuery(trpc.guild.listManageable.queryOptions());
  const guild = guilds?.find((g) => g.id === guildId);
  const { perms, isLoading, hasAccess } = usePermissions(guildId);

  if (guildId === undefined) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <p className="text-sm text-destructive">Missing guild id</p>
      </main>
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) =>
    perms.can(item.permission.resource, item.permission.action),
  );

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Guild
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              {guild?.name ?? "…"}
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
        {visibleNav.length > 0 && (
          <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
            {visibleNav.map((item) => (
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
        )}
      </div>

      {!isLoading && !hasAccess ? (
        <ForbiddenPanel
          title="No access to this server"
          message="You aren't a member of this server, or a Scout admin hasn't granted you access yet."
        />
      ) : (
        <Outlet />
      )}
    </main>
  );
}

import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useParams,
} from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Permission } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { cn } from "#src/lib/cn.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  ForbiddenPanel,
  permissionLabel,
} from "#src/components/forbidden-panel.tsx";
import { permissionForGuildActionRoute } from "#src/lib/guild-route-permissions.ts";
import type { QueryError } from "#src/lib/permission-query-state.ts";

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
  const location = useLocation();
  const trpc = useTRPC();
  // Reuse the guild list already fetched by the picker (same query key →
  // served from cache; auto-fetches if the user deep-linked here).
  const { data: guilds } = useQuery(trpc.guild.listManageable.queryOptions());
  const guild = guilds?.find((g) => g.id === guildId);
  const { perms, isLoading, hasAccess, error } = usePermissions(guildId);

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

  // The active section is the first path segment after `/g/:guildId/`. Gate the
  // rendered child on that section's read permission so a member holding only,
  // say, `reports:read` can't deep-link `/subscriptions` or `/access` (any grant
  // used to open every route). Action-only routes bypass this read gate and
  // reach their exact GuildPermissionGate below.
  const activeSection = /^\/g\/[^/]+\/([^/]+)/.exec(location.pathname)?.[1];
  const activeNav = NAV_ITEMS.find((item) => item.to === activeSection);
  const actionRoutePermission = permissionForGuildActionRoute(
    location.pathname,
  );
  const sectionForbidden =
    !isLoading &&
    hasAccess &&
    actionRoutePermission === null &&
    activeNav !== undefined &&
    perms.cannot(activeNav.permission.resource, activeNav.permission.action);
  const accessDenied = !isLoading && !hasAccess;

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

      {error === null ? (
        accessDenied ? (
          <ForbiddenPanel
            title="No access to this server"
            message="You aren't a member of this server, or a Scout admin hasn't granted you access yet."
          />
        ) : sectionForbidden ? (
          <ForbiddenPanel
            title={`No access to ${activeNav.label}`}
            message={`Ask a Scout admin to grant you ${activeNav.label} access.`}
          />
        ) : (
          <Outlet />
        )
      ) : (
        <PermissionLoadError error={error} />
      )}
    </main>
  );
}

/**
 * Index element for `/g/:guildId` — redirect to the first section the caller can
 * actually read, rather than always sending them to Subscriptions (which a
 * member without `subscriptions:read` cannot open). Rendered inside
 * {@link GuildWorkspace}'s outlet, so the "no access at all" case is already
 * handled by the parent; this only picks a landing tab.
 */
export function GuildSectionIndex() {
  const { guildId } = useParams();
  const { perms, isLoading, error } = usePermissions(guildId);

  if (isLoading) return null;
  if (error !== null) return <PermissionLoadError error={error} />;
  const first = NAV_ITEMS.find((item) =>
    perms.can(item.permission.resource, item.permission.action),
  );
  if (first === undefined) {
    return (
      <ForbiddenPanel
        title="No readable sections"
        message="Your access doesn't include any viewable section yet. Ask a Scout admin to grant you access."
      />
    );
  }
  return <Navigate to={first.to} replace />;
}

/** Block a mutation-only child route unless the caller holds its action. */
export function GuildPermissionGate(props: {
  permission: Permission;
  children: ReactNode;
}) {
  const { guildId } = useParams();
  const { perms, isLoading, error } = usePermissions(guildId);

  if (guildId === undefined) {
    return (
      <ForbiddenPanel
        title="Missing guild id"
        message="This permission-gated route requires a guild."
      />
    );
  }
  if (isLoading) return null;
  if (error !== null) return <PermissionLoadError error={error} />;
  if (perms.cannot(props.permission.resource, props.permission.action)) {
    return (
      <ForbiddenPanel
        title="Action not permitted"
        message={`You need “${permissionLabel(props.permission)}” to open this page.`}
      />
    );
  }
  return props.children;
}

function PermissionLoadError(props: { error: QueryError }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-card p-8 text-center">
      <h2 className="text-base font-semibold text-destructive">
        Unable to load access
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {props.error.message}
      </p>
    </div>
  );
}

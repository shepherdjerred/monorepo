import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useParams,
} from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, type ReactNode } from "react";
import { ProductSubnavigation } from "@scout-for-lol/design-system/layout";
import { SectionSkeleton } from "#src/components/section-skeleton.tsx";
import type { Permission } from "@scout-for-lol/data";
import {
  analyticsContextRoute,
  clearGuildContext,
  resolveGuildContext,
} from "#src/lib/analytics.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { cn } from "#src/lib/cn.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  ForbiddenPanel,
  permissionLabel,
} from "#src/components/forbidden-panel.tsx";
import { permissionsForGuildActionRoute } from "#src/lib/guild-route-permissions.ts";
import type { QueryError } from "#src/lib/permission-query-state.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";

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
  const { data: guilds } = useQuery(
    trpc.guild.listManageable.queryOptions(undefined, {
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );
  const guild = guilds?.find((g) => g.id === guildId);
  const { perms, isLoading, hasAccess, error } = usePermissions(guildId);

  // This is the only component mounted for every `/g/:guildId/*` route, so it
  // owns the guild super property: every subsequent event — autocapture and
  // pageviews included — carries the guild, and leaving the workspace clears it.
  //
  // `guildId` is an unvalidated route param until `usePermissions` resolves, so
  // registering it eagerly would let any signed-in visitor deep-link
  // `/g/<anything>` and stamp an arbitrary value onto every event the
  // unauthorized view emits — attacker-controlled and unbounded in cardinality.
  // Wait for the server to confirm access; the property stays cleared on
  // validation or authorization failure.
  //
  // The root layout holds this route's first pageview — and all autocapture —
  // until this effect reports the answer. On a cold deep link the permission
  // queries have not resolved on first render, and an entry pageview emitted
  // then would permanently lack `guild_id`: the property registers later, but
  // no replacement pageview is ever sent, and that entry event is the
  // installation-to-guild signal the whole join exists for.
  const contextRoute = analyticsContextRoute(location.pathname);
  const analyticsGuildId = hasAccess ? guildId : undefined;
  useEffect(() => {
    if (contextRoute === undefined || isLoading) return;
    resolveGuildContext(contextRoute, analyticsGuildId);
    return () => {
      clearGuildContext();
    };
  }, [contextRoute, isLoading, analyticsGuildId]);

  if (guildId === undefined) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <p className="text-sm text-scout-danger">Missing guild id</p>
      </div>
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) =>
    perms.can(item.permission.resource, item.permission.action),
  );

  // The active section is the first path segment after `/g/:guildId/`. Gate the
  // rendered child on that section's read permission so a member holding only,
  // say, `reports:read` can't deep-link `/subscriptions` or `/access` (any grant
  // used to open every route). Form routes bypass this broad section gate and
  // reach their exact create-only or update-plus-read gate below.
  const activeSection = /^\/g\/[^/]+\/([^/]+)/.exec(location.pathname)?.[1];
  const activeNav = NAV_ITEMS.find((item) => item.to === activeSection);
  const actionRoutePermissions = permissionsForGuildActionRoute(
    location.pathname,
  );
  const sectionForbidden =
    !isLoading &&
    hasAccess &&
    actionRoutePermissions === null &&
    activeNav !== undefined &&
    perms.cannot(activeNav.permission.resource, activeNav.permission.action);
  const accessDenied = !isLoading && !hasAccess;

  return (
    <>
      {visibleNav.length > 0 && (
        <ProductSubnavigation>
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  isActive
                    ? "bg-scout-brand text-scout-brand-ink"
                    : "text-scout-subtle hover:bg-scout-accent hover:text-scout-accent-ink",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </ProductSubnavigation>
      )}
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-scout-subtle">
              Guild
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              {guild?.name ?? "…"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/welcome"
              className="text-sm font-medium text-scout-subtle hover:text-scout-ink"
            >
              Setup guide
            </Link>
            <NavLink
              to="/"
              className="text-sm font-medium text-scout-subtle hover:text-scout-ink"
            >
              Change guild
            </NavLink>
          </div>
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
            <Suspense fallback={<SectionSkeleton />}>
              <Outlet />
            </Suspense>
          )
        ) : (
          <PermissionLoadError error={error} />
        )}
      </div>
    </>
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

/** Block a form route unless the caller holds every required permission. */
export function GuildPermissionsGate(props: {
  permissions: readonly Permission[];
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
  const missing = props.permissions.find((permission) =>
    perms.cannot(permission.resource, permission.action),
  );
  if (missing !== undefined) {
    return (
      <ForbiddenPanel
        title="Action not permitted"
        message={`You need “${permissionLabel(missing)}” to open this page.`}
      />
    );
  }
  return props.children;
}

function PermissionLoadError(props: { error: QueryError }) {
  return (
    <div className="rounded-lg border border-scout-danger/40 bg-scout-surface p-8 text-center">
      <h2 className="text-base font-semibold text-scout-danger">
        Unable to load access
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-scout-subtle">
        {props.error.message}
      </p>
    </div>
  );
}

import { useMemo } from "react";
import { Loaded } from "@shepherdjerred/loaded";
import { useQuery } from "@tanstack/react-query";
import {
  type Permission,
  type PermissionSet,
  createPermissionSet,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  type QueryError,
  resolvePermissionQueryError,
  shouldQueryScopedPermissions,
} from "#src/lib/permission-query-state.ts";

export type GuildPermissions = {
  /**
   * The caller's permission set — the same `can(resource, action)` the API
   * runs. Empty until `access` resolves, so a consumer that only asks
   * `can(...)` hides the control until the answer is known and needs no
   * loading branch of its own.
   */
  perms: PermissionSet;
  /**
   * Whether the permission bootstrap can be rendered against.
   *
   * This replaces the `isLoading` / `error` pair. Those were two fields
   * describing one state machine, and nothing stopped a consumer from reading
   * one without the other — `isLoading` false with `error` set reads as
   * "loaded" to anyone who only checked the first. As a `Loaded` it is one
   * value with one answer, and a `listManageable` refetch that fails over a
   * cached entry reports `degraded` rather than tearing down a working page.
   */
  access: Loaded<PermissionSet>;
  /** True once loaded if the caller holds any permission in this guild. */
  hasAccess: boolean;
};

/**
 * The signed-in user's effective permissions in a guild, built from the same
 * `createPermissionSet` primitive the backend uses. Reads the cached
 * `guild.listManageable` entry; falls back to `guild.myPermissions` for
 * deep-links where the guild isn't in that list yet.
 */
export function usePermissions(guildId: string | undefined): GuildPermissions {
  const trpc = useTRPC();
  const listQuery = useQuery(trpc.guild.listManageable.queryOptions());
  const entry = listQuery.data?.find((g) => g.id === guildId);
  const fallbackEnabled = shouldQueryScopedPermissions({
    guildId,
    listStatus: listQuery.status,
    hasListEntry: entry !== undefined,
  });

  const myQuery = useQuery({
    ...trpc.guild.myPermissions.queryOptions({ guildId: guildId ?? "" }),
    enabled: fallbackEnabled,
    retry: false,
  });

  const permissions: Permission[] = entry?.permissions ?? myQuery.data ?? [];
  const perms = useMemo(() => createPermissionSet(permissions), [permissions]);

  const resolvingFallback =
    entry === undefined && fallbackEnabled && myQuery.isLoading;
  const isLoading = listQuery.isLoading || resolvingFallback;
  const fallbackSucceeded = entry === undefined && myQuery.isSuccess;
  const error = resolvePermissionQueryError({
    hasListEntry: entry !== undefined,
    fallbackSucceeded,
    listError: listQuery.error,
    fallbackError: myQuery.error,
  });
  const resolved = entry !== undefined || fallbackSucceeded;
  const hasAccess =
    !isLoading && error === null && resolved && permissions.length > 0;
  const access = permissionAccess({
    perms,
    error,
    resolved,
    staleError: entry === undefined ? null : listQuery.error,
  });

  return { perms, access, hasAccess };
}

/**
 * Projects the bootstrap onto renderability.
 *
 * `staleError` is only ever non-null when a cached `listManageable` entry is
 * already in hand, which is exactly the `degraded` case: the answer on screen
 * is still valid, the attempt to refresh it failed. `resolvePermissionQueryError`
 * keeps owning the fatal-versus-tolerable policy; this only re-expresses its
 * verdict as a state.
 */
function permissionAccess(args: {
  perms: PermissionSet;
  error: QueryError | null;
  resolved: boolean;
  staleError: QueryError | null;
}): Loaded<PermissionSet> {
  if (args.error !== null) {
    return Loaded.failed(args.error, ["permissions"]);
  }
  if (!args.resolved) {
    return Loaded.loading();
  }
  if (args.staleError === null) {
    return Loaded.done(args.perms);
  }
  return Loaded.degraded(args.perms, [
    { path: ["permissions"], error: args.staleError },
  ]);
}

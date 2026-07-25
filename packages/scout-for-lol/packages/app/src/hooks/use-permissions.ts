import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type Permission,
  type PermissionSet,
  createPermissionSet,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";

export type GuildPermissions = {
  /** The caller's permission set — the same `can(resource, action)` the API runs. */
  perms: PermissionSet;
  /** True while the underlying queries are still loading. */
  isLoading: boolean;
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

  const myQuery = useQuery({
    ...trpc.guild.myPermissions.queryOptions({ guildId: guildId ?? "" }),
    enabled:
      guildId !== undefined &&
      listQuery.data !== undefined &&
      entry === undefined,
    retry: false,
  });

  const permissions: Permission[] = entry?.permissions ?? myQuery.data ?? [];
  const perms = useMemo(() => createPermissionSet(permissions), [permissions]);

  const resolvingFallback = entry === undefined && myQuery.isLoading;
  const isLoading = listQuery.isLoading || resolvingFallback;
  const hasAccess = !isLoading && permissions.length > 0;

  return { perms, isLoading, hasAccess };
}

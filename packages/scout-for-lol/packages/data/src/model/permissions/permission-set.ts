import {
  type ActionFor,
  type Permission,
  type Resource,
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  parsePermissionKey,
  permissionKey,
} from "#src/model/permissions/catalog.ts";

/**
 * A resolved set of permissions for one user in one guild. This is the shared
 * primitive used by BOTH the backend procedure gate and the frontend
 * `usePermissions` hook — the identical `can(...)` check runs on each side.
 *
 * The value carried around is the structured {@link Permission} object, but the
 * check surface is positional and reads like English, with full type inference
 * (`resource` narrows `action` to that resource's verbs):
 *
 * ```ts
 * perms.can("reports", "run");
 * perms.canManage("subscriptions");
 * perms.isRoot;
 * ```
 */
export type PermissionSet = {
  can: <R extends Resource>(resource: R, action: ActionFor<R>) => boolean;
  cannot: <R extends Resource>(resource: R, action: ActionFor<R>) => boolean;
  /** True when the set holds every action on `resource` (CASL's `manage`). */
  canManage: (resource: Resource) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  /** True for Discord admins/owners (sudo) — `can(...)` is always true. */
  readonly isRoot: boolean;
  /** The canonical permission objects, for the wire. */
  toArray: () => Permission[];
};

const key = (resource: string, action: string): string =>
  `${resource}:${action}`;

/** Build a permission set from an explicit list of granted permissions. */
export function createPermissionSet(
  granted: readonly Permission[],
): PermissionSet {
  const keys = new Set(granted.map((p) => permissionKey(p)));
  return {
    can: (resource, action) => keys.has(key(resource, action)),
    cannot: (resource, action) => !keys.has(key(resource, action)),
    canManage: (resource) =>
      PERMISSION_CATALOG[resource].actions.every((a) =>
        keys.has(key(resource, a.name)),
      ),
    canAny: (...permissions) =>
      permissions.some((p) => keys.has(permissionKey(p))),
    isRoot: false,
    toArray: () =>
      [...keys].flatMap((k) => {
        const p = parsePermissionKey(k);
        return p ? [p] : [];
      }),
  };
}

/** The sudo set: Discord admins/owners implicitly hold every permission. */
export function rootPermissions(): PermissionSet {
  return {
    can: () => true,
    cannot: () => false,
    canManage: () => true,
    canAny: () => true,
    isRoot: true,
    toArray: () => [...ALL_PERMISSIONS],
  };
}

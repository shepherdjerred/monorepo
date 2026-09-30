import { z } from "zod";
import {
  type Permission,
  type Resource,
  ALL_PERMISSIONS,
  P,
  permissionKey,
} from "#src/model/permissions/catalog.ts";
import { type PermissionSet } from "#src/model/permissions/permission-set.ts";

/**
 * Roles are named presets — bundles of permissions. They are NOT stored: a grant
 * writes one row per permission, so an admin can also hand-pick individual
 * scopes ("custom"). {@link deriveRole} names the preset a set matches, if any.
 *
 * Every member of a server holds {@link PLAYER_PERMISSIONS} without a grant;
 * grants only ever add to it.
 */
export const RoleSchema = z.enum(["viewer", "manager", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

/** Every resource's `read` action, for the given resources. */
function reads(...resources: Resource[]): Permission[] {
  return resources.map((r) => P(r, "read"));
}

/** All permissions except those on the given resources. */
function everythingExcept(...resources: Resource[]): Permission[] {
  const excluded = new Set<Resource>(resources);
  return ALL_PERMISSIONS.filter((p) => !excluded.has(p.resource));
}

/**
 * What every member of a server where Scout is installed holds without a
 * grant: the player-facing reads. It is what Scout already shows members in
 * Discord — tracked players, their stats, competitions, saved reports and
 * custom games. Management reads (which channels notify whom, the channel
 * list) and the audit log stay behind a grant.
 */
export const PLAYER_PERMISSIONS: readonly Permission[] = reads(
  "players",
  "accounts",
  "competitions",
  "reports",
  "customs",
);

const VIEWER = reads(
  "subscriptions",
  "players",
  "accounts",
  "competitions",
  "reports",
  "channels",
  "customs",
);
const MANAGER = everythingExcept("roles");
const ADMIN = [...ALL_PERMISSIONS];

export type RoleInfo = {
  readonly id: Role;
  readonly label: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
};

export const ROLE_CATALOG = {
  viewer: {
    id: "viewer",
    label: "Dashboard viewer",
    description:
      "Read-only access to the management dashboard, including subscriptions and channels.",
    permissions: VIEWER,
  },
  manager: {
    id: "manager",
    label: "Manager",
    description: "Full day-to-day management; cannot manage who has access.",
    permissions: MANAGER,
  },
  admin: {
    id: "admin",
    label: "Admin",
    description: "Everything, including granting and revoking access.",
    permissions: ADMIN,
  },
} satisfies Record<Role, RoleInfo>;

export const ROLES: readonly RoleInfo[] = [
  ROLE_CATALOG.viewer,
  ROLE_CATALOG.manager,
  ROLE_CATALOG.admin,
];

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_CATALOG[role].permissions];
}

/** Whether an actor may delegate every permission contained in a role preset. */
export function canDelegateRole(set: PermissionSet, role: Role): boolean {
  return permissionsForRole(role).every((permission) =>
    set.can(permission.resource, permission.action),
  );
}

/**
 * A role as shown for a member: a grantable preset, the implicit `"player"`
 * baseline when grants add nothing to it, or `"custom"`.
 */
export type DerivedRole = Role | "player" | "custom";

/** A member's effective permissions: the Player baseline plus their grants. */
export function memberPermissions(
  granted: readonly Permission[],
): Permission[] {
  const keys = new Set(granted.map((p) => permissionKey(p)));
  return [
    ...PLAYER_PERMISSIONS.filter((p) => !keys.has(permissionKey(p))),
    ...granted,
  ];
}

/** Whether grants add anything to what every member already holds. */
export function exceedsPlayer(granted: readonly Permission[]): boolean {
  const baseline = new Set(PLAYER_PERMISSIONS.map((p) => permissionKey(p)));
  return granted.some((p) => !baseline.has(permissionKey(p)));
}

/**
 * Name the preset an effective permission set exactly matches, else
 * `"custom"`. Discord admins/owners (root) always derive as `"admin"`. Pass
 * the member's effective set — see {@link memberPermissions} — so the
 * implicit baseline is counted.
 */
export function deriveRole(set: PermissionSet): DerivedRole {
  if (set.isRoot) {
    return "admin";
  }
  const held = new Set(set.toArray().map((p) => permissionKey(p)));
  const presets: [DerivedRole, readonly Permission[]][] = [
    ["admin", ADMIN],
    ["manager", MANAGER],
    ["viewer", VIEWER],
    ["player", PLAYER_PERMISSIONS],
  ];
  for (const [role, permissions] of presets) {
    const want = new Set(permissions.map((p) => permissionKey(p)));
    if (want.size === held.size && [...want].every((k) => held.has(k))) {
      return role;
    }
  }
  return "custom";
}

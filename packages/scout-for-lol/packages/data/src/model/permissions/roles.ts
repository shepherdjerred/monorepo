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

const VIEWER = reads(
  "subscriptions",
  "players",
  "accounts",
  "competitions",
  "reports",
  "channels",
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
    label: "Viewer",
    description: "Read-only access to the dashboard.",
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
 * Name the preset a permission set exactly matches, else `"custom"`. Discord
 * admins/owners (root) always derive as `"admin"`.
 */
export function deriveRole(set: PermissionSet): Role | "custom" {
  if (set.isRoot) {
    return "admin";
  }
  const held = new Set(set.toArray().map((p) => permissionKey(p)));
  for (const role of ["admin", "manager", "viewer"] as const) {
    const want = new Set(permissionsForRole(role).map((p) => permissionKey(p)));
    if (want.size === held.size && [...want].every((k) => held.has(k))) {
      return role;
    }
  }
  return "custom";
}

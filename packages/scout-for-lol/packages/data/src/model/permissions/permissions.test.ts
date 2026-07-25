import { describe, expect, test } from "bun:test";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  PermissionSchema,
  P,
  parsePermissionKey,
  permissionKey,
} from "#src/model/permissions/catalog.ts";
import {
  createPermissionSet,
  rootPermissions,
} from "#src/model/permissions/permission-set.ts";
import {
  ROLE_CATALOG,
  deriveRole,
  permissionsForRole,
} from "#src/model/permissions/roles.ts";

describe("catalog", () => {
  test("has 31 permissions across 8 resources", () => {
    const expected = Object.values(PERMISSION_CATALOG).reduce(
      (sum, def) => sum + def.actions.length,
      0,
    );
    expect(ALL_PERMISSIONS.length).toBe(expected);
    expect(ALL_PERMISSIONS.length).toBe(31);
    expect(Object.keys(PERMISSION_CATALOG).length).toBe(8);
  });

  test("every catalog pair round-trips through the DB key form", () => {
    for (const p of ALL_PERMISSIONS) {
      const back = parsePermissionKey(permissionKey(p));
      expect(back).toEqual(p);
    }
  });

  test("unknown and legacy keys parse to undefined (drop, not throw)", () => {
    expect(parsePermissionKey("foo:bar")).toBeUndefined();
    expect(parsePermissionKey("CREATE_COMPETITION")).toBeUndefined();
    expect(parsePermissionKey("reports:")).toBeUndefined();
    expect(parsePermissionKey("channels:delete")).toBeUndefined();
  });

  test("keys with extra or missing segments are rejected, not truncated", () => {
    // A valid resource:action prefix followed by junk must NOT be accepted —
    // `split(":", 2)` would have parsed this as a valid `reports:create`.
    expect(parsePermissionKey("reports:create:unexpected")).toBeUndefined();
    expect(parsePermissionKey("reports:create:")).toBeUndefined();
    expect(parsePermissionKey("subscriptions:read:extra")).toBeUndefined();
    // Single-segment (no colon) is likewise not a canonical key.
    expect(parsePermissionKey("reports")).toBeUndefined();
    expect(parsePermissionKey("")).toBeUndefined();
  });

  test("PermissionSchema rejects action/resource mismatches", () => {
    expect(
      PermissionSchema.safeParse({ resource: "channels", action: "delete" })
        .success,
    ).toBe(false);
    expect(
      PermissionSchema.safeParse({ resource: "audit", action: "write" })
        .success,
    ).toBe(false);
    expect(
      PermissionSchema.safeParse({ resource: "reports", action: "run" })
        .success,
    ).toBe(true);
  });

  test("P builds a validated permission value", () => {
    // Illegal pairs like P("channels", "delete") are rejected at compile time by
    // the ActionFor<R> parameter; invalid-pair rejection at runtime is covered by
    // the PermissionSchema test above.
    expect(P("reports", "run")).toEqual({ resource: "reports", action: "run" });
    expect(P("roles", "grant")).toEqual({ resource: "roles", action: "grant" });
  });
});

describe("PermissionSet", () => {
  const set = createPermissionSet([
    { resource: "subscriptions", action: "read" },
    { resource: "subscriptions", action: "create" },
    { resource: "reports", action: "read" },
  ]);

  test("can / cannot", () => {
    expect(set.can("subscriptions", "read")).toBe(true);
    expect(set.can("subscriptions", "delete")).toBe(false);
    expect(set.cannot("subscriptions", "delete")).toBe(true);
  });

  test("canManage requires every action on the resource", () => {
    expect(set.canManage("reports")).toBe(false); // only reports:read
    const full = createPermissionSet(
      PERMISSION_CATALOG.subscriptions.actions.map((a) =>
        P("subscriptions", a.name),
      ),
    );
    expect(full.canManage("subscriptions")).toBe(true);
  });

  test("canAny", () => {
    expect(
      set.canAny(
        { resource: "reports", action: "delete" },
        { resource: "reports", action: "read" },
      ),
    ).toBe(true);
    expect(set.canAny({ resource: "reports", action: "delete" })).toBe(false);
  });

  test("toArray round-trips the set", () => {
    expect(set.toArray()).toHaveLength(3);
    expect(new Set(set.toArray().map((p) => permissionKey(p)))).toEqual(
      new Set(["subscriptions:read", "subscriptions:create", "reports:read"]),
    );
  });

  test("rootPermissions grants everything", () => {
    const root = rootPermissions();
    expect(root.isRoot).toBe(true);
    expect(root.can("roles", "revoke")).toBe(true);
    expect(root.canManage("competitions")).toBe(true);
    expect(root.toArray()).toHaveLength(ALL_PERMISSIONS.length);
  });
});

describe("roles", () => {
  test("viewer is read-only and excludes audit + roles", () => {
    const viewer = createPermissionSet(permissionsForRole("viewer"));
    expect(viewer.can("subscriptions", "read")).toBe(true);
    expect(viewer.can("reports", "run")).toBe(false);
    expect(viewer.can("subscriptions", "create")).toBe(false);
    expect(viewer.can("audit", "read")).toBe(false);
    expect(viewer.can("roles", "read")).toBe(false);
  });

  test("manager is everything except roles", () => {
    const manager = createPermissionSet(permissionsForRole("manager"));
    expect(manager.can("reports", "run")).toBe(true);
    expect(manager.can("audit", "read")).toBe(true);
    expect(manager.can("roles", "grant")).toBe(false);
    expect(manager.can("roles", "read")).toBe(false);
  });

  test("admin is everything", () => {
    const admin = createPermissionSet(permissionsForRole("admin"));
    expect(admin.toArray()).toHaveLength(ALL_PERMISSIONS.length);
    expect(admin.can("roles", "grant")).toBe(true);
  });

  test("deriveRole names the matching preset, else custom", () => {
    expect(deriveRole(createPermissionSet(permissionsForRole("viewer")))).toBe(
      "viewer",
    );
    expect(deriveRole(createPermissionSet(permissionsForRole("manager")))).toBe(
      "manager",
    );
    expect(deriveRole(createPermissionSet(permissionsForRole("admin")))).toBe(
      "admin",
    );
    expect(deriveRole(rootPermissions())).toBe("admin");
    expect(
      deriveRole(createPermissionSet([{ resource: "reports", action: "run" }])),
    ).toBe("custom");
  });

  test("ROLE_CATALOG covers every role", () => {
    expect(Object.keys(ROLE_CATALOG).sort()).toEqual([
      "admin",
      "manager",
      "viewer",
    ]);
  });
});

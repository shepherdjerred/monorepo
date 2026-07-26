import { z } from "zod";
import { PERMISSION_CATALOG as GENERATED_PERMISSION_CATALOG } from "#generated/permission-catalog.ts";

/**
 * The permission catalog — generated from the language-neutral JSON source.
 *
 * Everything else (the {@link Permission} union, {@link PermissionSchema},
 * role bundles, the backend procedure gate, and the frontend `can(...)` checks)
 * is derived from this value, so the API and UI can never drift. Edit
 * `permission-catalog.json`, then run this package's `generate` task.
 *
 * A permission is a structured `{ resource, action }` pair. On the wire and in
 * the TypeScript API it stays an object; in the database it is stored as the
 * canonical `"resource:action"` string (see {@link permissionKey}).
 */

export const PERMISSION_CATALOG = { ...GENERATED_PERMISSION_CATALOG };

export type Resource = keyof typeof PERMISSION_CATALOG;

export type ActionFor<R extends Resource> =
  (typeof PERMISSION_CATALOG)[R]["actions"][number]["name"];

/**
 * The exhaustive set of valid permissions as a tagged union. Each resource only
 * admits its own actions, so an invalid pair like
 * `{ resource: "channels", action: "delete" }` is a compile error.
 */
export type Permission = {
  [R in Resource]: { resource: R; action: ActionFor<R> };
}[Resource];

/**
 * Per-resource discriminated-union members. Each `z.enum` reads its action
 * names straight from the catalog (single source of truth) with a concrete
 * resource key, so Zod v4 infers the resource-specific literal action union.
 *
 * `satisfies Record<Resource, ...>` is the exhaustiveness guard: adding a
 * resource to {@link PERMISSION_CATALOG} without a member here fails to
 * typecheck ("Property '<resource>' is missing").
 */
const MEMBER_SCHEMAS = {
  subscriptions: z.object({
    resource: z.literal("subscriptions"),
    action: z.enum(PERMISSION_CATALOG.subscriptions.actions.map((a) => a.name)),
  }),
  players: z.object({
    resource: z.literal("players"),
    action: z.enum(PERMISSION_CATALOG.players.actions.map((a) => a.name)),
  }),
  accounts: z.object({
    resource: z.literal("accounts"),
    action: z.enum(PERMISSION_CATALOG.accounts.actions.map((a) => a.name)),
  }),
  competitions: z.object({
    resource: z.literal("competitions"),
    action: z.enum(PERMISSION_CATALOG.competitions.actions.map((a) => a.name)),
  }),
  reports: z.object({
    resource: z.literal("reports"),
    action: z.enum(PERMISSION_CATALOG.reports.actions.map((a) => a.name)),
  }),
  channels: z.object({
    resource: z.literal("channels"),
    action: z.enum(PERMISSION_CATALOG.channels.actions.map((a) => a.name)),
  }),
  audit: z.object({
    resource: z.literal("audit"),
    action: z.enum(PERMISSION_CATALOG.audit.actions.map((a) => a.name)),
  }),
  roles: z.object({
    resource: z.literal("roles"),
    action: z.enum(PERMISSION_CATALOG.roles.actions.map((a) => a.name)),
  }),
} satisfies Record<Resource, z.ZodType>;

export const PermissionSchema = z.discriminatedUnion("resource", [
  MEMBER_SCHEMAS.subscriptions,
  MEMBER_SCHEMAS.players,
  MEMBER_SCHEMAS.accounts,
  MEMBER_SCHEMAS.competitions,
  MEMBER_SCHEMAS.reports,
  MEMBER_SCHEMAS.channels,
  MEMBER_SCHEMAS.audit,
  MEMBER_SCHEMAS.roles,
]);

/**
 * Ergonomic constructor for a permission value. Validates through
 * {@link PermissionSchema} (cast-free) so the returned value is a real
 * {@link Permission}; call-site type-safety comes from the `ActionFor<R>`
 * parameter, which rejects `P("channels", "delete")` at compile time.
 */
export function P<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
): Permission {
  return PermissionSchema.parse({ resource, action });
}

/** Canonical DB / Set string form: `"resource:action"`. */
export function permissionKey(permission: Permission): string {
  return `${permission.resource}:${permission.action}`;
}

/**
 * Parse a `"resource:action"` key back into a {@link Permission}. Returns
 * `undefined` for unknown or legacy strings so stale grant rows drop silently
 * instead of throwing.
 */
export function parsePermissionKey(key: string): Permission | undefined {
  // Require exactly two segments. `split(":", 2)` would silently accept a
  // malformed key like `"reports:create:unexpected"` by truncating the tail to
  // `"reports:create"`; splitting without a limit and length-checking rejects
  // any non-canonical shape (extra segments, or a bare single-segment string).
  const parts = key.split(":");
  if (parts.length !== 2) return undefined;
  const [resource, action] = parts;
  const parsed = PermissionSchema.safeParse({ resource, action });
  return parsed.success ? parsed.data : undefined;
}

/**
 * The two legacy Discord `/competition grant-permission` strings and their
 * canonical catalog permissions. That command persists the raw
 * `PermissionType` enum (`CREATE_COMPETITION` / `CREATE_REPORT`) rather than a
 * `"resource:action"` key, so a grant it issues is not a canonical key. RBAC
 * readers must bridge these so a Discord-issued grant is honored; new code
 * should grant canonical keys directly.
 */
export const LEGACY_PERMISSION_KEYS: Record<string, Permission> = {
  CREATE_COMPETITION: P("competitions", "create"),
  CREATE_REPORT: P("reports", "create"),
};

/**
 * Parse a stored `ServerPermission.permission` value into a {@link Permission},
 * tolerating the legacy Discord-command grant strings ({@link
 * LEGACY_PERMISSION_KEYS}). Use this — not {@link parsePermissionKey}, which
 * stays strict — when reading grant rows, so a Discord-issued grant is not
 * silently dropped. Unknown values violate the persisted-data contract and
 * throw so the bad row is corrected instead of becoming an unexplained denial.
 */
export function parseStoredPermissionKey(key: string): Permission {
  const permission = parsePermissionKey(key) ?? LEGACY_PERMISSION_KEYS[key];
  if (permission === undefined) {
    throw new Error(`Invalid stored permission key: ${key}`);
  }
  return permission;
}

/** Every valid permission, derived from the catalog. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.entries(
  PERMISSION_CATALOG,
).flatMap(([resource, def]) =>
  def.actions.map((a) => {
    const parsed = PermissionSchema.safeParse({ resource, action: a.name });
    if (!parsed.success) {
      throw new Error(`Invalid catalog permission: ${resource}:${a.name}`);
    }
    return parsed.data;
  }),
);

/** Machine-readable cause attached to a FORBIDDEN when a permission is missing. */
export const PermissionDeniedCauseSchema = z.object({
  missingPermission: PermissionSchema,
});
export type PermissionDeniedCause = z.infer<typeof PermissionDeniedCauseSchema>;

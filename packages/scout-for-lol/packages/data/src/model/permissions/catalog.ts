import { z } from "zod";

/**
 * The permission catalog — the single source of truth for Scout's RBAC.
 *
 * Everything else (the {@link Permission} union, {@link PermissionSchema},
 * role bundles, the backend procedure gate, and the frontend `can(...)` checks)
 * is derived from this one object, so the API and UI can never drift.
 *
 * A permission is a structured `{ resource, action }` pair. On the wire and in
 * the TypeScript API it stays an object; in the database it is stored as the
 * canonical `"resource:action"` string (see {@link permissionKey}).
 */

/** One selectable verb within a resource. */
type ActionDef = {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
};

type ResourceDef = {
  readonly label: string;
  readonly description?: string;
  readonly actions: readonly ActionDef[];
};

export const PERMISSION_CATALOG = {
  subscriptions: {
    label: "Subscriptions",
    actions: [
      { name: "read", label: "View subscriptions" },
      { name: "create", label: "Add subscriptions" },
      { name: "update", label: "Edit subscriptions (filters, mute, move)" },
      { name: "delete", label: "Remove subscriptions" },
    ],
  },
  players: {
    label: "Players",
    actions: [
      { name: "read", label: "View players" },
      { name: "update", label: "Rename players" },
      { name: "delete", label: "Delete players" },
      { name: "merge", label: "Merge players" },
      { name: "link", label: "Link / unlink Discord accounts" },
    ],
  },
  accounts: {
    label: "Riot accounts",
    actions: [
      { name: "read", label: "Look up Riot accounts" },
      { name: "create", label: "Add Riot accounts" },
      { name: "update", label: "Edit Riot accounts" },
      { name: "delete", label: "Remove Riot accounts" },
      { name: "transfer", label: "Transfer accounts between players" },
    ],
  },
  competitions: {
    label: "Competitions",
    actions: [
      { name: "read", label: "View competitions & leaderboards" },
      { name: "create", label: "Create competitions" },
      { name: "update", label: "Edit competitions" },
      { name: "cancel", label: "Cancel competitions" },
      { name: "invite", label: "Manage participants" },
      { name: "schedule", label: "Change update schedule" },
      { name: "refresh", label: "Force-refresh leaderboards" },
    ],
  },
  reports: {
    label: "Reports",
    actions: [
      { name: "read", label: "View & preview reports" },
      { name: "create", label: "Create reports" },
      { name: "update", label: "Edit reports" },
      { name: "delete", label: "Delete reports" },
      { name: "run", label: "Run & post reports" },
    ],
  },
  channels: {
    label: "Channels",
    actions: [{ name: "read", label: "List postable channels" }],
  },
  audit: {
    label: "Audit log",
    actions: [{ name: "read", label: "View the audit log" }],
  },
  roles: {
    label: "Roles & access",
    actions: [
      { name: "read", label: "View who has access" },
      { name: "grant", label: "Grant access" },
      { name: "revoke", label: "Revoke access" },
    ],
  },
} as const satisfies Record<string, ResourceDef>;

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
  const [resource, action] = key.split(":", 2);
  const parsed = PermissionSchema.safeParse({ resource, action });
  return parsed.success ? parsed.data : undefined;
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

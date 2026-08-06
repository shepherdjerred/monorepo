---
id: plan-2026-07-25-scout-rbac-permission-system
type: plan
status: complete
board: false
---

# Scout for LoL — RBAC Permission System

## Context

Scout's web UI is **binary admin-only** today. Every guild-scoped tRPC resolver
manually calls `assertGuildAdmin({user, guildId})` (`packages/backend/src/trpc/guild-guard.ts:13`)
— "Discord guild owner or Administrator bit, else FORBIDDEN." A non-admin member
can't see the dashboard at all: the guild never appears in the picker
(`guild.listManageable` filters to admins) and every read throws FORBIDDEN.

We're adding **role-based access control** so a guild admin can delegate scoped
access, using **Scout-managed grants** on the existing `ServerPermission` table.

**Locked decisions:**

- **Assignment = Scout-managed grants** (extend `ServerPermission`). No Discord-role mapping.
- **Granularity = full CRUD** — a resource × action matrix (**31 permissions**).
- **Identifier = structured `{ resource, action }`** carried end-to-end (TS + JSON wire);
  DB stores the canonical `"resource:action"` string, parsed at the boundary.
- **Enforced identically at API + UI** from ONE `packages/data` catalog; server authoritative.
- Roles (Viewer/Manager/Admin) are **presets = permission bundles**, not stored; "Custom" allowed.
- **Discord admin/owner = Scout root/sudo** (implicit all permissions, the ONLY Discord signal);
  membership still gates access (OAuth presence). Backwards-compatible — admins keep full access
  with zero grants.

**Build vs buy:** evaluated the 2026 landscape (OpenFGA/SpiceDB/Ory Keto/Cerbos/Permit.io/
WorkOS/Oso Cloud/Topaz — all overkill or SaaS-coupled for a single-node SQLite bot; CASL is
the one in-app fit but its conditions DSL is unused by a flat capability model). **Decision:
hand-roll** a ~30-line `PermissionSet` derived from the catalog (more type-safe, dependency-free);
**CASL is the documented upgrade path** if we ever need ownership/field-level rules.

## Design

### Matrix (31 permissions)

`subscriptions`{read,create,update,delete} · `players`{read,update,delete,merge,link} ·
`accounts`{read,create,update,delete,transfer} ·
`competitions`{read,create,update,cancel,invite,schedule,refresh} ·
`reports`{read,create,update,delete,run} · `channels`{read} · `audit`{read} ·
`roles`{read,grant,revoke}

### Role presets

- **Viewer** = every resource `:read` except `audit`/`roles`.
- **Manager** = everything except `roles:*`.
- **Admin** = everything. Discord admin/owner ⇒ `rootPermissions()` (derives as admin).

### Readable interface (CASL-inspired; `{resource,action}` stays the canonical value)

```ts
const viewer = can("read").on("subscriptions", "players", "reports", …);   // define
add: guildMutationProcedure("subscriptions", "create").input(…).mutation(…) // guard
if (perms.can("subscriptions", "create")) …                                 // check (API or UI)
{perms.can("reports", "run") && <RunButton />}   perms.canManage("competitions")   perms.isRoot
```

### Data package (`packages/data/src/model/permissions/`)

`catalog.ts` (`PERMISSION_CATALOG` `as const satisfies`, derived `Resource`/`ActionFor`/
`Permission` exhaustive union, `PermissionSchema` catalog-driven discriminated union,
`permissionKey`/`parsePermissionKey`, `ALL_PERMISSIONS`, `PermissionDeniedCauseSchema`),
`permission-set.ts` (`createPermissionSet`/`rootPermissions`, positional
`can(resource, action)`/`canManage`/`isRoot`/`canAny`/`toArray`, `P()` constructor),
`roles.ts` (`RoleSchema`, `ROLE_CATALOG`, `permissionsForRole`, `deriveRole`). Wired via
`model/index.ts` `export *`. 31 permissions across 8 resources.

### Prisma (`ServerPermission`)

Add `@@index([serverId,discordUserId])` + `@@index([serverId])`; `permission` stores
`"resource:action"` keys; migration rewrites legacy `CREATE_COMPETITION`/`CREATE_REPORT`.

### Backend

`guild-permission.ts`: `resolveGuildPermissions(user,guildId)` (member? → admin/owner ⇒ root;
else grant rows) + `guildProcedure(resource,action)`/`guildMutationProcedure(...)` composing on
`webProcedure`/`webMutationProcedure`, guildId from `getRawInput()` via Zod, inject
`ctx.guildId`/`ctx.permissions`. Convert every guild-scoped resolver; delete scattered
`assertGuildAdmin`/`assertAdmin` (keep `assertChannelInGuild`). `errorFormatter` adds
`data.missingPermission`. `listManageable` returns `permissions: Permission[]` + includes
Viewer guilds; new `guild.myPermissions`. New `roles` router (list/set/clear) + `ROLE_GRANT`/
`ROLE_REVOKE` audit + self-lockout guard. `discord.searchMembers` → `players:read`. Discord
bridge so `canCreate*` honor the new keys.

### Frontend (`packages/app`)

`use-permissions.ts` hook (+ `<Can>`), `guild-workspace` access guard + nav filtering,
gate every mutating control, `forbidden-panel.tsx`, `guild-access.tsx` Members/Access tab + route.

### Delivery

One atomic PR (lockstep contract), 3 commits: data → backend → app.

## Historical follow-up state

- [x] Data package: catalog + permission-set + roles + tests
- [x] Prisma indexes + legacy-key migration + regen
- [x] Backend: guard, resolver conversion, errorFormatter, listManageable, roles router, bridge, tests
- [x] Frontend: hook, gating, forbidden panel, Access tab
- [x] Verify (scoped typecheck/test/lint across data/backend/app — green)
- Manual browser e2e + PR screenshots (needs `op signin` + Discord OAuth; not runnable headless)

## Full design reference

See the approved plan for the complete procedure→permission table, code sketches, and
verification detail: `~/.claude/plans/could-we-begin-work-peppy-fairy.md` (copied here in summary).

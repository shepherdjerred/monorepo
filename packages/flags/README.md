# Flags

The flag service stores one document per deployment a workload reads. Prod-only
workloads have one document. Scout and Karma have a second document because a
second workload reads one. Storm forum and storm brain share `storm/prod`.
A document is a list of boolean flags with ordered segment rollouts, or
variant flags whose value is one string, encoded and typed per key by the
value-schema registry in `@shepherdjerred/feature-flags`.

`FLAGS_ACTIVE` is `true`, so Delivery deploys `flags/prod` on its own ZFS NVMe
SQLite volume at `/var/lib/flags` as the authoritative feature-flag service.

## HTTP

`GET /healthz` answers the probes. `GET /metrics` exports Prometheus gauges for
stored deployments, revisions, and flag counts alongside bounded HTTP request
counters across both listeners on the primary listener.

Credentialless routes reject an `Authorization` header:

- `GET /v1/deployments/:catalog/:stage/snapshot` returns the document and an
  `ETag`. `If-None-Match` returns 304.
- `POST /v1/evaluate` with `{ deployment, key, context }` returns
  `{ enabled }` for a boolean. A missing flag is 404 `FLAG_NOT_FOUND`. A
  variant flag is 400. `enabled: false` is a successful answer.

When `FLAGS_EVALUATION_PORT` is set (`7361` in production), a second listener
mounts only `/healthz`, `/v1/deployments/:catalog/:stage/snapshot`, and
`/v1/evaluate`. It rejects any `Authorization` header on `/v1/*` with 401,
never reads `Tailscale-User-Login`, and omits management routes and the
operator UI so in-cluster consumer NetworkPolicies can open evaluation without
exposing management. The primary `PORT` (`7360`) serves all routes, including
tailnet evaluation, management, and the browser UI.

Management routes require the brokered `FLAGS_MACHINE_TOKEN` or a tailnet
operator login (`FLAGS_OPERATOR_LOGINS`) inserted by the verified Tailscale
ingress proxy (`FLAGS_INGRESS_IDENTITY_DIR` in Kubernetes, which fences the
`flags-flags-ingress-ingress` UID, StatefulSet controller, and ready proxy Pod
IP on each human request) or a local proxy matching `FLAGS_TRUSTED_PROXIES`.
`FLAGS_TRUSTED_PROXIES` accepts comma-separated exact IP addresses (`127.0.0.1`,
`::1`) and CIDR subnets matched with `node:net` `BlockList`, normalizes
IPv4-mapped IPv6 peers, and fails fast at startup on malformed entries or when
combined with `FLAGS_INGRESS_IDENTITY_DIR`. Browser writes must be same-origin
(`FLAGS_PUBLIC_ORIGIN`). The routes are list, get, `apply`, `create-missing`,
`retire`, and `diff`. `apply` and `retire` take `expectedRevision` and change
nothing when it does not match, including later flags in that request.
`create-missing` inserts absent keys and leaves an existing body as it is.

`apply` and `create-missing` validate every submitted flag before touching the
database. A key absent from `managed-flag-inventory.json`, a type other than the
declared one, or a variant value that fails its registered value schema
(`@shepherdjerred/feature-flags/flag-value-schemas.ts`) refuses the whole
request, writes nothing, and leaves the revision unchanged. Validation runs
before the revision check, so an invalid stale request is 400, not 409:

```json
{
  "error": "invalid flag values",
  "issues": [
    {
      "key": "delivery-lease-seconds",
      "path": "",
      "message": "Too small: expected number to be >=60"
    }
  ]
}
```

`path` is a JSON Pointer into the decoded value (`/1`, `/weights/codex`); `""`
names the whole value.

`diff` compares each deployment with its inventory projection and returns
`missing`, `extra`, `drift` (value differs from the declaration), and `invalid`
(`{ key, value, issues }` for a declared variant whose live value fails its
value schema). Invalid live data is reported and never fails the request, so a
value stored before validation existed stays visible until an operator fixes it.

Three read-only management routes serve the [audit trail](#audit). They are
separate from the document, snapshot and evaluate routes, whose shapes runtime
consumers parse strictly and which these routes leave unchanged. They are not
mounted on the evaluation listener. Their response schemas are
`FlagsHistoryResponseSchema`, `FlagsMetadataResponseSchema` and
`FlagsArchiveResponseSchema` in `@shepherdjerred/feature-flags/flags-wire.ts`,
which imports only Zod, so the browser UI can parse them too.

- `GET /v1/deployments/:catalog/:stage/flags/:key/history?before=<id>&limit=<1-100>`
  returns `{ entries, nextBefore, auditStartedAt }`. `entries` are newest
  first, each `{ id, at, action, actor: { kind, id }, revisionAfter, before,
after }`. `before` and `after` are the stored bodies as written and are not
  re-validated, because an old body may not match today's schema. Pass
  `nextBefore` as `before` for the next page; it is `null` on the last page.
  `limit` defaults to 50. History is kept for retired keys, so it works for a
  key that is no longer live.
- `GET /v1/deployments/:catalog/:stage/metadata` returns `{ deployment,
auditStartedAt, flags }` with one entry for each live key: the inventory's
  `purpose`, `owner`, `namespace` and `source` when the key is in the inventory,
  `declared` (whether this deployment's inventory projection declares it),
  `createdAt` with its `createdAtBasis`, and `lastChangedAt` / `lastChangedBy`
  from the latest audit row (`null` when nothing was recorded). The
  `createdAtBasis` values are:
  - `recorded`: the latest `create` row, so a re-created key shows its new
    time.
  - `first-declared`: the [legacy date](#legacy-added-dates).
  - `on-or-before`: a legacy date for a key that was already in the
    inventory's first commit.
  - `unknown`: there is no date (`createdAt: null`).
- `GET /v1/archive` returns `{ deployments: [{ id, flags: [{ key, retiredAt,
retiredBy, final, revision, basis }] }] }`. `recorded` entries are keys whose
  latest audit row is a `retire` and that are not live. `final` is the body
  that was deleted, and `revision` is the document revision the retire
  produced. `declared-retired` entries are keys that `retired-flag-declarations.ts`
  retires from a stored deployment, that are not live, and that have no retire
  row: they were deleted before the audit trail, so `retiredAt`, `retiredBy`,
  `final` and `revision` are `null`.

Startup seeds missing deployments from the managed inventory once. Any document
already stored in SQLite is left alone across restarts. Namespace and
environment pairs that no deployment reads, including unused beta copies, are
reported and not seeded.

## Audit

Every write that changes a flag appends a `flag_audit` row inside the write's
own SQLite transaction. If the write is refused, conflicts or fails, no row is
recorded. Each row holds the time, deployment, key, action, actor, the document
revision after the write, and the before and after bodies.

- `apply` records `create` (no stored body) or `update` for each flag that
  differs from the stored body, compared with `isDeepStrictEqual`. A flag that
  is identical to the stored body gets no row, though the revision still
  advances as before.
- `create-missing` and seeding record one `create` for each key actually
  inserted. The steady state (the startup seed and the two-minute
  `flag-inventory-sync` with nothing missing) writes nothing.
- `retire` records a `retire` row with the deleted body as `before`, before
  the delete. Retire stays a hard delete: the flag row is gone, so the
  inventory sync's re-read and `create-missing` behave as before. The audit
  table has no foreign key to `flag`, so history survives the delete.

Every store writer requires an actor, so an unattributed write does not
typecheck:

- `human`: the verified tailnet login. An `X-Flags-Actor` header is ignored.
- `machine`: the `X-Flags-Actor` header, when it matches
  `^[a-z0-9][a-z0-9._@-]{0,63}$` (for example `check-flag-inventory`).
  Every token holder shares one credential, so the label is advisory: it names
  the caller and does not authenticate it. A missing or malformed label never
  fails the write. The write is recorded as `unknown` and logs a structured
  warning that does not include the header value.
- `system`: `seed`, for the startup inventory seed.

### Migrations

`src/migrations.ts` holds numbered, additive steps gated by
`PRAGMA user_version`. On open, after the WAL pragma and the original
`CREATE TABLE IF NOT EXISTS` statements, each pending step runs in one
`BEGIN IMMEDIATE` transaction together with its `user_version` bump, so a
failed step leaves the schema and version unchanged and the process fails to
start. A database whose version is newer than the image knows is refused.
Version 1 adds `flag_audit`, its `(deployment_id, key, id)` index, and
`store_meta` with `audit_started_at`, the time the step ran. Existing
`deployment` and `flag` rows are untouched, so the production database at
`/var/lib/flags/flags.sqlite` upgrades in place on the next start. Changes made
before `audit_started_at` have no history.

### Legacy added dates

Keys created before the audit trail have no `create` row.
`src/legacy-flag-dates.json` gives each inventory key the first-parent
committer date of the first `main` commit whose `managed-flag-inventory.json`
declares it. Keys that were already in that file's first commit (`0f6a972c1c`,
2026-08-25) are marked `onOrBefore`, because they were declared earlier
elsewhere. The file is frozen evidence: it was generated once with
`bun run generate-legacy-flag-dates` in `packages/flags` and is never
regenerated in CI. Keys added later get a recorded `create` row instead. It is
Zod-validated when it is imported.

## Operator

The browser UI is served by this process and uses the shared console look from
`@shepherdjerred/console-ui`. The workspace button at the top of the sidebar is
the app switcher: it lists the other consoles and tools from `ops-model`'s
`CONSOLE_LINKS` and opens them in the same tab; the search button beside it
opens the ⌘K palette. Below them a Views group links Overview, Compare and Drift
(with the total drifted-item count), then the sidebar lists real deployments
with their flag counts: prod-only catalogs are one row, and Scout and Karma are
grouped with Beta and Prod rows. Below 900px the sidebar is replaced by the
shared top bar: the app switcher, a search button and a menu whose drawer lists
the same views and deployments.

Every page is built from the console-ui page kit, the way Hub's and Go link's
pages are: a `PageBody` with a `PageHeading`, then `SummaryGrid` and `Card`s. A
deployment's heading names the catalog and stage and shows its revision, a drift
badge linking to its section of the drift page, and "Compare with Beta/Prod"
when the catalog has both stages. The flag table lists each flag's key, its
state (an On, Off or Targeted `SeverityBadge`, or the variant string) and its
type. The search field filters flags by key and keeps the filter in the `?q=`
query, so it survives choosing a flag. Choosing a flag opens its editor beside
the table.

Navigation is client-side (`react-router`): the sidebar, the drawer, flag rows
and the "All flags" link change the URL without reloading the page, and choosing another flag in the same deployment reuses the loaded
document. While another deployment loads, the previous table stays on screen,
dimmed and `aria-busy`, under the new deployment's header. The tab title names
the open flag and deployment, e.g. `dares_enabled · scout/prod · Flags`.

The views:

- **Overview** (`/`): totals and one card per catalog with each stage's flag
  count, revision and drift.
- **Compare** (`/compare?left=<catalog/stage>&right=<catalog/stage>`): two
  deployments' documents, every key classified as differs, only-left,
  only-right or identical (`sameFlag`). The Show toggle adds identical rows
  (`?same=1`), `?q=` filters keys, and `?key=` opens a side-by-side JSON diff
  with links to the flag's editor on either side. With only `left`, its
  catalog's other stage is the default partner.
- **Drift** (`/drift`): `GET /v1/diff` (parsed with `FlagsDiffResponseSchema`
  from `@shepherdjerred/feature-flags/flags-wire.ts`) as totals and one
  section per drifted deployment, worst first: invalid values with their schema
  issues, declared-versus-live diffs, missing and extra keys, each with the
  documented remediation command. `/drift#<catalog/stage>` scrolls to one
  deployment. A deployment missing from the report fails the request, so the
  page shows the error rather than a partial result.
- **⌘K palette** (console-ui's `CommandPalette`): views, deployments, and flags
  across every deployment. It loads each document under `useDocument`'s query
  key, so documents are shared with the pages.

The deployment list and the drift report refresh when a document arrives at a
revision the list does not show, e.g. after a save.

### Editing modes

The editor has a Form / JSON toggle over one draft. Switching modes never loses
an edit: the JSON text is rebuilt from the draft only when the form changed it,
so text that does not parse yet is still there when you switch back.

- **Form** shows typed controls: a boolean flag's default and segments; a
  variant's stored string in a number field (`number` encoding), a wrapping
  text area (`json` encoding), or a text field (`string` encoding).
- **JSON** edits in Monaco. A boolean flag is edited as its whole object, with
  `type` and `key` fixed by the schema. A `json`-encoded variant is edited as
  its decoded value, pretty-printed (an array, not a one-line string), and
  saved compactly with object defaults filled in. `number` and `string`
  variants are edited as a JSON number or string literal.

`json`-encoded variants open in JSON mode; everything else opens in Form mode.
A variant whose key is not in the value registry is shown as plain text with a
notice that the server rejects writes to unmanaged keys.

Monaco is bundled locally with only its JSON language and loads, with its two
workers, the first time an editor or diff is shown. The flag table never loads
it. Its colours and monospace font come from the `console-ui` tokens of the
current theme.

### Validation

JSON mode validates as you type against a JSON Schema. For variants this is
`flag-value-schemas.generated.json` from `@shepherdjerred/feature-flags`. For
boolean flags it is the flag schema (`src/schema.ts`). Schema errors show as
squiggles with hover messages. The draft is also checked against the registry's
Zod schema, the same check the server runs. Its issues are listed under the
editor by JSON Pointer path. Review stays disabled while the JSON does not parse
or the value fails the registry. If the server still refuses a save with
`400 invalid flag values`, its issues are listed the same way until the draft
changes.

### Saving

"Review save" opens a dialog with a read-only Monaco diff of the stored value
against the draft: side by side when there is room, inline when narrow.
`json`-encoded variants are diffed as their decoded values. Save writes that
revision. A conflicting write is left unchanged: a warning above the form diffs
their flag against the draft, with a button to load theirs.

`toolkit flags` is the command surface. See `packages/toolkit/README.md`.

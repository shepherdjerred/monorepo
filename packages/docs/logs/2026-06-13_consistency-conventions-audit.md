---
id: log-2026-06-13-consistency-conventions-audit
type: log
status: complete
board: false
---

# Consistency & Conventions Audit — 2026-06-13

## Status Notes (Historical)

Complete (findings doc). Scope: first-party `packages/`, `scripts/`, `.dagger/`. Excludes `archive/`, `practice/`, `poc/`,
`packages/discord-video-stream/`, generated/build output. Remediation tracked in `plans/2026-06-13_code-quality-remediation.md` (§3/§9).

**Headline:** the codebase does the same kind of thing in different ways across several dimensions. Many divergences already
have a written custom rule in `packages/eslint-config/src/rules/` that is enabled **only in scout** — so converging is mostly
"enable the existing rule in the base config." Prioritize by (maintainability cost removed) × (ease of enforcement).

## 1. Network / subprocess timeouts (highest value)

Three idioms coexist; many outbound `fetch` calls have no timeout.

- **Variant A — `AbortSignal.timeout(ms)`** (preferred): `trmnl-dashboard/src/clients/*` (uniform 8000ms — the gold
  standard), `temporal/src/activities/cancel-buildkite-builds.ts:90,122`, `streambot/src/{metadata/tmdb.ts:109,sources/probe.ts:95}`,
  `scout-for-lol/packages/backend/src/storage/s3-query.ts:261`, `birmel/src/voltagent/message-stream.ts:82`.
- **Variant B — manual `AbortController` + `setTimeout`**: `monarch/src/lib/monarch/graphql.ts:70-95`,
  `tasks-for-obsidian/src/data/api/TaskNotesClient.ts:228-253`, `temporal/src/activities/deps-summary.ts:136`,
  and `scout .../s3-query.ts:158-180` (**same file mixes A and B** — strongest single-file inconsistency).
- **Variant C — no timeout (risk surface)**: `toolkit/src/lib/{grafana,pagerduty,bugsink}/client.ts` (3 near-identical
  clients, none time out), `scout .../trpc/auth-web.ts:243,270` (Discord OAuth), `tasks-for-obsidian/src/screens/SettingsScreen.tsx:47`,
  `monarch/src/lib/conservice/client.ts:106`, `llm-observability/src/archive-uploader.ts:180` (S3 PUT), `webring/src/fetch.ts`.

**Standard:** Variant A with a package-level default. **Enforce:** new custom rule `require-fetch-timeout` (flag `fetch(`/S3
`send` lacking `signal`/`abortSignal`).

## 2. Logging

Six bespoke "shared logger" modules + tslog + winston + raw `console.*`. Three bespoke OTel-JSON loggers are near-identical
(copy-paste drift): `birmel/src/utils/logger.ts`, `temporal/src/observability/log.ts`, `streambot/src/util/logger.ts`.
Misuse — `logger.info` for errors: `scout .../discord/commands/subscription/add.ts:52`, `scout .../trpc/auth-web.ts:206`,
`discord-plays-pokemon/.../discord/message-handler.ts:23`.

**Standard:** extract the 3 OTel-JSON loggers into one shared module (param by service name). **Enforce:**
`prefer-structured-logging` already exists but is scout-only — enable it in the long-running services.

## 3. Zod / validation

- `z.date()` vs `z.coerce.date()`: **bug** at `sjer.red/src/content/schemas/event.ts:12` (`z.date()` while sibling
  `index.ts:6` uses `z.coerce.date()`; Astro frontmatter is string-sourced). Other `z.date()` (scout IndexedDB) are fine.
- `.parse` vs `.safeParse`: varies by package; both legitimate (trusted internal ⇒ `parse`, untrusted edge ⇒ `safeParse`).
  Note scout's CLAUDE.md mandates `safeParse` but has 306 `.parse` sites.

**Action:** fix `event.ts:12` now; codify the boundary rule; a narrow lint rule for bare `z.date()` under `content/schemas/**`.

## 4. Error-return style

`Result<T,E>` (hand-rolled in `tasks-for-obsidian/src/domain/result.ts`) vs ad-hoc `{ success, data?, error? }` envelopes
(toolkit's 5 near-identical clients; birmel agent-tools) vs throwing (temporal/monarch) vs `null`/`undefined`.
**Action:** collapse the 5 toolkit clients into one `ClientResult<T>` + `request<T>()` (also fixes their timeouts). Not
broadly lint-enforceable.

## 5. Config / env access

- `Bun.env` (standard) vs `process.env` holdouts (leetcode, sjer.red, better-skill-capped, dotfiles).
- Validated config module (`env-var` in scout/starlight; bespoke `src/config` elsewhere) vs direct access.
- **One real bug:** `leetcode/src/lib/leetcode-graphql.ts:1-2` top-level `process.env["CSRF_TOKEN"]!` / `LEETCODE_SESSION!`
  (everyone else guards). **Enforce:** new `no-non-null-env` rule + enable `prefer-bun-apis` in the 4 holdouts.

## 6. Async — healthy

`.then()` chains effectively absent in long-running services; `Promise.all`/`allSettled` used where it matters. **Enable
`prefer-async-await` repo-wide** (already passes; zero-cost lock-in). Cheapest win.

## 7. Module / file conventions

- File naming: kebab enforced (`unicorn/filename-case`); tasks-for-obsidian PascalCase is a sanctioned RN override.
- Test files: `.test.ts` standard; **location inconsistent** (colocated vs `__tests__/` vs `test/`).
- Barrels: `no-re-exports` enforced in scout, contradicted in birmel/homelab/temporal (63 barrels) — **decide once**.
- Default vs named exports: named is standard; already consistent.

## 8. HTTP server framework

Hono (modern; temporal, tasknotes-server) vs raw `Bun.serve` (single-route servers — appropriate) vs **express** (the two
discord-plays backends — the only express in the repo). **Standard:** Hono for multi-route, `Bun.serve` for single. Migrate
the 2 express servers (low urgency).

## 9. Date/time

`date-fns` only in scout (enforced via scout-only `prefer-date-fns`); native `Date` elsewhere (mostly `toISOString()` —
fine). **Keep date-fns scoped to packages doing real date math**; don't force it repo-wide.

## Top conventions to standardize (prioritized)

1. Fetch timeouts → `AbortSignal.timeout` + `require-fetch-timeout` rule.
2. Enable already-written scout-only rules repo-wide (`prefer-async-await`, `prefer-structured-logging`, `prefer-bun-apis`).
3. Collapse 3 OTel loggers + 5 toolkit clients (architectural).
4. Ban non-null env + bare `process.env` in Bun packages (`no-non-null-env` + `prefer-bun-apis`).
5. Fix `z.date()` content-schema bug + codify parse/safeParse boundary rule.
6. Decide barrel-file + test-location policy once.
7. Migrate the 2 express webservers.

**Leave alone (harmless):** kebab filenames (enforced), named exports (consistent), `.then` chains (gone), `toISOString()`
timestamps.

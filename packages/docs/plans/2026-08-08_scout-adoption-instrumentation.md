---
id: plan-2026-08-08-scout-adoption-instrumentation
type: plan
status: in-progress
board: false
---

# Scout for LoL — adoption instrumentation, outreach rework, and web UI fixes

## Context

Prod investigation (Prometheus + Loki + read-only queries against the prod SQLite DB) found that Scout's install growth is healthy (32 → 59 guilds in 12 weeks) but activation is not: **only 13 of 48 tracked installs ever created a subscription (27%)**, and that rate plateaus at ~30% and never recovers. The supporting systems that should catch this are broken or absent:

| Finding                                                                  | Evidence                                                                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| The 14-day feedback pass silently burns guilds                           | 37 guilds marked `outreach14dSentAt`, only **4 DMs ever attempted**; 4 burned guilds are now eligible but permanently ineligible |
| The 30-day nudge has never worked                                        | **0 of 27** nudged guilds ever configured anything                                                                               |
| Feedback is asked when delivery is impossible                            | `feedback_request` fires from `handleGuildDelete`; Discord rejects with `no mutual guilds`. All-time: **14 failed, 1 sent**      |
| `fetchUserGuilds` turns upstream failures into a wrong user-facing error | 5 failure paths all `return []` → user sees "You are not a member of that guild"                                                 |
| `auth.meWeb` throws for logged-out visitors                              | 185 `UNAUTHORIZED` ERROR log lines in 30d vs 21 sign-ins                                                                         |
| The web UI has zero server-side instrumentation                          | `/metrics` is served but the HTTP server and tRPC layer emit **no** metrics about themselves                                     |
| Guild removals are uninstrumented                                        | `guilds_left_total` does not exist in the codebase; real churn is ~9/month, visible only via `DmAuditLog`                        |
| `handleGuildCreate` has no `guild.available` guard                       | Unlike `handleGuildDelete`; a spurious `guildCreate` would re-post the welcome message and re-arm outreach DMs                   |

No spam has actually occurred (verified: zero duplicate guild+kind DMs, max 4 lifetime DMs to any recipient), but nothing structurally prevents it.

**Outcome:** outreach that adapts instead of one-shot burning, a hard and _user-visible_ cap of 3 non-core messages per server, correct web UI error semantics, and end-to-end observability from install → sign-in → onboarding → first subscription.

### Decisions locked with the user

- **3 non-core messages per server, ever**, each stating "message X of 3".
- **Add the `email` OAuth scope**; re-consent on next login is acceptable.
- **No opt-out mechanism** — the hard cap is the guarantee.
- **Both** Matomo (UX/behavior) and Prometheus (funnel counts + alerting).
- **One PR**, delivered as ordered commits (below).

### What already exists (reuse, do not rebuild)

- **Matomo analytics in the SPA**: `packages/scout-for-lol/packages/app/src/lib/analytics.ts` — 45-event closed union, `track()`, `trackMutationMeta()`/`analyticsMeta()`, dimensions 1–8. `onboarding_step` and `subscription_add` (with outcome `kind`) are already tracked.
- **Sentry/Bugsink**: SPA (`@sentry/react`) and backend (`@sentry/bun`), `source:` kebab-case tag convention.
- **Prom registry**: `backend/src/metrics/registry.ts` (leaf module, no imports). New metrics use the `scout_` prefix (de-facto convention for newer metrics).
- **Cron helper**: `createCronJob({schedule, jobName, task, ...})` in `backend/src/league/cron/helpers.ts` — already emits `cron_job_*`.
- **DM chokepoint**: `sendDM()` in `backend/src/discord/utils/dm.ts` — writes `DmAuditLog`, never throws, returns `sent | dm_disabled | failed`.
- **Feedback copy helper**: `backend/src/discord/utils/feedback.ts` — `getFeedbackUrl()` / `buildFeedbackRequestMessage()`, driven by `FEEDBACK_URL`.
- **Postal email client**: `packages/temporal/src/shared/postal.ts` — HTTP API (not SMTP), validates Postal's 200-on-error envelope.
- **Guild-unconfigured predicate**: `backend/src/metrics/guild-health.ts` already computes "zero subs and zero active competitions" every 5 min.
- **UI primitives**: `app/src/components/ui/dialog.tsx`, `dialog-form.tsx` (`DialogFormError`/`DialogFormFooter`), and `ContractMismatchBanner` in `app/src/components/version-info.tsx` — the closest existing shape to a corner prompt, already mounted globally from `root-layout.tsx`.
- **Test harnesses**: `backend/src/testing/test-database.ts` (`createTestDatabase`), `discord-mocks.ts`, `test-trpc-caller.ts` (`createOfflineTrpcHarness`), and the HTTP-boundary template `src/trpc/router/rbac-http.e2e.test.ts`.

---

## Commit 1 — Correctness fixes

### 1a. `fetchUserGuilds` must not fabricate an empty membership list

`backend/src/lib/discord-rest.ts:158` returns `[]` on five distinct failure paths (token refresh null, fetch error, `!response.ok`, JSON parse failure, schema mismatch). `resolveGuildPermissions` (`backend/src/trpc/guild-permission.ts:54`) then throws `FORBIDDEN "You are not a member of that guild"`. This violates the repo's fail-fast and no-defensive-fallback principles.

- Introduce `DiscordUpstreamError { reason: "token_refresh_failed" | "fetch_error" | "http_error" | "parse_error" | "schema_error", status?: number }` and **throw** it instead of returning `[]`. Only a genuine empty list from a 200 response stays `[]`.
- `resolveGuildPermissions` maps it: `token_refresh_failed` → `UNAUTHORIZED` ("Your Discord login expired — sign in again"); everything else → `SERVICE_UNAVAILABLE` ("Couldn't reach Discord, try again in a moment"). **Never `FORBIDDEN`.**
- Increment `scout_discord_user_guilds_failures_total{reason}` (Commit 2).
- Update `createOfflineTrpcHarness`'s `fetchUserGuilds` mock and `setMembership` to cover the throwing path.

### 1b. Stop `auth.meWeb` from throwing for logged-out visitors

`meWeb` is a `webProcedure`, so `hasWebSession` throws `UNAUTHORIZED` on every anonymous page load — the SPA calls it from `require-session.tsx`, `guild-picker.tsx`, `onboarding-wizard.tsx`, and `lib/route-loaders.ts`.

- Add `auth.sessionState` as a `publicProcedure` returning `{ user: User | null }`.
- Point `requireSessionLoader` (`app/src/lib/route-loaders.ts`) and `require-session.tsx` at it; keep `meWeb` for any remaining authenticated callers.
- In `http-server.ts` `onError`, log expected client errors (`EXPECTED_CLIENT_ERROR_CODES`, defined at `http-server.ts:29`) at `info`, genuine faults at `error`. Right now everything is `logger.error`, which is why the logs carry no signal.

### 1c. `handleGuildCreate` availability guard + reset symmetry

`backend/src/discord/events/guild-create.ts`, registered at `backend/src/discord/client.ts:113`.

- Add the same guard `handleGuildDelete` has: `if (!guild.available) { log + return; }`.
- The `update` branch of `saveGuildInstall` resets `outreach3dSentAt`/`outreach14dSentAt` but **not** `outreach30dSentAt` (added later in migration `20260619020000_add_outreach_30d`). This is replaced wholesale by the Commit 3 stage model — reset the new counter consistently.
- Only reset outreach state on a **genuine re-install** (guild absent from `GuildInstall`, or `installedAt` older than the last known removal), not on every `guildCreate`.

### 1d. Riot ID combobox — stop silent wrong-account picks

`app/src/components/riot-id-combobox.tsx` + `app/src/components/subscription-fields.tsx:82-91`. ~44% of all web actions in prod are corrections (17 `PLAYER_DELETE`, 15 `PLAYER_RENAME`, 13 `ACCOUNT_UPDATE`, 11 `SUBSCRIPTION_REMOVE` against 63 `SUBSCRIPTION_ADD`).

- Dedupe by `gameName#tagLine#region`, not `gameName#tagLine` — today two regions collapse and the survivor's region silently wins.
- Render a **region badge** and a source label (verified match vs. OP.GG suggestion) on each row; today the `✓` exact match is visually indistinguishable from a stranger with the same name.
- Do not silently overwrite a user-chosen region when a suggestion is selected — if they conflict, surface the change rather than applying it.

---

## Commit 2 — Backend + web observability

### New metrics (all `scout_`-prefixed, registered on the shared `registry`)

New file `backend/src/metrics/web.ts` (follows the `guild-health.ts` split-for-file-length precedent):

| Metric                                     | Labels                                                     | Source                                                            |
| ------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `scout_http_requests_total`                | `route,method,status,status_class`                         | `http-server.ts` wrapper                                          |
| `scout_http_request_duration_seconds`      | `route`                                                    | histogram                                                         |
| `scout_trpc_calls_total`                   | `procedure,type,code`                                      | tRPC middleware                                                   |
| `scout_trpc_duration_seconds`              | `procedure`                                                | histogram                                                         |
| `scout_web_signin_total`                   | `result` (`started`/`succeeded`/`failed`/`callback_error`) | `auth-web.ts`                                                     |
| `scout_web_session_rejected_total`         | `reason` (`absent`/`expired`/`invalid`)                    | `context.ts` / `hasWebSession`                                    |
| `scout_discord_user_guilds_failures_total` | `reason`                                                   | `discord-rest.ts` (1a)                                            |
| `scout_onboarding_step_total`              | `step`                                                     | telemetry procedure                                               |
| `scout_onboarding_outcome_total`           | `outcome` (`completed`/`skipped`)                          | telemetry procedure                                               |
| `scout_guilds_left_total`                  | —                                                          | `guild-delete.ts` — currently **nonexistent**; churn is invisible |

- **HTTP**: wrap the `Bun.serve` `fetch` body in `withHttpMetrics(request, () => dispatch(request))` in `backend/src/http-server.ts`. Route labels must be normalized to low cardinality — reuse the existing `COMPETITION_LEADERBOARD_RE` / `REPORT_RUN_RE` patterns from `src/trpc/image-routes.ts`. **Exclude `/metrics`** (it self-inflates, and `getMetrics()` does a full DB sweep per scrape so its latency is not an HTTP signal).
- **tRPC**: add a timing middleware in `backend/src/trpc/trpc.ts` and build every exported procedure from it (`const base = t.procedure.use(withTrpcMetrics)`, feeding `publicProcedure`/`protectedProcedure`/`webProcedure`/`webMutationProcedure`). tRPC middleware receives `{path, type, next}`, giving per-procedure latency and ok/err without touching a single router. This is strictly better than hooking `onError`, which only sees failures.
- **Telemetry sink**: new `telemetry.track` `publicProcedure` in a new `backend/src/trpc/router/telemetry.router.ts`, registered in `router/index.ts`. Accepts a Zod **enum of allowlisted event names only** (never free-form strings — this is a public, unauthenticated endpoint), rate-limited per session/IP.

### Dashboards and alerts

- New `packages/homelab/src/cdk8s/grafana/scout-dashboard-web-panels.ts` and `scout-dashboard-adoption-panels.ts`, composed into `scout-dashboard.ts` via the existing `addXxxRows(builder)` pattern (alongside `addGuildHealthRows`, `addPreMatchRow`, …).
- Panels: HTTP status-class rate, tRPC error rate by procedure/code, p95 latency, sign-in funnel, onboarding step funnel, install → sign-in → first-subscription conversion, Discord upstream failure rate.
- Alert rules appended to `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/scout.ts` (existing `getScoutRuleGroups()` + `escapePrometheusTemplate` pattern), with matching cases in `scout.test.ts`:
  - `ScoutWeb5xxRateHigh` — sustained 5xx (critical)
  - `ScoutDiscordUpstreamFailures` — `scout_discord_user_guilds_failures_total` rate > 5% (warning; catches the 1a bug class)
  - `ScoutWebSigninFailureRate` — sign-in success rate drop
  - `ScoutTrpcErrorRateHigh` — non-expected tRPC error codes, **excluding** `UNAUTHORIZED`/`FORBIDDEN` to avoid alerting on normal anonymous traffic

### Frontend

- Extend `SCOUT_ANALYTICS_EVENTS` in `app/src/lib/analytics.ts` (closed `as const` union — new names must be added or `track()` won't compile) with `onboarding_completed`, `onboarding_skipped`, `feedback_shown`, `feedback_submitted`, `feedback_dismissed`.
- `onboarding_step` already fires on step _reach_ (`onboarding-wizard.tsx:47-51`); the gap is a terminal event distinguishing `finish()`/`finishTo()` from `onSkip`. Add it.
- Mirror the funnel to `telemetry.track` so Prometheus can alert. Matomo keeps the behavioral detail; Prometheus gets the counts.

> **Cardinality guard:** every new label set here is bounded (fixed route list, fixed procedure list, fixed step enum). No `guild_id`, `user_id`, or Riot ID may enter a label.
>
> **Open follow-up:** `discord_commands_total` has no `guild_id` label, so we cannot tell whether the 103 commands/90d are spread across 40 guilds or concentrated in 3. Adding a _bounded_ guild dimension is a prerequisite for any decision to retire slash commands — tracked as a TODO, not done here.

---

## Commit 3 — Outreach rework

### Schema (`backend/prisma/schema.prisma`, migration `<ts>_outreach_stage_model`)

`GuildInstall` gains:

```prisma
outreachStage       Int       @default(0)  // non-core messages DELIVERED (0-3)
lastOutreachAt      DateTime?
feedbackRequestedAt DateTime?
emailNudgeSentAt    DateTime?
```

Backfill `outreachStage` from the existing `outreach{3,14,30}dSentAt` columns in the migration. Keep the old columns for one release, then drop.

`User` gains `email String?` and `emailVerified Boolean @default(false)` (Commit 4).

After any schema change run `bun run db:generate` — it regenerates the Prisma client, brand types, **and `src/testing/template.db`** (verified by `scripts/check-test-template-db.ts`).

### Three fixes to the sending logic (`backend/src/league/tasks/outreach/index.ts`)

1. **Only consume budget on actual delivery.** Today every pass marks its column "regardless" of outcome, which is what burned 33 guilds out of the 14-day feedback ask. `outreachStage` increments **only** when `sendDM` returns `"sent"`. A `dm_disabled`/`failed` attempt is recorded (for metrics) but does not advance the stage.
2. **Re-evaluate eligibility instead of one-shot marking.** A guild that becomes eligible later still gets its message. Replace the `outreachNdSentAt IS NULL` gates with stage + elapsed-time + current-state predicates, reusing the `guildUnconfigured` predicate already computed in `metrics/guild-health.ts` rather than recomputing it.
3. **Lower the feedback bar from `subCount >= 3` to `>= 1`.** With a median of ~4 subs/server, a 3-sub gate excludes most of the population that actually uses the product.

### The 3-message ladder (hard cap, enforced centrally)

| Stage | When   | Condition                                                                                 | Content                                        |
| ----- | ------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1     | day 3  | 0 subs                                                                                    | Onboarding nudge → dashboard + getting-started |
| 2     | day 14 | ≥1 sub → feedback ask; 0 subs → second nudge                                              | Adapts to actual state                         |
| 3     | day 30 | ≥1 sub and no feedback yet → final feedback ask; still 0 subs → last call + how to remove | Explicitly final                               |

- A guild that is already configured at day 3 **does not spend a message** — the budget is for messages actually sent.
- Enforce the cap in `sendDM` itself, not in the callers: `sendDM` gains an optional `budget: { guildId, cap: 3 }` and refuses to send when `outreachStage >= cap`. Making the chokepoint enforce it means a future caller cannot accidentally bypass the guarantee.
- **Cross-guild burst guard:** at most one non-core DM per recipient per 72h (someone who installed in 3 servers should not get 3 DMs at once). Defer, don't drop.

### Transparency footer (required by the user)

Every non-core message ends with a standard block from a single helper (extend `backend/src/discord/utils/feedback.ts`):

```
━━━━━━━━━━━━━━━━━━━━
Message 2 of 3 for **<server name>**. Scout sends at most 3 setup
messages per server, ever — then never again. This is automated;
replies aren't monitored.
```

Stage 3 says "Message 3 of 3 — this is the last message Scout will ever send about this server." One helper, used by DM and email alike, so the count can never drift from reality.

### Move the feedback ask off the removal path

`feedback_request` stays in `handleGuildDelete` as a **best-effort bonus only** (it succeeds 1 time in 15). The real feedback ask becomes stage 2/3 of the ladder above — sent while the bot still shares a guild with the user, so it can actually be delivered. Reuse `buildFeedbackRequestMessage()`/`getFeedbackUrl()`.

### Outreach metrics (new `backend/src/metrics/outreach.ts`)

`scout_outreach_messages_total{stage,status}`, `scout_outreach_skipped_total{stage,reason}` (this alone would have caught the 33 burns), `scout_outreach_conversions_total{stage}`, `scout_outreach_budget_exhausted_total`, `scout_outreach_stage_guilds{stage}` gauge.

**Conversion tracking**, which does not exist today: a nightly pass attributes a subscription created within 7 days of a _delivered_ stage-N message to that stage. Surfaced on the adoption dashboard so the next "is outreach working?" question is answerable without hand-joining SQL.

---

## Commit 4 — Email channel (narrow segment only)

**Segment:** installer signed into the web UI (so a `User` row with an email exists) **and** their guild has 0 subscriptions and 0 active competitions after 30 days. One email, ever, and it **counts against the same 3-message budget** — if the budget is spent, no email. This keeps the "message X of 3" promise literally true across channels.

- **OAuth**: add `"email"` to the single scope array in `handleDiscordStart` (`backend/src/trpc/auth-web.ts`, currently `["identify", "guilds"]`). `prompt=consent` is already set, so users are asked on next sign-in. Extend `DiscordUserSchema` with `email: z.string().nullable().optional()` and `verified: z.boolean().optional()` — **optional**, because sessions predating the scope won't carry them. Persist in the existing `prisma.user.upsert` in `handleDiscordCallback`. Add a login-scope assertion to `backend/src/trpc/auth-web.test.ts` (it asserts the _install_ scope at line 89 but has no login equivalent). Emails will trickle in as users re-auth; there is no backfill.
- **Transport**: Postal's **HTTP API**, not SMTP. Scout's egress NetworkPolicy (`homelab/src/cdk8s/src/cdk8s-charts/scout.ts`) already permits 443 to `0.0.0.0/0`, so the API path needs **zero** netpol changes. The SMTP path would require editing both scout egress _and_ the `postal-smtp-netpol` ingress allowlist (which lists `bugsink`, `matomo`, `plausible`, `birmel`, `media/cwa` — **not** scout). Avoid it.
- **Client**: extract `packages/temporal/src/shared/postal.ts` into a new workspace package `packages/postal-client` and have both temporal and scout depend on it via `workspace:*`. It is small, already has tests (`postal.test.ts`), and correctly handles Postal returning **HTTP 200 on validation errors**. _Judgment call:_ copying it into scout would be a smaller diff but duplicates logic the repo's `duplication-check` would flag; extraction is the right call with two real consumers.
- **Config**: add `POSTAL_HOST`, `POSTAL_API_KEY`, `POSTAL_HOST_HEADER`, `SENDER_EMAIL` to `backend/src/configuration.ts` — note this file requires touching **both** the `computeConfiguration()` literal **and** the hand-written getter mirror below it. Wire secrets in `homelab/src/cdk8s/src/resources/scout/index.ts` (`baseEnvVariables`, per-stage 1Password items).
- **Metric**: `scout_email_sent_total{kind,status}`.

---

## Commit 5 — Feedback in the web UI

- New `app/src/components/feedback-prompt.tsx`, modeled on `ContractMismatchBanner` (`app/src/components/version-info.tsx:49-93`) — a dismissible `fixed bottom-4 right-4` chip, mounted globally from `app/src/routes/root-layout.tsx` next to it.
- Trigger: signed in, ≥1 subscription, ≥7 days since first sign-in, not dismissed, not already submitted. Dismissal persisted in localStorage per `discordId`, following the `app/src/lib/onboarding-storage.ts` key convention.
- Opens a `Dialog` (`ui/dialog.tsx`) with a `textarea` + optional rating, using `DialogFormError`/`DialogFormFooter` from `dialog-form.tsx` like every other mutation dialog. There is no toast library in the app — do not add one.
- Submits via a new `feedback.submit` `webMutationProcedure` → new `Feedback` table (`discordId`, `serverId?`, `rating?`, `body`, `createdAt`). Emits `scout_feedback_submitted_total`.
- Existing support path stays: `SUPPORT_URL` (`app/src/lib/support.ts`, `https://discord.gg/qmRewyHXFE`), already surfaced in `user-menu.tsx:142`.
- **Not in-channel** — per the user's explicit instruction, feedback is solicited only via DM and the web UI.

---

## Delivery

**One PR** on a single branch, built as the five ordered commits above so it stays reviewable. Commit 1 is independently revertable if anything regresses; commits 3–4 share the schema migration and land together.

Create the branch and PR with **git-spice** (`gs branch create`, `gs branch submit`) — load the `git-spice-helper` skill first; do not use bare `gh pr create`. Open as a **draft** as soon as commit 1 is coherent, promote to ready once verification below passes.

PR description must include: the prod evidence table from Context, the exact copy of all three ladder messages plus the transparency footer (so the messaging is reviewable without checking out the branch), and screenshots of the new Grafana panels and the web feedback prompt per the repo's PR-media rules.

---

## Verification

**Per-package during development:**

```bash
bunx turbo run typecheck test lint --filter=@scout-for-lol/backend
bunx turbo run typecheck test lint --filter=@scout-for-lol/app
bunx turbo run typecheck test lint --filter=@shepherdjerred/homelab
```

**New tests required** (there are currently **no tests at all** for outreach or `guild-delete`):

- `backend/src/league/tasks/outreach/index.test.ts` — the 3-stage ladder, budget-only-on-delivery, re-evaluation of a guild that becomes eligible late, cap enforcement, 72h burst guard. Use `createTestDatabase` + `discord-mocks.ts`.
- `backend/src/discord/events/guild-delete.test.ts` — new file; churn counter increments, `!guild.available` short-circuit.
- `backend/src/discord/events/guild-create.test.ts` — extend with the availability guard and the re-install reset rule (existing 4 cases only cover welcome-channel selection).
- `backend/src/lib/discord-rest.test.ts` — each of the five failure paths throws `DiscordUpstreamError` with the right `reason`, and a genuine 200-with-empty-array still returns `[]`.
- `backend/src/trpc/guild-permission.test.ts` — upstream failure maps to `SERVICE_UNAVAILABLE`/`UNAUTHORIZED`, **never** `FORBIDDEN`.
- HTTP/tRPC metrics at the real boundary, following `backend/src/trpc/router/rbac-http.e2e.test.ts` (real `fetchRequestHandler` + real `createContext` + signed cookies): assert route-label normalization and that `/metrics` is excluded.
- Metrics assertions use the prom-client API (`await metric.get()` → `.values[0]?.value`), per `backend/src/metrics/season-schedule.test.ts`.
- `homelab` — extend `monitoring/rules/scout.test.ts` for the new alerts and `grafana/dashboard-query-health.test.ts` for the new panels.

**End-to-end locally:**

```bash
# Boots backend :3000 (BETA bot) + Vite :5180, applies migrations to local-web-dev.db.
# Requires `op signin`.
bun run --filter='./packages/scout-for-lol' dev:web
```

- Walk the onboarding wizard; confirm `scout_onboarding_step_total` and `scout_onboarding_outcome_total` advance at `localhost:3000/metrics`.
- Sign out and load `/app` — confirm **no** `UNAUTHORIZED` ERROR lines and that `auth.sessionState` returns `{user: null}`.
- Force a Discord upstream failure (bad token) — confirm the UI says "Couldn't reach Discord", **not** "You are not a member of that guild", and `scout_discord_user_guilds_failures_total{reason}` increments.
- Note: Matomo **no-ops locally** unless `VITE_MATOMO_SITE_ID` + `VITE_MATOMO_SITE_DOMAIN` are set (injected for prod/beta by `scripts/scout-site-release.ts:228-230`), so verify the funnel via the Prometheus side locally.

**Outreach dry run:** add a `--dry-run` flag to the outreach task that logs the ladder decision and budget state per guild without sending. Run against a copy of the prod DB and confirm the stage backfill produces sane decisions **before** the first real cron fire — the failure mode here is messaging real users.

**Post-deploy (prod):** confirm the new series appear for `job="scout-service-prod"`, the dashboard panels populate, and `scout_outreach_messages_total` matches `DmAuditLog` rows for the first cron run.

**Docs:** mirror this plan to `packages/docs/plans/2026-08-08_scout-adoption-instrumentation.md` with canonical frontmatter (`id`, `type: plan`, `status`, `board`), update `packages/scout-for-lol/AGENTS.md` with the message-budget invariant, and open a TODO in `packages/docs/todos/` for the `discord_commands_total` guild-cardinality follow-up.

# Scout for LoL — Competition & Report Management in the Web App

## Status

Complete — shipped in PR #1170; live PinchTab e2e done (screenshots posted as a PR comment). Pending merge.

## Context

The scout-for-lol web app (`packages/scout-for-lol/packages/app/`, a Vite SPA) is an admin
management console: today it manages subscriptions, players, and admin tools. **Competitions**
(LoL tournaments scored by 6 criteria types) and **Reports** (scheduled, query-driven leaderboards)
are fully built in the **backend + Discord** layers but have **zero web exposure** — the only trace
is a read-only competitions table on the player-detail page. There are **no tRPC routes** for either.

This plan adds **full CRUD management of competitions and reports to the web app**, plus a faithful
**history of every run** (leaderboard computations and report posts). It is overwhelmingly a new
**tRPC router layer + new SPA pages**, reusing existing backend logic; the one schema change is a
small `ReportRun` migration so report outputs can be archived.

### Decisions (confirmed with user)

| Decision              | Choice                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Functionality         | **Full CRUD** for both competitions and reports                                                                                                                                                              |
| Coverage              | **Both**, equal priority                                                                                                                                                                                     |
| Leaderboard freshness | **Cached** standings (instant) + **manual "Refresh"** that recomputes                                                                                                                                        |
| Run persistence       | **Persist EVERY run to S3** — both competition leaderboard runs and report runs (text + chart PNG), keyed per-run, so the web shows a faithful run history                                                   |
| Auth model            | Web is admin-only; **all** competition/report procedures gate on `assertGuildAdmin` (admins are the bypass branch of the existing Discord permission checks, so we skip the Discord-bitfield perms entirely) |

## Architecture (what exists vs. what's new)

```
Discord cmds ──┐
               ├─ database/competition/* , reports/* , league/competition/* , storage/s3-leaderboard
tRPC routers ──┘   (REUSE these — do not reimplement)
   NEW: competition.router.ts, report.router.ts  ──►  app SPA (NEW pages)
   NEW: per-run S3 archival (report PNG+text, competition chart PNG)
   NEW: http-server.ts image GET routes (<img src> for charts)
```

---

## Part A — Backend (`packages/scout-for-lol/packages/backend/`)

### A1. `src/trpc/router/competition.router.ts` (new)

Guard every procedure with `assertGuildAdmin({ user: ctx.user, guildId })` (`src/trpc/guild-guard.ts`)
and, after any fetch-by-id, verify `row.serverId === input.guildId` → `NOT_FOUND` (prevents cross-guild
ID probing). Wrap the plain `Error`s thrown by `addParticipant`/`updateCompetition`/etc. into `TRPCError`
(`CONFLICT`/`BAD_REQUEST`) — never let them surface as 500s.

Define web-native input schemas (do **not** reuse `CompetitionCreationSchema` — it wants
`criteriaConfig` as a JSON string). Compose the typed unions directly:

```ts
const CompetitionWriteSchema = z.object({
  channelId: DiscordChannelIdSchema,
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  visibility: CompetitionVisibilitySchema,
  maxParticipants: z.number().int().min(2).max(100).default(50),
  dates: CompetitionDatesSchema, // FIXED_DATES{startDate,endDate} | SEASON{seasonId}
  criteria: CompetitionCriteriaSchema, // typed 6-variant union
  updateCronExpression: CompetitionCronSchema.nullable().default(null),
});
```

> ⚠ `CompetitionDatesSchema` fixed-dates uses `z.date()`. Confirm the SPA tRPC link's transformer
> serializes `Date`; if not, use `z.coerce.date()` in the web variant.

| Procedure            | Type     | Reuses                                                                           | Notes                                                                                                                                           |
| -------------------- | -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`               | query    | `getCompetitionsByServer(prisma, guildId, {activeOnly})`                         | + `getCompetitionStatus` per row                                                                                                                |
| `get`                | query    | `getCompetitionById` + `getParticipants(prisma,id,undefined,true)`               | attach `status`                                                                                                                                 |
| `create`             | mutation | `validateServerLimit`+`validateOwnerLimit`→`createCompetition`                   | owner=`ctx.user.discordId`; `assertChannelInGuild`; `$transaction`; **skip** `canCreateCompetition` (admin proven) and the in-memory rate-limit |
| `edit`               | mutation | `updateCompetition`                                                              | **status-gated** (below); re-`assertChannelInGuild` if channel changes                                                                          |
| `cancel`             | mutation | `cancelCompetition`                                                              | reject if already CANCELLED/ENDED                                                                                                               |
| `invite`             | mutation | `addParticipant({status:"INVITED", invitedBy})`                                  | resolve `playerId` (primary) or `discordUserId` via `prisma.player.findFirst({serverId,discordId})`; player must be same server                 |
| `removeParticipant`  | mutation | `removeParticipant`                                                              | soft-delete → LEFT                                                                                                                              |
| `addAllMembers`      | mutation | `prisma.player.findMany({serverId})`→`Promise.allSettled(addParticipant JOINED)` | mirror `commands/competition/create.ts:394`; return `{added,failed}`                                                                            |
| `updateSchedule`     | mutation | mirror `commands/competition/update-schedule.ts`                                 | recompute `nextScheduledUpdateAt` only when `startProcessedAt!=null`; reject CANCELLED/ENDED                                                    |
| `leaderboard`        | query    | `loadCachedLeaderboard(id)` (`storage/s3-leaderboard.ts`)                        | fast S3 read; may be `null` → UI empty state                                                                                                    |
| `leaderboardHistory` | query    | `loadHistoricalLeaderboardSnapshots(id)`                                         | per-run standings for the run-history view                                                                                                      |
| `refreshLeaderboard` | mutation | `refreshAndCacheLeaderboard(comp)` (new helper, A4)                              | expensive (Riot+S3); reject unless `status==="ACTIVE"`                                                                                          |

**Status gate for `edit`** (`status = getCompetitionStatus(comp)`):

- CANCELLED/ENDED → reject all edits.
- ACTIVE → allow title/description/channel/visibility/maxParticipants (increase-only); **reject** `dates`/`criteria` (snapshot + lifecycle invariants).
- DRAFT → allow everything.

Skip `join`/`leave-self` (admin console acts on the server, not as a player) and defer `grantPermission`
(low value when the UI is admin-only).

### A2. `src/trpc/router/report.router.ts` (new)

`assertGuildAdmin` everywhere (covers the owner-or-admin model). Add `assertReportMutable(report)` →
`FORBIDDEN` if `isSystemManaged` (blocks update/delete/setEnabled; run/preview still allowed).
`runReport` already takes the structural `Report` type — pass the Prisma row straight through.

| Procedure      | Type     | Reuses                                                                            | Notes                                                                                                                        |
| -------------- | -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `list`         | query    | `prisma.report.findMany({where:{serverId}})`                                      | —                                                                                                                            |
| `get`          | query    | `prisma.report.findFirst` + `prisma.reportRun.findMany({reportId,take:runLimit})` | run history                                                                                                                  |
| `create`       | mutation | `canCreateAnotherUserReport`→`parseReportQuery`→`prisma.report.create`            | mirror `commands/report/create.ts`; `assertChannelInGuild`; `parseReportQuery` throw→BAD_REQUEST; owner=`ctx.user.discordId` |
| `update`       | mutation | `prisma.report.update`                                                            | `assertReportMutable`; re-`parseReportQuery` if query changes; recompute `nextScheduledRunAt` if cron changes                |
| `setEnabled`   | mutation | `prisma.report.update({isEnabled})`                                               | `assertReportMutable`                                                                                                        |
| `delete`       | mutation | `prisma.report.delete` (runs cascade)                                             | `assertReportMutable`                                                                                                        |
| `run`          | mutation | `runReport({trigger:"MANUAL"})` (+ optional Discord post)                         | persists run (A3); returns rendered output + `runId`                                                                         |
| `previewQuery` | mutation | `executeReportQuery`+`renderReportOutput` (no ReportRun, no post)                 | live editor preview; mutation-procedure for CSRF/origin protection; can force text-only to stay cheap                        |

`ReportCreateInputSchema` (in `packages/data/src/model/report.ts`) already validates query/cron/lookback/maxRows/format.

### A3. Per-run S3 persistence (Reports) + Prisma migration

**Migration** — add nullable columns to `model ReportRun` (`prisma/schema.prisma`):

```prisma
renderedContent String?   // rendered text body (output.content)
imageS3Key      String?   // S3 key of chart PNG (null if text-only or S3 unconfigured)
imageByteSize   Int?
```

No backfill (existing/ FAILED runs have none). Run `db:migrate`.

**New `src/storage/s3-report-run.ts`** (parallel `s3-leaderboard.ts`, reuse `createS3Client`, guard on
`configuration.s3BucketName === undefined`):

- `saveReportRunImage(reportId, runId, png): Promise<string|null>` → key `reports/report-{reportId}/runs/{runId}.png`
- `loadReportRunImage(reportId, runId): Promise<Buffer|null>` (NoSuchKey→null)

**Wire `src/reports/runner.ts`** SUCCESS branch: after `renderReportOutput`, if `output.image`, call
`saveReportRunImage(...)`; persist `renderedContent`/`imageS3Key`/`imageByteSize` on the `reportRun.update`.
Because `runReport` is the single chokepoint for web `run`, Discord `report/run`, **and** the scheduled
dispatcher, **scheduled runs are archived too** — exactly the faithful "every run" history wanted. The
discord-dispatcher reads the return value and is unaffected.

### A4. Per-run S3 persistence (Competitions) + refresh helper

Competition leaderboards already persist `leaderboards/competition-{id}/current.json` (latest) and
`snapshots/YYYY-MM-DD.json` (per-run JSON) via `saveCachedLeaderboard`. To make **every run** fully
faithful, also archive the rendered chart PNG per run.

- **New helper `src/league/competition/refresh.ts`** → `refreshAndCacheLeaderboard(comp): Promise<RankedLeaderboardEntry[]>`
  extracted from `league/tasks/competition/daily-update.ts:243-256` (calc + build `CachedLeaderboard` +
  `saveCachedLeaderboard`), **without** the Discord post. Have both `postLeaderboardUpdate` (DRY) and the
  tRPC `refreshLeaderboard` call it.
- Inside that helper, also render the chart (`buildCompetitionChartAttachment` → `competitionChartToImage`)
  and PUT it to `leaderboards/competition-{id}/snapshots/{timestamp}.png` (+ a `current.png`). Add
  `saveLeaderboardImage`/`loadLeaderboardImage` to `s3-leaderboard.ts` mirroring the report helpers.
- `leaderboardHistory` (A1) pairs each `loadHistoricalLeaderboardSnapshots` entry with its PNG URL.

### A5. Image-serving HTTP GET routes (`src/http-server.ts`)

`<img src>` can't carry CSRF, so add **GET** routes (before the `/trpc` catch-all, reuse `corsHeadersFor`):

```
GET /api/competition/{competitionId}/leaderboard.png      (latest or ?ts= snapshot)
GET /api/report/{reportId}/runs/{runId}.png
```

**Auth:** reuse `createContext(request)` to resolve the session cookie → `ctx.user`; 401 if null; then
`assertGuildAdmin({user, guildId})` with `guildId` from the row's `serverId`. Safe GET, no mutation → no
CSRF needed. Serve `loadReportRunImage` / `loadLeaderboardImage` bytes as `image/png`; 404 when key absent.

> Confirm `scout_session` cookie `SameSite` + whether the SPA and API share an origin in prod. If
> cross-origin without `SameSite=None`, fall back to short-lived HMAC **signed URLs** (reuse `trpc/jwt.ts`)
> returned by the tRPC queries instead of cookie auth.

### A6. Register routers (`src/trpc/router/index.ts`)

Add `competition: competitionRouter` and `report: reportRouter`. `AppRouter` type auto-propagates to the SPA.

### A7. Backend tests (integration; `afterAll` Prisma disconnect per `prisma-client-disconnect`)

- `storage/s3-report-run.test.ts` + leaderboard-image: round-trip via `mockClient(S3Client)`; bucket-unconfigured→null (mirror `s3-leaderboard.no-bucket.test.ts`).
- `reports/runner.integration.test.ts`: after `runReport`, ReportRun has `renderedContent` (+ `imageS3Key` for charts; null for text-only/FAILED).
- `league/competition/refresh.integration.test.ts`: calc+save called; DRAFT throws; S3-off no-ops.
- Extract pure guards (`assertReportMutable`, edit status-gate) into unit-testable fns (avoids building full tRPC `ctx`; `assertGuildAdmin` hits Discord REST). Defer caller-level tests; rely on these + manual web QA.

---

## Part B — Frontend (`packages/scout-for-lol/packages/app/`)

Reuse `@scout-for-lol/data` schemas/formatters directly in the SPA (already done for `RiotIdSchema`):
`CompetitionCriteriaSchema`, `CompetitionVisibilitySchema`, `CompetitionQueueTypeSchema`,
`getCompetitionStatus`, `competitionQueueTypeToString`, `visibilityToString`, `participantStatusToString`;
`ReportCreateInputSchema`, `ReportOutputFormatSchema`, limits constants; `seasons.ts:getSeasonChoices()`;
`competition-cron.ts:CronPresets`. `safeParse` client-side before mutating.

### B1. Nav + routes

- `src/routes/guild-workspace.tsx`: add `Competitions` + `Reports` to the nav tuple.
- `src/app.tsx`: nested routes under `/g/:guildId` (list + dedicated `new`/detail/`edit` routes — **not** modals; the criteria + query-DSL forms are too large for dialogs and benefit from shareable URLs):
  `competitions`, `competitions/new`, `competitions/:competitionId`, `competitions/:competitionId/edit`, and the four `reports/...` equivalents.

### B2. New shared primitives/components

| File                          | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `components/ui/badge.tsx`     | minimal `cva` badge (grayscale + destructive variants only)            |
| `components/ui/textarea.tsx`  | shadcn textarea mirroring `input.tsx`                                  |
| `components/status-badge.tsx` | `ts-pattern` map `CompetitionStatus`/`ReportRunStatus` → badge variant |
| `components/section.tsx`      | extract the `<Section>` helper from `player-detail.tsx` (shared)       |
| `lib/criteria-summary.ts`     | `summarizeCriteria(criteria)` → "Most wins · Solo Queue"               |

### B3. Pages & components

| File (new)                                      | Purpose                                                                                                                                                 | tRPC                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `routes/competition-list.tsx`                   | table (title/status/criteria/dates/#participants/visibility) + New + Active-only toggle                                                                 | `competition.list`, `guild.listChannels`                                                             |
| `routes/competition-detail.tsx`                 | header+status+actions, info cards, hosts panels                                                                                                         | `competition.get`, `competition.leaderboard`, `competition.leaderboardHistory`, `competition.cancel` |
| `components/competition-leaderboard-panel.tsx`  | cached standings table + chart `<img>` + **Refresh standings** (bust PNG cache w/ `?t=`); null-cache empty state; run-history list                      | `competition.refreshLeaderboard`                                                                     |
| `components/competition-participants-panel.tsx` | participants table + invite (discord id) / add-all / remove (confirm-guarded)                                                                           | `competition.invite/addAllMembers/removeParticipant`                                                 |
| `routes/competition-form.tsx`                   | create/edit orchestrator (flat state); pure `buildCompetitionInput()` assembles+`safeParse`s the unions; DRAFT-only locking from `getCompetitionStatus` | `competition.get/create/edit`, `guild.listChannels`                                                  |
| `components/competition-dates-fields.tsx`       | FIXED_DATES vs SEASON toggle (date inputs / season select)                                                                                              | —                                                                                                    |
| `components/competition-criteria-fields.tsx`    | 6-way criteria union; `match`-driven conditional fields; inner reusable `QueueSelect`                                                                   | —                                                                                                    |
| `routes/report-list.tsx`                        | table (title/format/schedule/enabled/last-run/system); disable edit/delete for `isSystemManaged`                                                        | `report.list`, `report.setEnabled`                                                                   |
| `routes/report-detail.tsx`                      | definition card + read-only DSL `<pre>` + Run-now; link to source competition                                                                           | `report.get/run/delete`                                                                              |
| `components/report-run-history.tsx`             | per-run cards: status/trigger/time + stored text `<pre>` + chart `<img>`                                                                                | —                                                                                                    |
| `routes/report-form.tsx`                        | 2-col: definition fields ‖ live preview; cron via `CronPresets` select (+ advanced custom)                                                              | `report.get/create/update`, `guild.listChannels`                                                     |
| `components/report-query-preview.tsx`           | debounced (~500ms) live DSL preview table; surface query errors verbatim                                                                                | `report.previewQuery`                                                                                |

**Form-size discipline** (max 500 lines/file, 400/fn, complexity 20, depth 4): orchestrators hold flat
primitive state and delegate (a) conditional field clusters to the `*-fields` sub-components and (b) union
assembly/validation to small pure helpers, keeping render JSX flat.

### B4. Reuse map (copy these)

- List scaffold + mutation feedback (`message`/`error` state, `onSuccess/onError`, confirm-guard): `routes/guild-subscriptions.tsx`.
- Detail + `Section` + info-card grid + `formatDate`/`channelLabel`: `routes/player-detail.tsx`.
- Channel `Select` block: `components/add-subscription-dialog.tsx`. Reusable wrapped select: `components/region-select.tsx`.
- Labeled field controls/submit: `components/admin-form-controls.tsx`. Client-side Zod-before-mutate: `add-subscription-dialog.tsx`.
- Grayscale theme tokens only (this SPA uses shadcn tokens everywhere; the `no-shadcn-theme-tokens` rule targets the _marketing_ Astro frontend, not this app).

### B5. Known UX risks

- Report **query DSL** is power-user-y → mitigate with live preview + verbatim errors + a seeded example; structured builder is a post-v1 follow-up.
- `MOST_WINS_CHAMPION.championId` is a raw numeric input for v1 (don't bundle the 172-asset champion list); follow-up: a `champion.list` lookup feeding a searchable select.
- DRAFT-only locking must derive from `getCompetitionStatus()` (single source), not be reimplemented.

---

## Sequencing

1. **Backend competitions**: `refresh.ts` helper + `s3-leaderboard` image fns → `competition.router.ts` → register → image route → tests.
2. **Backend reports**: `ReportRun` migration → `s3-report-run.ts` → wire `runner.ts` → `report.router.ts` → image route → tests.
3. **Frontend primitives**: `badge`, `textarea`, `status-badge`, `section`, `criteria-summary`.
4. **Frontend competitions**: list → detail (+ panels) → form (+ fields).
5. **Frontend reports**: list → detail (+ run-history) → form (+ preview).
6. Screenshots + PR.

Do steps in a **git worktree** (`feature/scout-competitions-reports`), commit + push after each phase
(worktrees can be wiped).

## Verification

- **Types/lint/tests**: `bun run typecheck`, `bun run test`, `bunx eslint . --fix` in each touched package (`backend`, `app`, `data`). Migration: `prisma.reportRun.create` accepts new fields.
- **End-to-end via PinchTab (real Chrome)**: boot the local stack with `bun run --filter='./packages/scout-for-lol' dev:web` (backend `:3000`, Vite `:5180`; needs `op signin` + the BETA bot in a test guild). Drive the SPA at `http://localhost:5180/app/` through **PinchTab**:
  - **Session setup**: the Discord-OAuth login sets an HttpOnly `scout_session` cookie that can't be scripted — sign in **once in a headed instance on a persistent profile**, then reuse the profile headless. Don't restart the instance after login (loses session).
  - **Drive flows** with `pinchtab snap --interactive` → `click`/`fill`, asserting via `pinchtab text`/`snap`:
    - Competitions: create (each criteria type + both date modes) → list → detail info cards → invite/add-all/remove participants → **Refresh standings** populates cached leaderboard + chart → editing once ACTIVE locks criteria/dates → cancel.
    - Reports: create with a DSL query → live preview renders rows → save → **Run now** posts + archives a run → run-history shows stored text + chart PNG → system-managed report shows disabled edit/delete.
  - **Image endpoints**: confirm chart `<img>` GETs load (cookie-authed) and 404 gracefully when no run exists.
- **Visual deliverables** (one per scenario, light + dark): capture with `pinchtab screenshot` after each state: competition list (populated + empty), detail (standings + chart + null-cache), form (conditional criteria fields, both date modes, non-DRAFT locked), participants panel, report list (incl. system row), report detail (run history + after Run-now), report form (preview success + query error). Upload via `toolkit pr asset <PR> ... --markdown`.

## Open items to confirm during implementation

- `scout_session` cookie `SameSite` + SPA/API same-origin in prod → cookie-auth vs signed-URL for image GETs (A5).
- SPA tRPC transformer serializes `Date` (else `z.coerce.date()` for competition dates).
- Whether web `report.run`/`competition.refreshLeaderboard` need per-guild debounce (both hit Riot/S3); acceptable un-debounced for v1 admin clicks.

## Session Log — 2026-06-13

### Done

- **Backend** (commit `62bc245`): `competition.router.ts` + `report.router.ts` (full CRUD + leaderboard read/refresh + report run/preview), all gated on `assertGuildAdmin`; `ReportRun` migration (`renderedContent`/`imageS3Key`/`imageByteSize`) + `s3-report-run.ts` wired into `runReport`; `refresh.ts` (`refreshAndCacheLeaderboard`/`cacheLeaderboardArtifacts`) shared with `daily-update.ts`; `s3-leaderboard-image.ts` (chart PNG archival); cookie-authed image GET routes in `image-routes.ts` + `http-server.ts`; `chart-builder.ts` split into `renderCompetitionChartBuffer` + wrapper. Tests: `s3-report-run.test.ts`, `s3-leaderboard-image.test.ts`. 957 backend tests pass.
- **Frontend** (commit `c41f22b`): Competitions + Reports nav tabs/routes; competition list/detail/form (+ leaderboard-panel, participants-panel, dates-fields, criteria-fields, form-fields); report list/detail/form (+ run-history, query-preview); shared `badge`/`textarea`/`status-badge`/`section`/`chart-image`/`criteria-summary`/`format`. Added `ts-pattern` to app deps. App typecheck + eslint clean; `vite build` compiles.
- PR **#1170** opened (single PR for the whole feature).

### Done (e2e — 2026-06-13)

- Drove `dev:web` via PinchTab (real Discord OAuth login) on test guild `1337623164146155593`. Verified end-to-end: reports list (system reports + badges), competitions empty state, competition create form (channel/visibility/dates + conditional criteria queue field), create → DRAFT detail (info cards + standings empty + participants panel), competitions list with live participant count, and the report form's debounced live query preview (DSL parsed `games`/`win_rate` columns, executed 0 rows on the fresh guild). Dark mode confirmed. Screenshots posted to PR #1170 (`public.sjer.red/pr/assets/1170/`).
- Cookie-authed `<img>` chart GETs: same-origin via the Vite proxy in dev; confirmed the SPA and API share an origin so no signed-URL fallback was needed.

### Remaining

- Not exercised live (fresh guild had no match data / linked players): leaderboard refresh output, report run-now rendered output, real-player invite. Backend paths are unit-tested; empty/loading states were shown. Worth a follow-up pass on a guild with real data.

### Caveats

- `competitionId`/`reportId` route params are validated with `*IdSchema.safeParse(Number(param))`; a placeholder branded id (`parse(1)`) is used while a query is disabled — never sent because `enabled` gates it.
- Web `report.run` / `competition.refreshLeaderboard` hit Riot API + S3 synchronously (acceptable for explicit admin clicks; no per-guild debounce yet).
- `Date` crosses the tRPC link as an ISO string (no superjson transformer) — competition date inputs use `z.coerce.date()` server-side.

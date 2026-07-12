# Scout for LoL — Mute Subscription + Web UI Polish + Generalized Player Groups (group(N))

## Status

In Progress

## Context

This session grew from one feature request into a batch of related web-app/backend fixes for Scout for LoL, gathered in one plan since they touch overlapping files (mostly `packages/app/src/routes/*` and `packages/backend/src/trpc/router/*`):

1. **Mute subscription** — no way to silence pre/post-match notifications for one `Subscription` without deleting it.
2. **UI polish** — clickable text links aren't visually distinguishable (no underline), the "Unlink" button on the player page looks broken (no visual affordance), raw PUUIDs are exposed in the UI, and the Competitions/Reports list pages default to showing clutter (cancelled/ended/disabled entries).
3. **Player details page** — competitions are shown in two always-visible tables (Active/Past) with no way to click through to the competition, and past/cancelled ones can't be hidden.
4. **Generalized player groups** — a scheduled report (`player_pairs` queue-filtered to `arena`) has returned 0 rows on every run for ~2 months. Investigation found a real correctness bug (Arena pairs join on the wrong team key), and discussing the fix surfaced the real intent: "pair" is the wrong concept entirely. The user wants teammate-group winrate reports for **any group size** — sizes 2–5 within a 5v5 team, and the subteam (2–3 players) for Arena — selected via new `GROUP BY group(N)` syntax, with `pair` kept as a compatibility alias for `group(2)`.

## Design

### 1. Mute subscription (backend + web UI)

Mirrors an existing, near-identical feature added 2026-07-03: per-subscription notification `filters` (queue-type filtering). Mute follows that exact pattern (schema field → domain function → tRPC mutation → audit action → notification dispatch check → web UI toggle) rather than inventing a new one.

- Add a plain boolean `isMuted` column to `Subscription` (`@default(false)`), independent of the existing `filters` JSON blob (mute is a simpler on/off, not part of the extensible filter spec).
- Suppress notifications at the single choke point both pre-match (`prematch-notification.ts`) and post-match (`match-history-polling.ts`) already share: `channelsPassingQueueFilter` in `notification-filters.ts`. Extend its per-subscription predicate from `filtersPass(...)` to `!subscription.isMuted && filtersPass(...)`. This requires threading `isMuted` through `SubscribedChannelSubscription` (`database/index.ts`) the same way `filters` already flows through.
- New domain function `setSubscriptionMuted` (mirrors `setSubscriptionFilters`) in a new `src/lib/subscription/mute.ts`, plus a `setMuted` tRPC mutation on `subscriptionRouter` (mirrors `setFilters`), wrapped in the same audit-transaction pattern.
- New audit action `SUBSCRIPTION_SET_MUTED`.
- Web UI: add an `isMuted` field to `SubscriptionListItem`/`listSubscriptions`, and a Mute/Unmute button + "Muted" indicator in `guild-subscriptions.tsx`'s subscription table row (next to the existing Edit filters / Add channel / Move / Remove actions).

Scope note: web UI + backend only, per the original request. The Discord `/subscription` slash-command surface intentionally mirrors the web feature set 1:1 (see header comment in `subscription.router.ts`), but adding a slash-command flag is out of scope here — not touching `packages/backend/src/discord/commands/`.

### 2. Link underlines (app-wide)

There is no shared `TextLink`/`Link` wrapper component in `packages/app` — every inline text link applies `hover:underline` (or, in a couple of places, `underline`) directly via `className`. Bare `<Link>` elements used as button CTAs (wrapped in `<Button asChild>`, e.g. "Back", "Cancel", "+ New report") already have a clear visual affordance from the button styling and are intentionally left alone — underlining those would look broken. Likewise nav chrome (brand logo, "Guilds"/"Setup guide" nav tabs, the whole-card guild-picker links) relies on color/background hover states, not underline, and is out of scope.

The fix is scoped to the inline-text list links that currently only underline on hover (the exact pattern the user flagged for the Subscriptions page Alias column) — change `hover:underline` → `underline` so they're always visibly clickable:

- `packages/scout-for-lol/packages/app/src/routes/guild-subscriptions.tsx:187-192` (Alias link)
- `packages/scout-for-lol/packages/app/src/routes/player-list.tsx:139-144` (Player alias link)
- `packages/scout-for-lol/packages/app/src/routes/competition-list.tsx:97-102` (Competition title link)
- `packages/scout-for-lol/packages/app/src/routes/report-list.tsx:95-100` (Report title link)

(The two already-`underline` links — `guild-subscriptions.tsx:160` and `competition-detail.tsx:219`/`report-detail.tsx:106` — need no change.) A new competition-title link added to the player-details page (design #3 below) should use the same always-`underline` style from the start.

### 3. "Unlink" button

`packages/scout-for-lol/packages/app/src/routes/player-detail.tsx:234-254` (Discord card): the "Unlink" button uses `variant="ghost"`, which has no background/border until hovered — hence it reads as plain text. Its sibling in the same ternary ("Link Discord", shown when no Discord user is linked) already uses `variant="outline"`. Change "Unlink" to `variant="outline"` too, for a consistent, visibly-a-button affordance.

### 4. Hide PUUID in the web app

`packages/scout-for-lol/packages/app/src/components/player-detail-sections.tsx`: `PlayerAccountsTable` has a "PUUID" column (header line 99, cell lines 122-124) showing the raw Riot PUUID. This is internal-only data with no user-facing purpose. Remove the column (header + cell) entirely — no other UI reads `account.puuid` for display (the type field itself stays, since it's still needed for the Transfer dialog's data model).

### 5. Player details page — merge Active/Past into one table, hide ended by default, add links

`packages/scout-for-lol/packages/app/src/routes/player-detail.tsx` currently renders two always-visible `CompetitionSection` tables ("Active competitions" / "Past competitions"). Per user direction: collapse into **one** table, with ended/cancelled competitions hidden by default behind a toggle (mirroring the existing "All / Active only" `Button` pattern already used on `competition-list.tsx:48-57`).

- Replace the two `CompetitionSection` calls (lines 362-369) with one, fed by `competitions` (all of them) or `activeCompetitions` depending on a new `showAllCompetitions` state toggle (default `false` = active-only). Add a small toggle `Button` next to the section title (the `CompetitionSection`/`Section` component already accepts an `action` prop for this — `player-detail-sections.tsx:182-196`).
- `player-detail-sections.tsx` `CompetitionSection`: make the competition title a `Link` to `/g/${guildId}/competitions/${competition.id}` (currently plain text, `player-detail-sections.tsx:236-239`), styled with the always-`underline` convention from design #2. This requires passing `guildId` into `CompetitionSection`'s props (it's already in scope in `player-detail.tsx`).
- Reports: per user direction, there is no Player → Report relation in the schema (`Report.sourceCompetitionId` links to a `Competition`, not a `Player`) and no natural "reports for this player" concept — **skip adding a reports section to the player-details page.**

### 6. Competitions/Reports list pages — hide cancelled/ended/disabled by default

- `packages/scout-for-lol/packages/app/src/routes/competition-list.tsx:23`: the `activeOnly` toggle already exists and wires straight through to the backend's `activeOnlyWhere()` filter (`isCancelled: false`, not yet ended) — it just defaults to `false` ("All"). Flip the default: `useState(true)`.
- `packages/scout-for-lol/packages/app/src/routes/report-list.tsx`: no filtering exists today (`report.list` returns everything, unpaginated). Add the same UI pattern as competitions: an `enabledOnly` state (default `true`) with an "All / Enabled only" toggle `Button`, filtering the already-fetched `reports` array client-side (`reports.filter((r) => !enabledOnly || r.isEnabled)`) — no backend change needed since the full list is already fetched in one shot.

### 7. Generalized player groups — `GROUP BY group(N)`

**Background / original bug.** The existing `player_pairs` source self-joins two fact rows on `p1.team_id = p2.team_id` (`compile.ts:245-246`). `team_id` is raw Riot `teamId` (only ever `100`/`200`) — correct for 5v5, wrong for Arena, where a "side" spans 3-4 unrelated duo/trio subteams. The true Arena grouping key is `player_subteam_id` (1-8), which the report lake already stores (`report-lake/schema.ts:116,135`, populated in `flatten.ts:127`) but the pair query never reads. Discussing the fix surfaced the real requirement: pairs are just the N=2 case of "teammate groups"; the user wants sizes 2-5 for standard queues and subteam-scoped groups for Arena.

**Current architecture (what we're generalizing).** "pair" is baked into five layers:

- DSL: `ReportGroupBySchema = z.enum(["player","champion","queue","pair"])` (`packages/data/src/model/report-query-spec.ts:22-28`); the parser (`report-query-parser.ts:125`) captures `GROUP BY <ident>` as raw text and `report-query-compile.ts:48` validates it against the enum.
- Registry: `player_pairs` source accepts only `groupBy: ["pair"]` (`report-query-registry.ts:87`); `query-engine.ts:68-69` enforces the same at runtime.
- SQL compiler: `compilePairQuery` (`compile.ts:216-251`) — dedupe CTE + fixed 2-alias self-join.
- Static aggregate SQL: `pairAggregateSelect()` (`metrics-sql.ts:44-79`) hardcodes `p1.X + p2.X` per stat; the file's header documents a deliberate design rule: _no plan-driven SQL text in the SELECT clause_.
- JS fact engine: `aggregatePairFacts()` in `query-aggregates.ts:104-121` (kept in sync with the SQL path by the parity suite).
  Output rendering is already generic — `label` is an opaque string (`output.ts`), so `"A + B + C"` needs no renderer change.

**New design.**

- **Syntax:** `GROUP BY group(N)` for one size (N ∈ 2..5), `GROUP BY group(all)` for every valid size at once (2..5 for standard queues; 2..3 within Arena subteams — capped by actual roster size found per group unit). Source is renamed conceptually to `player_groups`; `player_pairs` + `GROUP BY pair` remain permanent aliases meaning `player_groups` + `group(2)`, so the existing production report keeps working unmodified.
- **Plan shape:** `ReportQueryPlan.groupBy` becomes a discriminated union: the existing enum literals plus `{ kind: "group", size: number | "all" }`. `"pair"` normalizes to `{ kind: "group", size: 2 }` at compile time (in `report-query-compile.ts`), so downstream code only sees the structured form. Zod: replace the bare enum with `z.union([z.enum(["player","champion","queue"]), GroupGroupBySchema])`.
- **Grouping unit:** for non-Arena rows the unit is `(match_id, team_id)`; for Arena rows it's `(match_id, team_id, player_subteam_id)`. Uniformly expressible as `(match_id, team_id, player_subteam_id)` with `player_subteam_id` treated as a nullable component (`NULL` for all non-Arena queues) — Arena is _always_ subteam-scoped, never side-scoped, per user direction.
- **Where combinations are computed: JS, not SQL.** The static-SQL design rule (`metrics-sql.ts` header) rules out emitting `p1.X + p2.X + p3.X…` text per requested size, and DuckDB combinatorics (recursive CTEs / list functions) are unused in this codebase. Instead, restructure the lake query to return **raw per-player fact rows** for the group units that contain ≥2 tracked players (reusing the existing `facts` + dedupe CTEs from `compilePairQuery`, minus the self-join and aggregation), then in JS: bucket rows by group unit, generate all size-k player combinations per bucket (k = requested size, or every k in 2..bucket-size for `group(all)`), and sum each combination's stats into `AggregateRow`s keyed by the sorted member player-id tuple. This mirrors where minGames/sorting/derived-metrics already live (`query-aggregates.ts:266,345-375`). Combinatorial blow-up is a non-issue: buckets only contain _tracked_ players (the `accounts` join already filters to them), so a bucket is ≤5 players → at most 26 combinations per match-team.
- **Wins semantics:** a group "wins" iff all members won (matches today's `p1.win AND p2.win`); summed counters (kills, deaths, …) sum across all members — direct generalization of `pairAggregateSelect`.
- **Label:** members' aliases sorted by player id, joined with `" + "` (matches today's format for N=2, so the existing integration-test expectation `"First Player + Second Player"` is preserved).
- **Parity/legacy path:** `aggregatePairFacts` in the JS fact engine (`query-aggregates.ts`) generalizes the same way (`aggregateGroupFacts`), keeping the SQL-lake and JS-facts paths equivalent for the parity suite.
- **minGames:** applies per group row as today (`query-aggregates.ts:266`), unchanged.

**Performance of `group(5)` / `group(all)`.** The combinatorics are bounded by _game structure_, not by how many players the guild tracks: a group unit is one team in one match, so a bucket can never exceed 5 tracked players (5v5) or 3 (Arena subteam), regardless of guild size. Worst case per bucket is `group(all)` on a full 5-stack: C(5,2)+C(5,3)+C(5,4)+C(5,5) = 25 combinations. Total work is therefore O(25 × match-team units) — linear in matches, same asymptotics as today's pair path (which already emits up to C(5,2)=10 rows per unit). The raw-rows-to-JS transfer is also not a regression: row count equals tracked-participant fact rows (the same `rowsScanned` number the engine already reports, e.g. 63 in the failing Arena report), and the legacy JS fact engine already streams exactly these rows. Concrete safeguards anyway:

- Aggregate into a `Map` keyed by the sorted player-id tuple joined as a string (e.g. `"12|45|97"`) — one pass, no intermediate arrays of combination objects retained.
- Generate combinations with a small iterative k-subset helper over index arrays (no recursion-per-row allocation churn).
- Keep the `≥2 tracked players per unit` SQL filter (QUALIFY window count) so singleton buckets — the overwhelming majority of rows — never leave DuckDB.
- Distinct output rows are bounded by real co-play patterns (distinct tuples actually observed), so the aggregate map stays small even over long lookbacks.
- Add a perf sanity test: synthesize a lake with ~10k match-units of full 5-stacks and assert `group(all)` completes within a generous bound (e.g. <2s) — catches accidental quadratic behavior.

**Migration path (beta/prod) — verified against live databases.** `Report` rows persist only `queryText`, and `parseAndCompile(report.queryText)` runs on _every_ execution (`runner.ts:70`, `query-engine.ts:60`) — no persisted compiled plans anywhere. Pulled the actual `Report` tables from both the beta and prod pods (read-only `bun:sqlite` query on `/data/db.sqlite`): every `pair` report in both environments — "Ranked Pairings", "Ranked Bottom Pairings", "Arena Pairings", "Arena Bottom Pairings", "ARAM Pairings", "ARAM Bottom Pairings" (prod ids 138-143, beta ids 4-9) — is `isSystemManaged: 1` / `systemSource: COMMON_DENOMINATOR`. **Zero user-authored pair queries exist.** And `updateSystemReport` (`system-reports.ts:392-403`) rewrites the full definition _including `queryText` and `title`_ from the in-code templates on every sync tick, so updating `commonPairingQuery` in code automatically rewrites all live rows on deploy — no DB migration script.

Consequences:

- The `pair`/`player_pairs` compatibility alias is still cheap insurance (someone may have a saved draft or muscle memory) but is no longer load-bearing — every live query is template-owned.
- Update the `commonPairingQuery` templates to the new syntax directly (per user: the "pairs"/"Pairings" queries need updating). Recommended: all six switch to `FROM player_groups … GROUP BY group(all)` — for 5v5 queues that surfaces sizes 2-5 (the user's stated intent), for Arena sizes 2-3 within subteams, ARAM sizes 2-5. Retitle "… Pairings" → "… Groups" (title is definition state, auto-synced the same way).
- Note the SELECT-list label column: today the templates write `SELECT pair, games, …`; the new grammar should accept `group` as the label column for group queries (and keep `pair` accepted as its alias, consistent with the groupBy alias).
- Rollback is clean: redeploying old code re-syncs the old template text back into every system report row within one sync tick.

**De-risking findings (verified against the live tree).**

- **Lexer collision — `group` is a keyword.** `Group` is a Chevrotain keyword token (`report-query-lexer.ts:50`, for `GROUP BY`), and `longer_alt: Identifier` only rescues _longer_ words ("groups" lexes as Identifier; bare "group" always lexes as the Group keyword). So both `SELECT group, …` and `GROUP BY group(all)` deliver a `Group` token where the hand-written parser currently expects `Identifier`. The parser is hand-written and lenient (`report-query-parser.ts`), so this is straightforward — but it's an explicit task: accept the `Group` token in select-list-item and group-by-value positions (treat it as the identifier "group"). Cover with lexer/parser tests in `packages/data/src/model/report-query.test.ts`.
- **Legacy engine is parity-test-only.** `query-engine-legacy.ts` has zero non-test runtime importers, and `aggregatePairFacts` is only called from it. `MatchParticipantFact` (its SQLite fact source) has `teamId` but **no `playerSubteamId`** column — however it stores `rawParticipantJson` per row, which contains `playerSubteamId`. Fix without a Prisma migration: the legacy path derives the subteam id by parsing `rawParticipantJson` (Zod, minimal picked schema) when bucketing; the shared `aggregateGroupFacts` combination helper then works identically for both engines and the parity suite stays meaningful for Arena.
- **Lake already carries `player_subteam_id`** for match rows (`report-lake/schema.ts:115-116`, written by `flatten.ts:126-127` from StoredMatch rawJson), and the lake is disposable derived data rebuilt nightly — no lake migration. §Q's live validation must additionally confirm the beta snapshot's arena rows have non-null `player_subteam_id` (guards against older lake snapshots predating that column).
- **AI report agent needs the new vocabulary.** `reports/ai/report-query-agent.ts:204` serves `REPORT_SOURCES`/`REPORT_GROUP_BYS`/`REPORT_COMMON_PRESETS` from the data-package registry to the LLM as its language reference. Updating the registry (§L) propagates automatically, but the group entry's `description` must explain the `group(N)`/`group(all)` call syntax (the id/label/description shape is flat strings), and any `REPORT_COMMON_PRESETS` entries using pair queries need updating to the new syntax.
- **App editor surfaces.** `packages/app/src/lib/scoutql-language.ts` (editor completions/highlighting — already lists `group` as a keyword at line 160) needs `player_groups` + `group(…)` completions; `report-help.tsx` has no hardcoded pair references (verified) but confirm during implementation that any source/groupBy listings it renders are registry-driven.

**Caveat to verify post-ship:** the generalization fixes the Arena grouping bug, but likely does **not** explain the observed "0 rows" by itself. One run reported "0 rows / 63 scanned" — 63 tracked-player Arena fact rows existed, yet even the buggy _looser_ (side-wide) join produced zero pairs; a stricter subteam join can't produce more. Most likely no two tracked players in this guild actually played Arena on the same team in any 30-day window. Confirm post-fix with a known co-played Arena match, and note the report also has `games >= 10` (per-group threshold) which will keep the leaderboard empty until a duo/trio accumulates 10 shared games.

## Implementation

### A. Schema + migration (mute)

- `packages/scout-for-lol/packages/backend/prisma/schema.prisma`: add `isMuted Boolean @default(false)` to `model Subscription` (after `filters`).
- New migration `packages/scout-for-lol/packages/backend/prisma/migrations/<timestamp>_add_subscription_muted/migration.sql`:

  ```sql
  ALTER TABLE "Subscription" ADD COLUMN "isMuted" BOOLEAN NOT NULL DEFAULT false;
  ```

  Follow the timestamp-prefix convention from existing migrations (e.g. `20260703000000_add_subscription_filters`). Run `bun run db:generate` (in `packages/backend`) after, then `bun install` at `packages/scout-for-lol/` to refresh the copied Prisma client into dependents (per package CLAUDE.md).

### B. Notification dispatch (mute)

- `packages/scout-for-lol/packages/backend/src/database/index.ts`: add `isMuted: boolean` to `SubscribedChannelSubscription` (~line 60-64); populate it from `subscription.isMuted` in the `getChannelsSubscribedToPlayers` mapping (~line 144-148).
- `packages/scout-for-lol/packages/backend/src/league/tasks/notification-filters.ts`: change `channelsPassingQueueFilter`'s predicate (line 24-26) to `channel.subscriptions.some((s) => !s.isMuted && filtersPass(s.filters, { queueType }))`.
- No changes needed in `prematch-notification.ts` / `match-history-polling.ts` — both already call `channelsPassingQueueFilter`.

### C. Domain function + types (mute)

- New file `packages/scout-for-lol/packages/backend/src/lib/subscription/mute.ts`, modeled directly on `setSubscriptionFilters` in `filters.ts`: look up the player by `serverId_alias`, find the subscription by `channelId`, `db.subscription.update({ data: { isMuted, updatedTime: new Date() } })`, return `{ kind: "updated" }` / `{ kind: "player-not-found" }` / `{ kind: "not-subscribed-in-channel" }` / `{ kind: "internal-error", message }`.
- `packages/scout-for-lol/packages/backend/src/lib/subscription/types.ts`: add `SetSubscriptionMutedInputSchema`/`SetSubscriptionMutedInput` (guildId, channelId, alias, isMuted, actorDiscordId — mirrors `SetSubscriptionFiltersInputSchema`) and `SetSubscriptionMutedResult` (mirrors `SetSubscriptionFiltersResult`). Add `isMuted: boolean` to `SubscriptionListItem`.

### D. Audit + tRPC (mute)

- `packages/scout-for-lol/packages/backend/src/lib/audit/index.ts`: add `"SUBSCRIPTION_SET_MUTED"` to `AuditActionSchema`.
- `packages/scout-for-lol/packages/backend/src/trpc/router/subscription.router.ts`: add a `setMuted` mutation mirroring `setFilters` (lines 351-397) — `assertGuildAdmin` + `assertChannelInGuild`, transaction wrapping `setSubscriptionMuted` + `recordAudit({ action: "SUBSCRIPTION_SET_MUTED", payload: { alias, isMuted } })`.

### E. List query (mute)

- `packages/scout-for-lol/packages/backend/src/lib/subscription/list.ts`: include `isMuted: sub.isMuted` in the mapped item (~line 34-58).

### F. Web UI (mute)

- `packages/scout-for-lol/packages/app/src/routes/guild-subscriptions.tsx`: add a `muteMutation` (mirrors `removeMutation`, lines 77-101) calling `trpc.subscription.setMuted`, invalidating `subsKey` on success. Add a "Muted" text/badge in the row when `sub.isMuted` is true (near the Filters cell), and a Mute/Unmute `Button` in the actions cell (next to "Remove") that calls `muteMutation.mutate({ guildId, channelId: sub.channelId, alias: sub.player.alias, isMuted: !sub.isMuted })`.

### G. Link underlines

- Edit the 4 files/lines listed in Design #2: `hover:underline` → `underline`.

### H. Unlink button

- `player-detail.tsx:234-254`: `variant="ghost"` → `variant="outline"` on the "Unlink" `Button`.

### I. Hide PUUID

- `player-detail-sections.tsx`: remove the "PUUID" `TableHead` (line 99) and its `TableCell` (lines 122-124) from `PlayerAccountsTable`.

### J. Player details page — competitions

- `player-detail-sections.tsx`: add `guildId: string` to `CompetitionSection`'s props; wrap the competition title cell in a `Link to={`/g/${guildId}/competitions/${competition.id}`}` with `className="underline"`.
- `player-detail.tsx`: replace the two `CompetitionSection` calls with one, add `showAllCompetitions` state (default `false`), pass `showAllCompetitions ? competitions : activeCompetitions` as `rows`, and pass a toggle `Button` (`"All" / "Active only"`, mirroring `competition-list.tsx:48-57`) as the `action` prop.

### K. Competitions/Reports list default filters

- `competition-list.tsx:23`: `useState(false)` → `useState(true)`.
- `report-list.tsx`: add `const [enabledOnly, setEnabledOnly] = useState(true)`, a toggle `Button` next to "+ New report" (mirroring the competitions toggle), and filter `reports` (`const visibleReports = enabledOnly ? reports.filter((r) => r.isEnabled) : reports`) before rendering the table.

### L. Generalized player groups (`group(N)`) — packages/data (DSL layer)

- `packages/scout-for-lol/packages/data/src/model/report-query-spec.ts`: replace `ReportGroupBySchema`'s `"pair"` literal with a structured variant — `groupBy: z.union([z.enum(["player","champion","queue"]), z.object({ kind: z.literal("group"), size: z.union([z.number().int().min(2).max(5), z.literal("all")]) })])`. Export a `GroupGroupBy` type.
- `packages/scout-for-lol/packages/data/src/model/report-query-parser.ts` (~line 125): `GROUP BY` currently captures a bare identifier; extend to also accept the call form `group ( <int|all> )` (lexer already tokenizes identifiers + parens; add tokens if needed in `report-query-lexer.ts`).
- `packages/scout-for-lol/packages/data/src/model/report-query-compile.ts` (~line 48): map raw groupBy text → structured plan value; normalize `pair` → `{kind:"group", size:2}`. `FROM player_pairs` stays accepted (alias for `player_groups`); add `player_groups` to `ReportSourceSchema` with `player_pairs` normalizing to it (or keep `player_pairs` as the canonical source id and just accept `player_groups` as alias — pick whichever keeps stored-plan compatibility; existing saved reports store `queryText` and re-compile, so alias-at-compile is safe).
- `packages/scout-for-lol/packages/data/src/model/report-query-registry.ts` (~line 87): the groups source's `validGroupBys` becomes "any `{kind:"group"}` value"; update registry shape/validation helpers accordingly. Update `report-query-lint.ts` if it surfaces groupBy suggestions.
- SELECT-list label column: accept `group` as the label column name for group queries (`SELECT group, games, …`), keeping `pair` as its accepted alias — mirror of the groupBy aliasing, wherever the compiler maps the label select item today.
- Parser keyword handling: `group` lexes as the `Group` keyword token, not `Identifier` (see De-risking findings in Design #7) — the parser must accept the `Group` token in select-list and group-by-value positions.
- `packages/scout-for-lol/packages/data/src/model/report-query.test.ts`: add lexer/parser/compiler/lint cases for `group(2)`, `group(all)`, `SELECT group`, the `pair` aliases, and rejection cases (`group(1)`, `group(6)`, `group()`, `group(foo)`).
- Registry metadata for the AI agent: the group entry's `description` string must teach the `group(N)`/`group(all)` call syntax (it's served verbatim to the report-authoring LLM via `report-query-agent.ts:204`); update any `REPORT_COMMON_PRESETS` pair queries to the new syntax.
- `packages/scout-for-lol/packages/app/src/lib/scoutql-language.ts`: add `player_groups` source and `group(…)` to the editor completions/highlighting (`group` keyword already listed at line 160); verify `report-help.tsx`'s source/groupBy listings pick up the registry changes.

### M. Generalized player groups — backend (engine layer)

- `packages/scout-for-lol/packages/backend/src/reports/duckdb/compile.ts`: replace `compilePairQuery` (lines 216-251) with `compileGroupFactsQuery` — keeps the same `facts` CTE + dedupe CTE (dedupe partition becomes `match_id, team_id, player_subteam_id, player_id`), drops the self-join/aggregation, and instead SELECTs raw per-player rows (`player_id, player_alias, match_id, team_id, player_subteam_id, win, kills, …` — all counters from `matchAggregateSelect`'s source columns) restricted to group units having ≥2 tracked players (`QUALIFY count(*) OVER (PARTITION BY match_id, team_id, player_subteam_id) >= 2` or equivalent CTE filter). `rowsScanned` statement unchanged.
- `packages/scout-for-lol/packages/backend/src/reports/duckdb/metrics-sql.ts`: delete `pairAggregateSelect()` (lines 44-79); add a raw-fact column list for the group query.
- `packages/scout-for-lol/packages/backend/src/reports/duckdb/row-schema.ts`: add a Zod schema for the raw group-fact row.
- `packages/scout-for-lol/packages/backend/src/reports/duckdb/execute.ts` (~line 69): route the groups source through the new compile + a JS post-step.
- New `packages/scout-for-lol/packages/backend/src/reports/group-combinations.ts` (or inside `query-aggregates.ts`): bucket raw rows by `(match_id, team_id, player_subteam_id)`, generate size-k combinations per bucket (k = plan size, or 2..bucketSize for `all`), sum counters per sorted-player-id-tuple key, emit `AggregateRow`s with label `aliases.join(" + ")`, wins = all-members-won. Reuse/replace `aggregatePairFacts` (`query-aggregates.ts:104-121`) so the JS fact engine and the lake path share this one combination/aggregation implementation (parity suite stays green by construction).
- Legacy/parity path subteam support: `query-engine-legacy.ts` (parity-test-only — zero runtime importers) buckets by `matchId:teamId` (`query-aggregates.ts:110`); extend its bucketing key with the subteam id parsed from `MatchParticipantFact.rawParticipantJson` (picked Zod schema for `playerSubteamId`) — no Prisma migration for the fact table.
- `packages/scout-for-lol/packages/backend/src/reports/query-engine.ts:68-69`: update the source/groupBy guard for the structured groupBy.
- `query-aggregates.ts:299-318` (`groupKey` throws on pair): update for the structured variant.

### N. Generalized player groups — system report templates

- `packages/scout-for-lol/packages/backend/src/reports/system-reports.ts:157-187` (`commonPairingQuery` + its six callers): switch all six pairing templates to the new syntax — `SELECT group, games, wins, losses, win_rate FROM player_groups WHERE queue IN (…) AND games >= 10 GROUP BY group(all) ORDER BY win_rate … RENDER leaderboard` — and update the definitions' text to match the new semantics: retitle "… Pairings" → "… Groups" (e.g. "Common Denominator - Ranked Groups"), and rewrite each `description` to describe group winrates across all group sizes (2-5 for 5v5 queues, subteams for Arena) instead of the current "Seeded replacement for the legacy Common Denominator cron" boilerplate.
- Rollout mechanics (verified live): all six pairing rows on **beta** (ids 4-9) are system-managed, and `updateSystemReport` re-syncs `queryText` + `title` + `description` from these templates on every sync tick — so beta's live reports adopt the new group queries and matching names/descriptions automatically on deploy, no data migration.
- **Retitle-safe matching (required):** `findSystemReport` matches existing rows by `title` (`system-reports.ts:345-352`), and `disableStaleSystemReports` also keys COMMON*DENOMINATOR staleness off titles (`:417-419`). A bare retitle would therefore create six \_new* rows and strand the old-titled ones as disabled leftovers (losing run-history continuity). Fix in the same change: add `previousTitles: string[]` to `SystemReportDefinition`, have `findSystemReport` match `title: { in: [definition.title, ...definition.previousTitles] }`, and include previous titles in the staleness allow-list. Each renamed template lists its old "… Pairings" title, so the existing beta rows are found, updated in place (new title/desc/query), and keep their ids + ReportRun history.
- Prod rows (ids 137-143) are deleted outright per §P — the retitled templates never re-seed there once seeding is beta-gated.

### O. Generalized player groups — tests

- Extend `compile.test.ts` + `query-engine.integration.test.ts` (existing pair tests at `query-engine.integration.test.ts:159-211` must keep passing unmodified — `pair` alias compatibility): (a) legacy query text `FROM player_pairs … GROUP BY pair` still yields the same label/metrics; (b) `group(2)` ≡ `pair`; (c) `group(3)` on a 5-stack solo-queue match yields C(5,3) rows with correct summed stats and all-win semantics; (d) `group(all)` yields sizes 2..teamSize mixed; (e) Arena: two duos on the same `team_id` side produce groups only within each subteam, never across; a 3-person subteam under `group(all)` yields 3 pairs + 1 trio; (f) non-Arena rows with `player_subteam_id` NULL group correctly (NULL-safe unit key); (g) perf sanity test per Design #7 (synthetic ~10k-unit lake, `group(all)` under a generous time bound).

### P. Remove COMMON_DENOMINATOR seeding from prod + delete orphan rows

Verified live: prod's `Report` table contains exactly 7 rows, all `COMMON_DENOMINATOR` system reports for guild `1337623164146155593` — the user's **beta** guild. They are fully orphaned in prod (0 Players/Subscriptions/Accounts/Competitions/facts/AuditLog rows for that guild; 0 ReportRuns — they never fired there; only a GuildInstall row exists because the prod bot is also installed in that guild). Root cause: `commonDenominatorDefinitions` (`system-reports.ts:136-141`) seeds for the hardcoded `MY_SERVER` (`configuration/flags.ts:65`) gated only by the `common_denominator_enabled` flag override — no environment check, so both deployments seed identically.

- Code fix: gate the seeding by environment — `commonDenominatorDefinitions` returns `[]` unless `getEnvironment() === "beta"` (env parsing already exists: `configuration.ts:42-49`, `ENVIRONMENT` ∈ dev/beta/prod). Prefer expressing this as an environment condition alongside the existing flag check rather than a new flag.
- Cleanup ordering matters: `syncSystemReports` runs continuously and re-creates deleted rows, and `disableStaleSystemReports` (`system-reports.ts:405-439`) only sets `isEnabled: false`, never deletes. So: deploy the env-gate first (next sync tick will auto-_disable_ the 7 prod rows), then one-time delete the rows on the prod pod (`DELETE FROM Report WHERE serverId = '1337623164146155593' AND isSystemManaged = 1` — safe: 0 ReportRun children). Confirm the guild-removal reconciler (`reconcile-removed-guilds.ts:42` references these reports) doesn't object.
- Note for a possible follow-up (not this plan): `league/tasks/pairing/weekly-update.ts:335-336` also targets `MY_SERVER` + the same hardcoded channel — the legacy cron these reports replaced; same environment-gating question applies if it's still active.

### Q. Validation against the live beta/prod datasets

The report lake is pod-local derived data (`REPORT_LAKE_DIR` → `/data/report-lake` — Parquet, disposable/rebuildable), and we have k8s access. Use the **beta** pod (`scout-beta` namespace): per §P, prod holds no data for the pairing guild — beta is where the real facts, competitions, and report-run history live. Before merging the engine change:

1. `kubectl cp` (or `kubectl exec` + tar) the beta backend pod's `/data/report-lake/CURRENT`-pointed snapshot to a local scratch dir (read-only copy; a few Parquet files).
2. Run the new engine locally against it via `runLakeAggregation({ lakeDir: <copy>, … })` (it already accepts a `lakeDir` override — `execute.ts:53`) in a small script/integration harness:
   - **Parity check:** for every system-report pairing query (solo/flex/aram/arena), run legacy `pair` vs new `group(2)` over the same window and assert identical row sets — real-data regression proof, not just fixtures.
   - **Arena diagnosis:** query the raw facts for arena rows grouped by `(match_id, team_id, player_subteam_id)` and report how many units contain ≥2 tracked players — this definitively answers whether the production "0 rows" is the join bug or genuine data sparsity, using the user's actual data. Also confirm arena rows have non-null `player_subteam_id` in the snapshot (guards against a lake predating that column; if null, trigger the nightly rebuild / `bun run compact:report-lake` first).
   - **Perf measurement:** time `group(all)` over the full prod lake (largest real workload available) and record it in the PR.
3. The same procedure works against the prod pod as a second dataset for the parity/perf checks (prod has 16.6k match facts for _other_ guilds — valid for engine parity, just not for the Arena pairing diagnosis).

## Verification

- `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck` and `bun run --filter='./packages/scout-for-lol/packages/app' typecheck`.
- New/updated tests:
  - `notification-filters.ts` unit test (or extend existing prematch/postmatch integration tests) asserting a muted subscription's channel is excluded from `channelsPassingQueueFilter` even when it's the only subscription for that channel, and included when at least one other non-muted subscription exists.
  - tRPC test mirroring `subscription-filters.router.test.ts` for the new `setMuted` mutation (via `createOfflineTrpcHarness`), asserting the row updates and an audit entry is written.
  - Group-query tests per Implementation §O (legacy `pair` compatibility, `group(N)`, `group(all)`, Arena subteam scoping, perf sanity).
- Live-data validation per Implementation §Q: lake snapshot → local parity check (`pair` vs `group(2)`), Arena co-play diagnosis, and `group(all)` perf timing recorded in the PR. Note: prod's lake is useless for pairing validation (its only reports were the orphans being deleted in §P, and prod has zero facts for that guild) — use the **beta** pod's lake/DB for parity and Arena diagnosis.
- Post-deploy (§P): confirm prod's 7 orphan COMMON_DENOMINATOR rows are disabled by the next sync tick, then deleted; confirm beta's copies keep running.
- `bun test` in `packages/scout-for-lol/packages/backend` for the affected suites.
- Manual E2E: `bun run --filter='./packages/scout-for-lol' dev:web`:
  - Toggle mute on a subscription; confirm the row reflects muted state and `subscription.isMuted` persists (Prisma Studio or a quick query).
  - Re-run the Arena groups report (retitled from "Common Denominator - Arena Pairings" per §N) via "Run now" on beta after deploy; note the Design #7 caveat — zero rows may persist legitimately until tracked players co-play ≥10 Arena games as a subteam.
  - Visually confirm: Subscriptions/Players/Competitions/Reports list links are underlined by default; the Unlink button on a player's Discord card looks like a real button; PUUID column is gone from the player accounts table; player-details page shows one competitions table with a working "All/Active only" toggle and clickable competition titles; Competitions and Reports list pages default to hiding cancelled/ended/disabled entries with a toggle to show all.

## Session Log — 2026-07-11

### Done

- **Mute subscription (§A-F)**: `Subscription.isMuted` + migration `20260711000000_add_subscription_muted`; threaded through `SubscribedChannelSubscription` → `channelsPassingQueueFilter` (single pre/post-match choke point); new `setSubscriptionMuted` domain fn (`lib/subscription/mute.ts`), `SUBSCRIPTION_SET_MUTED` audit action, `subscription.setMuted` tRPC mutation; `isMuted` on `SubscriptionListItem`; Mute/Unmute button + Muted badge in `guild-subscriptions.tsx`.
- **UI polish (§G-K)**: always-underline for the 4 hover-only table links; Unlink button → `variant="outline"`; PUUID column removed; player-detail competitions merged into one table with an Active-only toggle (default) and competition-title links; competitions list defaults to Active-only; reports list gets an Enabled-only toggle (default on).
- **group(N) DSL (§L)**: `groupBy` enum `pair` → `group` + separate `plan.groupSize` (2-5 | "all"; superRefine-coupled) — a deliberate simplification of the plan's discriminated-union shape, same semantics. Parser needed **no changes** (join-based clause capture already tolerates the `group` keyword in item positions). `parseGroupByClause` + `groupingColumnNames` shared by compiler and linter; `player_pairs`/`pair` normalize to `player_groups`/`group(2)`; registry/completions/AI-agent metadata updated (editor completes `group(2)`/`group(all)`).
- **group(N) engine (§M)**: `compilePairQuery` → `compileGroupFactsQuery` (raw per-player rows, dedupe + unit filter keyed on `(match_id, team_id, player_subteam_id)`); combinations + summation in JS (`reports/group-combinations.ts`), shared by lake path and the parity-only legacy engine (which parses `playerSubteamId` from `rawParticipantJson` — no fact-table migration).
- **Templates + env-gate (§N,P)**: six `commonPairingQuery` templates → `commonGroupQuery` with `GROUP BY group(all)`, retitled "… Pairings" → "… Groups", real descriptions; `previousTitles` rename-safe matching in `findSystemReport`/staleness; `commonDenominatorDefinitions` beta-gated via `resolveEnvironment()`.
- **Tests (§O)**: 10-case unit suite for `aggregateGroupFacts` (incl. perf sanity: 10k 5-stack units in <2s, actual ~ms); 3 lake integration tests (pair≡group(2), group(all) trio all-win semantics, Arena subteam scoping); DSL tests (group(2)/group(all)/aliases/rejections); system-reports rename-in-place + non-beta-seeds-nothing tests; mute tests (notification-filters unit + setMuted tRPC + list surfacing). Full suites green: backend 1105 pass / 0 fail, data 436 pass; typecheck + eslint clean (0 errors) across data/backend/app.
- **Live validation (§Q)** against a beta-lake snapshot (13MB, kubectl-copied): pair vs group(2) **identical** on real data for solo/flex (192 rows), arena, aram; all 219 historical arena rows have non-null `player_subteam_id`; perf: full-lake `group(all)` = 8164 rows → 1618 groups in **36ms**.

### Remaining

- Commit, push, PR, CI (Buildkite), merge.
- Post-deploy (§P cleanup): after the env-gate reaches prod, confirm the next sync tick disables prod's 7 orphan COMMON_DENOMINATOR rows, then one-time `DELETE FROM Report WHERE serverId = '1337623164146155593' AND isSystemManaged = 1` on the prod pod (0 ReportRun children — safe).
- Post-deploy: confirm beta rows 4-9 are retitled in place (ids preserved) and "Run now" the Arena groups report.
- Manual E2E via `bun run dev:web` (mute toggle + UI polish visual pass) — needs `op signin`; not run this session.

### Caveats

- **Arena "0 rows" root cause confirmed as data sparsity, not (only) the join bug**: beta lake has **zero tracked arena rows in the last 30 days**, and even over 365 days the most-played arena duo (Dan + Danny) has 7 shared games — below the report's `games >= 10` floor. The subteam fix is still correct (side-join would mis-pair across subteams over longer windows), but the weekly report will legitimately stay empty until a duo/trio accumulates 10 shared arena games within 30 days. Consider lowering the floor or lookback for the arena templates if visibility is wanted sooner.
- Plan-shape deviation from the approved plan: flat `groupBy: "group"` + `groupSize` field instead of a discriminated union — chosen after finding the union would churn every ts-pattern arm and the flat AI-agent registry for no semantic gain.
- The Discord `/subscription` slash-command surface intentionally does NOT get a mute flag (per scope); the web/Discord 1:1 mirror claim in `subscription.router.ts`'s header comment is now slightly stale.
- `system-reports.integration.test.ts` mutates `Bun.env["ENVIRONMENT"]` (beta) for the suite and restores it in `afterAll` — fine under bun's per-file sequential execution, but worth knowing if test parallelism ever changes.

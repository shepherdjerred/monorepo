---
id: log-2026-07-26-scout-common-denominator-mentions
type: log
status: complete
board: false
---

# Scout Common Denominator — Jerred Absence + Top-3 Mentions

## Question

1. Why does Jerred (`sjerred#sjerr`) never appear in the weekly "Common
   Denominator" Discord reports (Ranked Surrender Leaders / Ranked Groups /
   Arena Groups)?
2. Add Discord `@mention`s for the top 3 rows of leaderboard-rendered reports.

## Findings — Part 1 (why Jerred is absent)

The Common Denominator reports are now DB-stored `Report` rows (system source
`COMMON_DENOMINATOR`, converted from the old hard-coded pairing cron by
`scripts/convert-common-denominator-reports.ts`; see
`archive/completed/2026-05-17_scout-scheduled-sql-reports.md`). All 5 seeded
queries filter `games >= 10` over a rolling 30-day window and print only the
top/bottom ~10-25 rows.

Queried the live `scout-beta` pod (`kubectl -n scout-beta exec
deploy/scout-beta-scout-backend`, read-only `bun:sqlite` against
`/data/db.sqlite`) as of the last scheduled run
(`2026-07-26T18:00:00.031Z`):

- Jerred **is** a registered `Player` (id 1, `serverId
1337623164146155593`) with a linked `Account` (`sjerred#sjerr`,
  `AMERICA_NORTH`).
- Ranked (solo+flex) games in the 30-day window: **14** (6 solo + 8 flex) —
  above the `games >= 10` floor.
- Surrenders in that window: 2 → surrender rate **14.3%**, well under the
  #10 spot on Surrender Leaders (Hirza, 23.5%). Excluded by ranking, not
  eligibility — a low surrender rate is the good outcome here.
- Most frequent teammate in the window: Danny at **8 of 14** games — 2 short
  of the pairing floor. Every other teammate (Aaron 5, Virmel 4, Long 4, Dan/
  Ryan/Edward 2, Irfan/Colin/Zhi 1) is further off. No duo/trio combo reaches
  10 games together, so no group row prints.

Conclusion: not a bug. Below the pairing threshold, and better than the
surrender-leader cutoff.

## Findings — Part 2 (top-3 mentions)

Current live renderer (`packages/scout-for-lol/packages/backend/src/reports/output.ts`)
prints plain-text labels for `LEADERBOARD`-kind reports — no `@mention`s at
all (a regression from the retired hard-coded `weekly-update.ts`, which did
mention top-3 pairing entries via an alias→Discord-ID map built from
`getServerPlayers`/`createAliasToDiscordIdMap`).

## Implementation — Part 2

- `reports/alias-mentions.ts` (new): `loadAliasToDiscordId(prisma, serverId)`
  — DI'd `ExtendedPrismaClient`, queries `Player` rows for the server, returns
  an alias→Discord-ID map (players with no linked Discord ID are omitted).
- `reports/mention-format.ts` (new): `formatRankedLabel(label, index,
aliasToDiscordId)` — for `index < TOP_MENTION_COUNT` (3), splits the label
  on `" + "` (group rows look like `"Danny + Aaron + Kendrick"`) and replaces
  each alias with `<@discordId>` when known, else leaves the plain alias.
  Extracted to its own file to keep `output.ts` under the repo's 500-line
  ESLint cap.
- `reports/output.ts`: `RenderReportOutputParams` gained an optional
  `aliasToDiscordId` map (defaults to an empty `Map`, so the chart-only tRPC
  preview call site and existing tests are unaffected); the ranked/default
  text branch of `formatTextReport` now runs each row's label through
  `formatRankedLabel`.
- `reports/runner.ts`: `runReport` now calls `loadAliasToDiscordId(params.prisma,
params.report.serverId)` before rendering and passes the result through —
  every scheduled/manual report run gets live mentions with no additional
  wiring.
- Added 5 integration tests to `report-render.integration.test.ts`: top-3
  mention vs. rank-4+ plain alias, missing-Discord-ID fallback, group-label
  per-member mentions, full `runReport` pipeline pulling the map from live
  `Player` rows, and `loadAliasToDiscordId` omitting unlinked players.
  Extended `cleanup()` to also clear the `Player` table between tests.

## Session Log — 2026-07-26

### Done

- Diagnosed Jerred's absence from Common Denominator reports via live
  read-only beta DB queries (see Findings — Part 1 above). No code change
  needed for that half of the question.
- Implemented Discord `@mention`s for the top 3 rows of any
  `LEADERBOARD`-rendered report (see Implementation — Part 2 above), in
  worktree `scout-common-denominator-mentions` / branch
  `feature/scout-common-denominator-mentions`.
- Verified: `bun run typecheck`, `bunx eslint` (0 errors, pre-existing
  duplication warnings only), `bun test src/reports/` (93 pass), full backend
  `bun run test` (1190 pass, 6 skip, 0 fail), and root `bun run verify --
--affected` (21/21 tasks green, including prettier after an autofix).

### Remaining

- None for this session's scope. The next scheduled Common Denominator run
  (Sundays 18:00 UTC) will be the first live proof the mentions render
  correctly in Discord — worth a spot-check after it fires.

### Caveats

- Not verified against a live Discord message send — integration tests cover
  the rendered text content, not the actual Discord API call. `<@discordId>`
  is standard Discord mention markup, so this is expected to render
  correctly, but hasn't been visually confirmed in a channel.
- The mention feature applies to every `LEADERBOARD`-rendered report (system
  and user-created), not just the Common Denominator reports, since that is
  where the shared renderer lives.

## Implementation — Part 3 (configurable top-N / all)

Follow-up request: make the top-3 mention count configurable instead of
hardcoded. Followed the existing precedent — every other render knob (chart
`title`, `theme`, `sort`, `smooth`, …) is a `key = value` pair inside the
query's trailing `RENDER <kind> WITH (...)` clause, so `mentions` became
a new `WITH` option scoped to `RENDER leaderboard`, not a new Prisma column
or slash-command flag. Full design in
`~/.claude/plans/for-the-mention-whimsical-nova.md`.

- `packages/scout-for-lol/packages/data/src/model/report.ts`: added
  `ReportLeaderboardOptionsSchema` (`mentions: number | "all"`, mirroring the
  existing `ReportGroupSizeSchema` `number | "all"` precedent) and gave the
  `LEADERBOARD` member of `ReportRenderSpecSchema` a defaulted `options`
  field (previously a bare `{ kind: "LEADERBOARD" }` literal).
- `packages/scout-for-lol/packages/data/src/model/report-query-render.ts`:
  split `LEADERBOARD` out of the "non-chart kinds reject any WITH clause"
  branch into its own `parseLeaderboardRenderWith`, which accepts only
  `mentions` (any other key, e.g. `theme`, throws
  `Unknown RENDER option "..." for RENDER leaderboard`) and validates the
  value is a non-negative integer or the literal `all`.
- `packages/scout-for-lol/packages/data/src/model/report-query-registry.ts`:
  added a `mentions` docs-registry entry alongside the existing chart options
  (that registry doesn't scope options per-kind today; left that pre-existing
  gap alone).
- `packages/scout-for-lol/packages/backend/src/reports/mention-format.ts`:
  renamed the hardcoded `TOP_MENTION_COUNT` to `DEFAULT_MENTION_COUNT`
  (fallback only) and added `resolveMentionCount(mentionsOption, totalRows)`
  — `"all"` resolves to every row, `undefined` falls back to the default,
  `0` naturally disables mentions via the existing `index >= mentionCount`
  check.
- `packages/scout-for-lol/packages/backend/src/reports/output.ts`:
  `formatTextReport` now takes the full narrowed `render` spec (typed
  `Exclude<ReportRenderSpec, ChartRender>`) instead of just `render.kind`, so
  it can read `render.options.mentions` when the kind is `LEADERBOARD`;
  bundled `aliasToDiscordId` into a small `MentionOptions` object to stay
  under the repo's 4-param ESLint limit.
- Tests: 6 new parser-level tests in `report-query.test.ts` (count, `all`,
  `0`, unknown-option rejection, negative/non-integer rejection) plus updated
  the two existing bare-`LEADERBOARD` assertions (`report.test.ts`,
  `report-query.test.ts`) for the new `options: {}` default. 3 new
  integration tests in `report-render.integration.test.ts` covering
  `mentions = 1`, `mentions = all`, and `mentions = 0` end-to-end; split the
  describe block that grew past the repo's 200-line-per-function ESLint cap
  into three smaller, purpose-named blocks.
- Cleaned up a local, gitignored `packages/scout-for-lol/packages/backend/logs/app.log`
  test-run artifact that was tripping `gitleaks`' `generic-api-key` heuristic
  on a benign S3 key path (`prematch/2026/07/26/...`) — not part of the diff,
  gitleaks scans the working tree regardless of `.gitignore`.
- Verified: data-package `bun run typecheck` + `bun test` (494 pass, 0 fail,
  includes the 6 new tests), backend `bun run typecheck` + full
  `bun run test` (1193 pass, 6 skip, 0 fail, up from 1190), `bunx eslint` on
  every changed file (0 errors, pre-existing duplication warnings only), and
  root `bun run verify -- --affected` (51/51 tasks green).

### Remaining (updated)

- Same as before — no code work left in scope. Worth confirming
  `RENDER leaderboard WITH (mentions = ...)` end-to-end in a real Discord
  channel next time a report is created/edited with it, alongside the
  original top-3 spot-check.

### Caveats (updated)

- The live seeded Common Denominator reports on `scout-beta` were
  deliberately left untouched (still bare `RENDER leaderboard`, defaulting to
  top 3) — bumping them to a different `mentions` value is a manual
  `/report update` follow-up, not part of this change.

## Session Log — 2026-07-26 (Codex review remediation)

### Done

- Replaced label-derived mention lookup with structured player and player-group
  identities in the report result pipeline, so non-player rows cannot ping a
  player merely by sharing an alias.
- Validated every non-null stored player Discord ID before using it for a
  report; only `null` remains the unlinked-player representation.
- Split report delivery into Discord-safe chunks for scheduled reports,
  `/report run`, and web-triggered report posts, preserving an attachment on
  the first chunk only.
- Rejected empty `mentions` values, documented the option/default/opt-out in
  Scout's guide, and added the repository copy of the configurable-mentions
  implementation plan.

### Remaining

- Commit and publish the Codex review remediation to PR #1678, then await its
  Buildkite and review-gate results.

### Caveats

- The local integration suite logs its expected isolated test-database metrics
  warning and best-effort S3 credential warning; the targeted suite passed.

## Session Log — 2026-07-26 (follow-up Codex remediation)

### Done

- Made the live player map authoritative for text report delivery, so a player
  unlinked after a report-lake fold no longer receives a stale snapshot mention.
- Made Discord chunking preserve complete fenced tables in every split message.
- Made missing group member identities fail the report instead of silently
  rendering an empty group label.
- Added targeted regression coverage for the unlink and fenced-table cases.

### Remaining

- Commit and publish this follow-up to PR #1678, then await the new Buildkite
  review gate and any fresh Codex findings.

### Caveats

- Targeted integration tests emit the expected isolated metrics-database and
  unset-S3 warnings; the tests themselves pass.

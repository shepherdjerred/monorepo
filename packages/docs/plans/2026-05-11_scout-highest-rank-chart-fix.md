# Fix scout-for-lol HIGHEST_RANK chart drops-to-0

## Status

Partially Complete — code changes ready (branch `fix/scout-highest-rank-iron-iv`, unmerged); S3 cleanup applied to beta + prod.

## Context

The `Highest Solo Q` competition chart for scout-beta shows several players' ladder-point lines dropping straight to 0 then jumping back to ~2000 LP a snapshot or two later (e.g. Brandon, Kendrick, Joel, Edward in Feb–Mar). The dips are not real rank decay — they are synthetic Iron IV / 0 LP entries fabricated whenever a Riot League API fetch fails, then persisted into the S3 snapshot.

**Root cause.** `processHighestRank` (`highest-rank.ts:37-55`) invents a fake Iron IV / 0 LP entry for any participant missing from `currentRanks`. But `currentRanks` is missing a participant in two distinct, indistinguishable cases:

1. The player is genuinely unranked (no placement games).
2. Every account's Riot API call threw — `fetchCurrentRanks` warned and moved on, returning `{}`.

Both produce Iron IV / 0 LP in the snapshot, which `s3-leaderboard.ts:88-140` writes verbatim. The chart then faithfully plots the 0.

The intended pattern already exists in `most-rank-climb.ts:29-65`: skip participants without rank data and log the reason. The chart's `buildSeries` (`chart-builder.ts:101-114`) already emits `{ value: null }` for missing entries and breaks the line cleanly — so the fix is to stop fabricating.

This plan covers three changes the user asked for:

1. **Stop the fabrication** so no new bad data lands.
2. **Hide line-chart dot markers** — the user wants only lines on the chart.
3. **Clean the existing bad data** for the active competition out of S3.

## Files to change

| #   | File                                                                                           | Change                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/scout-for-lol/packages/backend/src/league/competition/processors/highest-rank.ts`    | Delete the `else` branch (lines 37–55) that synthesizes Iron IV / 0 LP. Add a `logger.info` skip line.                                                                                                                                                                                                                                       |
| 2   | `packages/scout-for-lol/packages/backend/src/league/competition/processors/processors.test.ts` | Add `processHighestRank` cases for: (a) participant absent from `ranks`, (b) participant present but `solo` undefined, (c) mixed — all should produce shorter entry lists, no synthetic Iron IV.                                                                                                                                             |
| 3   | `packages/scout-for-lol/packages/report/src/html/competition-chart.ts`                         | Line-chart series (lines 249–272): set `showSymbol: false` and drop `symbol`/`symbolSize`. **Do not touch** bar series (lines 275–368) — bars have no `showSymbol`. Keep `SYMBOL_SHAPES`/`symbolFor` only if still referenced by legend rendering; otherwise delete with the dot props to avoid dead code.                                   |
| 4   | `packages/scout-for-lol/packages/report/src/html/competition-chart.fixtures.test.ts`           | Update snapshot assertions if they pin marker props; otherwise leave alone.                                                                                                                                                                                                                                                                  |
| 5   | NEW `packages/scout-for-lol/packages/backend/scripts/cleanup-iron-iv-entries.ts`               | One-shot Bun script: list every snapshot for a given competition id, strip entries whose score matches the exact synthetic shape `{ tier: "iron", division: 4, lp: 0, wins: 0, losses: 0 }`, renumber remaining `rank` fields, save back to both `current.json` and per-day `snapshots/YYYY-MM-DD.json`. Idempotent (re-running is a no-op). |

## Implementation outline

### Change 1 — `highest-rank.ts`

Replace the `if (rank) { … } else { synthesize Iron IV … }` block with:

```ts
if (!rank) {
  logger.info(
    `[processHighestRank] Skipping participant ${participant.id} (${participant.alias}) — no ${criteria.queue.toLowerCase()} rank data (unranked or fetch failed)`,
  );
  continue;
}
entries.push({
  playerId: participant.id,
  playerName: participant.alias,
  score: rank,
  metadata: { leaguePoints: rankToLeaguePoints(rank) },
  discordId: participant.discordId,
});
```

Mirror the logger usage from `most-rank-climb.ts:1-10`.

### Change 3 — `competition-chart.ts` (report)

In the line-chart series build (around lines 249–272 per Explore), change:

```ts
showSymbol: true,
symbol: symbolFor(index),
symbolSize: 14,
```

to:

```ts
showSymbol: false,
```

Drop `itemStyle` only if it exclusively styled the marker (verify it's not used for line color too — read lines 264–268 first when implementing).

If `SYMBOL_SHAPES` / `symbolFor` become unused, delete them rather than leaving dead exports.

### Change 5 — Cleanup script

```bash
bun run packages/scout-for-lol/packages/backend/scripts/cleanup-iron-iv-entries.ts <competitionId>
```

Behavior:

1. Use the existing S3 client from `packages/scout-for-lol/packages/backend/src/storage/s3-client.ts` (no new credential plumbing).
2. `ListObjectsV2` under `leaderboards/competition-{id}/` to enumerate `current.json` and every `snapshots/YYYY-MM-DD.json`.
3. For each object:
   - `GetObjectCommand` → `JSON.parse` → validate with `CachedLeaderboardSchema` (`packages/data/src/model/competition.ts:502-512`).
   - Filter `entries`: drop any entry where `score` deep-equals `{ tier: "iron", division: 4, lp: 0, wins: 0, losses: 0 }`. Other Iron IV / non-zero-LP entries are real and kept.
   - Re-sort surviving entries by their existing rank order and renumber `rank: 1..N`.
   - Re-validate, `PutObjectCommand` with `ContentType: application/json`.
4. Log a diff per file: `competition-9/snapshots/2026-02-13.json: 28 → 26 entries (removed 2 Iron-IV-0LP)`.
5. Dry-run mode: `--dry-run` flag prints what would change without writing.

Run order — **always `--dry-run` first**, inspect the diff, then apply.

This removes both bona-fide unranked entries and synthetic fetch-failure entries; for a HIGHEST_RANK chart that's the right call because unranked players carry no information for "highest rank" anyway.

## Downstream impact — verified safe

- **Chart `buildSeries`** (`chart-builder.ts:101-114`) already handles missing per-snapshot entries via `{ value: null }`. With markers hidden, gaps now look like clean line breaks. ✓
- **Discord embed / daily update** — shorter entry lists; unranked players don't appear in top-N for a "highest rank" board. ✓
- **S3 writer** (`s3-leaderboard.ts:70-159`) — serializes whatever it's given. ✓
- **`CachedLeaderboardEntrySchema`** unchanged — still `{ score: number | Rank, rank: positive int }`. Cleanup script's renumber keeps the invariant. ✓

## Cleanup scope (confirmed)

- Run against **every currently-ACTIVE competition on both scout-beta and scout-prod**.
- Strip **all** entries whose score deep-equals the synthetic Iron IV / 0 LP shape — no per-player heuristic. Matches the post-fix behavior (unranked players no longer appear in HIGHEST_RANK leaderboards regardless).

Operational steps:

1. From each env's running pod, hit Prisma to enumerate competitions where `getCompetitionStatus(c) === "ACTIVE"`. Easiest: a tiny `listActiveCompetitions.ts` helper that prints `[id, title]` to stdout, run via `kubectl exec`. Or fold the listing into the cleanup script with a `--all-active` flag.
2. Run `cleanup-iron-iv-entries.ts <id> --dry-run` per competition id.
3. Inspect diffs. Apply with the same command minus `--dry-run`.
4. Repeat for scout-prod against its S3 endpoint (uses the same S3 client, just different `S3_BUCKET_NAME` env in the pod).

I'll prefer `--all-active` baked into the same script over a separate helper — fewer moving parts, one command per env.

## Verification

1. **Unit tests.** `cd packages/scout-for-lol/packages/backend && bun test src/league/competition/processors/processors.test.ts` — new no-rank cases pass; existing suite green.
2. **Report tests.** `cd packages/scout-for-lol/packages/report && bun test` — line-chart fixture renders without dots; bar chart unchanged.
3. **Typecheck + lint.** `bun run typecheck && bunx eslint . --fix` in both `packages/scout-for-lol/packages/backend` and `packages/scout-for-lol/packages/report`.
4. **Cleanup dry-run.** `bun run packages/scout-for-lol/packages/backend/scripts/cleanup-iron-iv-entries.ts <id> --dry-run` — review the per-file diff before applying.
5. **Cleanup apply.** Re-run without `--dry-run`. Re-run a second time and confirm zero changes (idempotency).
6. **Beta deploy verification.** Trigger or wait for the next daily snapshot. Pull `current.json` from S3; confirm fetch-failed/unranked players are absent from `entries` rather than carrying Iron IV 0 LP. Use `/competition view` in the test guild; chart shows dot-less lines with clean breaks for any failures.
7. **Production rollout.** Same as beta — fix forward + targeted cleanup. No new dips, dot-less chart, historical dips for competition 9 gone.

## Session Log — 2026-05-11

### Done

- Stopped the synthetic Iron IV / 0 LP fabrication in `processHighestRank` (`packages/scout-for-lol/packages/backend/src/league/competition/processors/highest-rank.ts`) — missing-rank participants are now skipped with a logger.info, mirroring `most-rank-climb.ts`.
- Updated `processors.test.ts`: existing "should use unranked (Iron IV)" case rewritten to assert skip behavior; added two new cases for queue-specific skip and a sweeping "no Iron IV fabricated" assertion. All 869 backend tests + 39 report tests pass; backend + report typecheck and eslint clean.
- Disabled line-chart dot markers in `packages/scout-for-lol/packages/report/src/html/competition-chart.ts` (`showSymbol: false`); moved line color into `lineStyle.color`, dropped marker-only `borderColor`/`borderWidth`; replaced now-vestigial `SYMBOL_SHAPES`/`symbolFor` with a named `SOLID_LINE_THRESHOLD = 5` constant that `lineDashFor` still uses.
- Wrote `packages/scout-for-lol/packages/backend/scripts/cleanup-iron-iv-entries.ts` — one-shot Bun script supporting `<id>` / `--all-active` and `--dry-run`. Lists `leaderboards/competition-{id}/**/*.json`, drops entries whose score deep-equals the synthetic Iron IV shape, renumbers `rank`, re-validates with `CachedLeaderboardSchema`, writes back.
- Applied cleanup against both envs via `kubectl exec`:
  - scout-beta: comp 10 "Best Solo Queue" — 100 files changed, 1752 entries removed; comp 9 "Most League of Legends" — 0 changes.
  - scout-prod: comp 9 "Classement" — 0 changes; comp 3 "Ranked" — 3 files changed, 8 entries removed.
  - Re-ran dry-run on both — 0 deltas → idempotency confirmed.
- Mirrored plan to `packages/docs/plans/2026-05-11_scout-highest-rank-chart-fix.md` and added entry to `packages/docs/index.md`.

### Remaining

- Open the PR for branch `fix/scout-highest-rank-iron-iv`, get it through CI, merge to `main`.
- After merge: prod rollout via ArgoCD/normal deploy path; no further S3 cleanup needed (cleanup is already applied to both envs).
- Once shipped, update this doc's Status to `Complete` and `git mv` to `packages/docs/archive/completed/`; prune the entry from `packages/docs/index.md` under `## Plans`.

### Caveats

- A handful of historical days in beta comp 10 (`2026-02-12`–`14`) and prod comp 3 (`2026-02-17`, `2026-02-20`) dropped to **zero entries** after cleanup — every participant was synthetic Iron IV on those days, meaning the underlying Riot API fetch failed cluster-wide. The chart will now show a clean break for those dates (line discontinuity via `connectNulls: false`) instead of a dive to 0. This is the intended behavior but worth knowing if anyone asks "where did 2026-02-13 go in the chart".
- Cleanup script is one-shot; not added to CI or to a Discord command. If the user wants ongoing maintenance, schedule via a cron / Discord debug command.
- Beta + prod pods received the script via `kubectl cp` to `/workspace/.../scripts/`. That copy is ephemeral and will disappear on the next restart — harmless, because the script ships in the branch via the same path and is only needed once.
- HIGHEST_RANK competitions will no longer show genuinely-unranked participants in the leaderboard at all (they're skipped, not zeroed). Matches the post-fix intent but is a visible behavior change for users who relied on seeing "Iron IV 0 LP" rows.

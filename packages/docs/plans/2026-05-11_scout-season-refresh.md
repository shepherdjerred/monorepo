# Scout for LoL — Season-Date Refresh

## Status

In Progress

## Context

Scout for LoL's `/competition` Discord command exposes season "presets" via `getSeasonChoices()` (start/end dates for `SEASON`-type competitions). As of 2026-05-11, the most recent defined season (`2026_SEASON_1_ACT_2` "For Demacia Act 2") ended **2026-04-30** — the dropdown is empty.

Riot launched **Season 2 "Pandemonium"** with Patch 26.09 on **2026-04-29**. Two acts confirmed; Season 3 not yet announced.

There is no reliable Riot API for season boundaries (`seasons.ts:7` comment confirms manual maintenance), and Riot occasionally adjusts dates mid-season. The plan delivers both an immediate fix and a recurring drift-check.

## Deliverables

| #   | Deliverable                                                                 | Status                                                         |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | One-shot update to `seasons.ts` with Pandemonium Acts 1 + 2                 | PR [#775](https://github.com/shepherdjerred/monorepo/pull/775) |
| 2   | Temporal workflow `runScoutSeasonRefreshWorkflow` — code only (no schedule) | PR [#777](https://github.com/shepherdjerred/monorepo/pull/777) |
| 3   | Follow-up PR — register `scout-season-refresh-weekly` cron (Mon 07:00 PT)   | Pending manual UI trigger after #777                           |

## Part 1 — Manual fix

`packages/scout-for-lol/packages/data/src/seasons.ts`:

- Add `2026_SEASON_2_ACT_1` "Pandemonium (Act 1)" — 2026-04-29 → 2026-06-09
- Add `2026_SEASON_2_ACT_2` "Pandemonium (Act 2)" — 2026-06-10 → 2026-08-12
- Fix `2026_SEASON_1_ACT_2.endDate` from 2026-04-30 to 2026-04-28 to preserve the 1-day gap convention.

Sources: <https://wiki.leagueoflegends.com/en-us/Pandemonium>, <https://wiki.leagueoflegends.com/en-us/2026_Annual_Cycle>.

## Part 2 — Weekly workflow

Pattern mirrors `data-dragon.ts` (clone + git + gh) and `pr-agent.ts` / `homelab-audit.ts` (claude -p lifecycle).

### Flow

1. Clone monorepo shallow into `/tmp/scout-season-refresh-<uuid>/monorepo`.
2. Spawn `claude -p` with tools `WebFetch,WebSearch,Read,Edit,Bash,Glob,Grep`. Auth: `CLAUDE_CODE_OAUTH_TOKEN` (ANTHROPIC_API_KEY stripped to use subscription).
3. Prompt: research current LoL season schedule from ≥2 sources; if drifted, edit seasons.ts (never rename existing IDs); print sentinel `NO_DRIFT` or `DRIFTED`.
4. `git status --porcelain --` on the seasons files. Empty → `no-drift` result, no PR. Dirty → branch + commit + `gh pr create` (NO auto-merge).
5. Cleanup tempdir.

### Files

| Path                                                                   | Purpose                                |
| ---------------------------------------------------------------------- | -------------------------------------- |
| `packages/temporal/src/activities/scout-season-refresh.ts`             | Main `run()` orchestration             |
| `packages/temporal/src/activities/scout-season-refresh-claude.ts`      | `claude -p` subprocess wrapper         |
| `packages/temporal/src/activities/scout-season-refresh-git.ts`         | git/gh helpers + `openSeasonRefreshPr` |
| `packages/temporal/src/activities/scout-season-refresh-prompt.ts`      | Prompt builder                         |
| `packages/temporal/src/activities/scout-season-refresh-prompt.test.ts` | 8 prompt safety unit tests             |
| `packages/temporal/src/workflows/scout-season-refresh.ts`              | Workflow wrapper                       |
| `packages/temporal/scripts/run-scout-season-refresh-local.ts`          | Local Layer-2 harness                  |
| `packages/temporal/src/observability/metrics.ts`                       | 4 new Prometheus metrics               |

### Cron (Part 3, separate PR)

```ts
{
  id: "scout-season-refresh-weekly",
  workflowType: "runScoutSeasonRefreshWorkflow",
  args: [],
  cronExpression: "0 7 * * 1",  // Mondays 07:00 America/Los_Angeles
  taskQueue: TASK_QUEUES.DEFAULT,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "30 minutes",
  memo: "Weekly LoL season-date drift check (claude -p → PR if drifted)",
}
```

Also: add `runScoutSeasonRefreshWorkflow` to `WORKFLOWS_WITHOUT_LONG_SLEEPS` in `register-schedules.test.ts` (workflow has no `sleep()` calls).

## Verification

### Acceptance gate before scheduling

Local Layer-2 harness (`scripts/run-scout-season-refresh-local.ts`) must produce a clean run before the cron lands.

| Scenario                                                                                                                | Status                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **C2 — drift detected** (DRY_RUN=1, default fresh-clone of origin/main, Opus, 40 turns)                                 | **PASS** — 28 turns, $1.64, 229s. Diff covers Pandemonium Act 1+2 + For Demacia date corrections. `pr-skipped-dry-run` outcome reported. |
| **C1 — no drift** (run after PR #775 + #777 merge, then again with the cron-PR's seasons.ts matching claude's research) | Deferred until #775 + #777 merge                                                                                                         |
| **Cluster Trigger Now** — manual workflow start from Temporal UI                                                        | Pending #777 merge                                                                                                                       |

### Static checks

- `bun run typecheck` (temporal pkg) — clean
- `bun test src/workflows/bundle.test.ts` — webpack pass succeeds (workflow is registered without breaking the bundle)
- `bunx eslint` on new files — clean (no max-lines / complexity / max-params / non-null-assertion violations)
- `bun test src/activities/scout-season-refresh-prompt.test.ts` — 8 prompt-safety tests pass

## Cost & operational

- ~$1.64 per Opus run → ~$85/year for weekly schedule
- ~4 minutes wall time per run (heartbeat-protected via `heartbeatTimeout: 60s`)
- Outputs to Prometheus: `scout_season_refresh_{runs,duration_seconds,subprocess_exit,tokens}_total`

## Decisions explicitly made

- **No auto-merge** — season dates affect persisted `Competition.seasonId` rows. Human reviews every diff.
- **Mondays 07:00 PT** — early in the week, before existing 09:00 `deps-summary-weekly`, lands a PR in the morning queue.
- **Stripping `ANTHROPIC_API_KEY`** in the subprocess env — uses OAuth subscription (free under Claude Pro) instead of direct-API credits. Matches `pr-agent.ts`.
- **No Riot API integration** — none exists for season boundaries.

## Session Log — 2026-05-11

### Done

- Researched current LoL season schedule, confirmed Pandemonium Act 1 (2026-04-29 → 2026-06-09) and Act 2 (2026-06-10 → 2026-08-12) from LoL wiki + esports.gg + sheepesports.
- Opened PR [#775](https://github.com/shepherdjerred/monorepo/pull/775) — manual seasons.ts update.
- Implemented `runScoutSeasonRefreshWorkflow` + activity + helpers + harness in dissociated clone `~/git/monorepo-scout-season-refresh`.
- Verified C2 scenario locally: drift detection works end-to-end against a fresh origin/main clone ($1.64 Opus run, expected diff produced).
- Opened PR [#777](https://github.com/shepherdjerred/monorepo/pull/777) — workflow code, no schedule.

### Remaining

- Wait for PR #775 + #777 to merge.
- Manually trigger `runScoutSeasonRefreshWorkflow` from Temporal UI; confirm clean run.
- Open follow-up PR adding `scout-season-refresh-weekly` cron + `WORKFLOWS_WITHOUT_LONG_SLEEPS` entry.
- After cron lands, mark plan Status: Complete and `git mv` to `archive/completed/`.

### Caveats

- Claude's first run proposed slight date adjustments to existing For Demacia acts (01-09 → 01-08, 03-04 → 03-03). These may be correct (claude found different sources) — the human-review-required model handles this. The workflow does NOT rename existing season IDs, only adjusts dates.
- The local harness requires `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` from 1Password vault `Homelab (Kubernetes)` (UUID `v64ocnykdqju4ui6j6pua56xw4`), item `temporal-worker-secrets`.
- Two pre-existing `register-schedules.test.ts` failures (about `prReviewWeeklySignificanceWorkflow` and `prReviewEvalWorkflow` not classified) are present on `main` and unrelated to this work.

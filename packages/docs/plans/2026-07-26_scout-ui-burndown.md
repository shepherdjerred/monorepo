---
id: scout-ui-burndown
type: plan
status: in-progress
board: false
---

# Scout for LoL — UI burn-down / polish

Session plan mirrored from the harness plan (`~/.claude/plans/scout-for-lol-swift-penguin.md`).
Baseline: app 2.0.0-6319 (d71e630) · api 6277 (b4948f0). One big PR from worktree
`.claude/worktrees/scout-ui-burndown`, branch `feature/scout-ui-burndown`.

## Issue list

| #   | Item                                  | Root cause / design (short)                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Version footer commit links           | `app/src/components/version-info.tsx:97-105`; full SHAs available; link to `github.com/shepherdjerred/monorepo/commit/<sha>`                                                                                                                                                                 |
| 2   | Queue availability infra              | New `data/src/model/queue-availability.ts`: total `Record<QueueType, {kind:"permanent"}\|{kind:"limited",windows:{start,end\|null}[]}>` + helpers + CompetitionQueueType mapping. Pickers hide unavailable by default + "show unavailable" toggle (greyed). Seed windows from wiki research. |
| 3   | Open-to-all vs server-wide clarity    | `visibilityDescription()` in `data/src/model/competition.ts`; two-line Select options; muted line on detail page                                                                                                                                                                             |
| 4   | Season selector dates                 | `competition-dates-fields.tsx` renders date ranges from `getAllSeasons()`; don't touch `getSeasonChoices` (Discord shape)                                                                                                                                                                    |
| 5   | Champion combobox                     | New `champion-combobox.tsx` over `ui/combobox.tsx` + `reportChampions()`; replaces number input at `competition-criteria-fields.tsx:108-122`                                                                                                                                                 |
| 6   | Wizard: SQL behind Advanced toggle    | Wizard only; collapsible around Monaco editor in `report-form-fields.tsx:139-152`                                                                                                                                                                                                            |
| 7   | Custom cron unselectable              | `report-schedule-fields.tsx:50-55` no-ops on "custom"; make it switch to custom mode + focus raw input                                                                                                                                                                                       |
| 8   | Timezone picker                       | Full IANA list (`Intl.supportedValuesOf`), offsets in labels, searchable combobox, default to user TZ                                                                                                                                                                                        |
| 9   | Next-3-runs display                   | Label "Next 3 runs", render in user local TZ with TZ abbreviation                                                                                                                                                                                                                            |
| 10  | Navbar dropdown redesign              | `user-menu.tsx`; missing `gap-2` on Report-a-bug; general cleanup                                                                                                                                                                                                                            |
| 11  | Active-only shows ended flex comp     | Season relation not joined in player serializer + null endDate treated as active; fix serializer (`parseCompetition` + status), filter on status                                                                                                                                             |
| 12  | Subscriptions table redesign          | Collapse 5 inline row actions into kebab DropdownMenu; tidy Filters cell                                                                                                                                                                                                                     |
| 13  | Player Discord card polish            | `player-detail.tsx:188-250` layout redo                                                                                                                                                                                                                                                      |
| 14  | Competition presets on create page    | New shared `competition-presets.tsx` rendering `COMPETITION_EXAMPLES` on `competition-form.tsx` (!isEdit)                                                                                                                                                                                    |
| 15  | "Played at" explorer crash            | `backend/src/reports/data-explorer.ts:317` `normalizeValue` lacks DuckDB timestamp-object branch → ISO string                                                                                                                                                                                |
| 16  | Data explorer breadth                 | Expose all useful lake columns (grouped) AND remaining ScoutQL sources; DuckDB-over-parquet lake (not S3)                                                                                                                                                                                    |
| 17  | Empty query red bar                   | Seed `EMPTY_REPORT_STATE.queryText` with valid starter ScoutQL                                                                                                                                                                                                                               |
| 18  | Best-practices pass                   | React Query/tRPC audit, a11y, modern browser APIs (agents reporting)                                                                                                                                                                                                                         |
| 19  | Player/sub/account flow consolidation | Flow map in progress; biggest UX pain per user                                                                                                                                                                                                                                               |

## User decisions

- Hide out-of-window queues by default + reveal toggle (greyed).
- One big PR.
- Explorer: all useful columns + additional sources.
- Advanced/SQL collapsible in wizard only.

## Queue availability research (seed data)

- Arena (1700/1750): Jul 20–Aug 28 2023; Dec 7 2023–Jan 8 2024; May 1–Sep 24 2024; ~Mar–May 14 2025; current run from V25.13 (Jul 2025), open-ended (committed ≥ Jun 2026).
- Nexus Blitz: 2018, 2020, Oct 25–Nov 27 2023 runs (not currently a QueueType).
- Doom Bots (3130/4220/4250): 2016–17 RGM weekends; Aug–Oct 2025 (V25.17–V25.20 Trials of Twilight).
- URF/ARURF/Ultimate Spellbook/One for All/Brawl/ARAM Mayhem/Swarm: needs per-mode patch-notes pass during implementation.
- Sources: wiki.leagueoflegends.com per-mode pages; static.developer.riotgames.com/docs/lol/queues.json.

## Progress (2026-07-26)

Committed on `feature/scout-ui-burndown`:

1. `fix(scout-for-lol): resolve season dates for player-page competitions` — active-only bug (#11) + humanized labels.
2. `feat(scout-for-lol): expand data explorer to full lake schema + fix timestamps` — #15 + #16 (columns; extra ScoutQL sources deliberately excluded — they're aggregate, competition-scoped leaderboards, not row-level browse tables).
3. `feat(scout-for-lol): queue availability windows + champion name combobox` — #2 (hide+toggle) + #5.
4. `feat(scout-for-lol): report scheduling UX …` — #6, #7, #8, #9, #17 (custom cron, IANA tz combobox + offsets + local default, labeled next-runs in local tz, starter query, wizard Advanced collapse).

Pending commit: competition UX (#3, #4, #14 — visibility descriptions, season dates in selector, presets on create page), visual polish (#1, #10, #12, #13), flow consolidation (#19 subset: Track-player entry on Players tab, auto-poll unresolved accounts, alias→"Player name" label, Manage-subscriptions link, prefetch-on-hover), best-practices (#18 subset: optimistic mute, keepPreviousData, retry-skips-4xx, refetch→invalidate, nested-main fix, role=status/alert, contrast token, gap-2 in DropdownMenuItem base).

Deliberately deferred (candidates for follow-up todos): ScoutQL preview-as-query rewrite (needs a backend query procedure), full combobox ARIA listbox/activedescendant keyboard pattern, useSuspenseQuery + error-boundary refactor, React Router data-router loaders, full IA redesign of player/sub/account surfaces (deeper than this PR).

## Session Log — 2026-07-26

### Done

- All 19 issue-list items addressed across 8 commits on `feature/scout-ui-burndown`; PR #1681 opened and marked ready for review with 15 e2e screenshots (uploaded to public.sjer.red via `toolkit pr asset`).
- New shared infra: `data/src/model/queue-availability.ts` (per-queue availability windows + helpers + competition-queue mapping, seeded from wiki/patch-notes research; tests with fixed clock).
- Bug fixes with regression tests: player-page active-only filter (season join + computed status), data-explorer DuckDB timestamp normalization, custom-cron selection.
- Report scheduling UX (full IANA tz combobox with offsets + local default, labeled local-tz next-runs, starter query, wizard Advanced collapse), data-explorer column expansion (~60 match cols, grouped, default-visible subset), competition UX (season dates, visibility descriptions, champion combobox, shared presets), subscriptions kebab + badges + optimistic mute, user-menu redesign, version-footer commit links (guarded for dev builds), player-card definition grids, flow fixes (Track player entry, auto-poll unresolved accounts, Player-name label, Manage-subscriptions link), React Query + a11y fixes.
- Verified: `bun run verify -- --affected` green; every commit passed the full pre-commit gate; e2e against local `dev:web` (real Discord OAuth via PinchTab scout-e2e profile + prompt=none, real Riot ID resolution).

### Remaining

- CI (Buildkite) + code review on PR #1681; watch `buildkite/monorepo/pr` + review-gate.
- Follow-up candidates (deliberate deferrals): ScoutQL preview-as-query (backend query procedure needed), full ARIA combobox keyboard pattern, useSuspenseQuery/error-boundary refactor, data-router loaders, deeper player/sub/account IA redesign, explorer tables for aggregate ScoutQL sources if still wanted.

### Caveats

- Queue windows are hand-maintained (seasons-style): when Riot starts/ends a mode run, append/close a window in `queue-availability.ts`. Pre-2024 historical windows are approximate; only current-window membership drives UI.
- Explorer "more sources" consciously excluded (aggregate, competition-scoped — don't fit a row-level browser); flagged in the PR for redirect.
- The three doom-bots QueueTypes all display as "doom bots" (pre-existing display-name duplication, now visible as three identical greyed rows in the picker).
- Version-footer commit links only render for real 40-char SHAs — local/dev builds show plain text by design.
- `dev:web` was run locally for screenshots (beta bot briefly disconnected, reconnected on stop).

## Verification

- `bunx turbo run typecheck test lint --filter=@scout-for-lol/data --filter=@scout-for-lol/backend --filter=@scout-for-lol/app`, then `bun run verify -- --affected`.
- Screenshots per scenario for every visual change (PR media rules), uploaded via `toolkit pr asset`.
- New tests: queue-availability (fixed `now`), player serializer season resolution, explorer normalizeValue timestamps.

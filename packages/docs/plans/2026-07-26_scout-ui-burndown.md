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

## Verification

- `bunx turbo run typecheck test lint --filter=@scout-for-lol/data --filter=@scout-for-lol/backend --filter=@scout-for-lol/app`, then `bun run verify -- --affected`.
- Screenshots per scenario for every visual change (PR media rules), uploaded via `toolkit pr asset`.
- New tests: queue-availability (fixed `now`), player serializer season resolution, explorer normalizeValue timestamps.

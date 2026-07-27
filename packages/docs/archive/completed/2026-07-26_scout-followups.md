---
id: scout-followups
type: plan
status: complete
board: false
---

# Scout follow-ups — queue-window automation + deferred refactors

One stacked PR on `feature/scout-followups` (atop `feature/scout-ui-burndown` / PR #1681), worktree `.claude/worktrees/scout-ui-burndown`. The complete approved plan is inlined below (previously mirrored from the harness plan `scout-for-lol-swift-penguin`, which is machine-local and unavailable to reviewers).

## Context

PR #1681 (`feature/scout-ui-burndown`) shipped the UI burn-down, including hand-maintained queue availability windows. This stack automates window maintenance via Temporal (modeled on the existing Data Dragon / patch-notes watcher pipeline), converts the queue pickers' reveal affordance to a checkbox, and works through every previously-deferred refactor: preview-as-query, ARIA combobox, suspense + error boundaries, data-router migration, window-data hardening, audit leftovers, and the player-detail-as-hub IA consolidation.

**User decisions**: auto-PR watcher · checkbox at top of picker, unavailable queues fully absent when unchecked · player-detail-as-hub IA · **ONE stacked PR** containing all of it.

All work happens in the existing worktree `.claude/worktrees/scout-ui-burndown`: one new branch `feature/scout-followups` created with git-spice on top of `feature/scout-ui-burndown` (stack of two). One commit per work item below (11 commits, ordered as listed — later items depend on earlier ones: hardening → JSON split → watcher; data-router → suspense; hub last since it touches files others touch). Verify (`bun run verify -- --affected`) at every commit via the pre-commit gate; submit the PR after item 1, keep it draft until all items + e2e pass, then promote.

Note: the Temporal watcher only activates once this PR merges to main (the worker clones main) — within one PR the data/CLI/temporal pieces land atomically, so no cross-PR ordering hazard remains.

## Item 1 — checkbox reveal (B)

- `app/src/components/subscription-filter-fields.tsx`: replace the "Show N unavailable queues" button row with a labeled checkbox row **pinned at the top** of the PopoverContent: `☐ Show unavailable queues (N)`. Unchecked (default) = unavailable queues fully absent. Selected-but-unavailable queues remain visible regardless (deselect path).
- `app/src/components/competition-criteria-fields.tsx` `QueueSelect`: same checkbox, rendered **outside the Radix Select item list** (fixes the button-nested-in-SelectContent a11y oddity). If Radix Select fights an interactive header, convert QueueSelect to the same Popover-listbox pattern as the subscription picker — prefer the minimal fix first.
- State stays per-component `useState` (no persistence).

## Item 2 — doom-bots names + collapse

- `data/src/model/state.ts` `queueTypeToDisplayString`: adopt canonical names from `backend/src/league/tasks/prematch/loading-screen-builder.ts` — "Easy Doom Bots" / "Normal Doom Bots" / "Hard Doom Bots" (distinct), "ARAM: Mayhem". Sweep display call sites for casing consistency.
- Subscription picker: collapse the three doom-bots QueueTypes into ONE "Doom Bots" row — checked when any of the three is selected; toggling adds/removes all three.
- Update `summarizeFilters`/FilterSummary so three-queue doom-bots selections render as one "Doom Bots" badge.

## Item 3 — window data hardening (7)

- One research pass (PinchTab headless — wiki availability tables are JS-rendered and 402 to plain fetch) to firm pre-2024 windows for `arurf`, `urf`, `arena` in `data/src/model/queue-availability.ts`; annotate confidence in comments.
- No new enum values (Nexus Blitz/Swarm wait until modes return; the watcher will flag their queueIds as "new mode?").

## Item 4 — JSON catalog + drift engine (A1, data pkg)

- NEW `data/src/model/queue-windows.json` — limited queues only; windows `{start:"YYYY-MM-DD", end:string|null, source:"manual"|"observed", note?}`; seeded from item 3's hardened values.
- NEW `data/src/model/queue-windows.schema.ts` — Zod strictObject + superRefine (sorted, non-overlapping, single trailing open window).
- MODIFY `queue-availability.ts` — loader replaces the `limited([...])` literals; public API unchanged. Equivalence test vs old literals. Verify app/frontend Vite builds with the JSON import.
- NEW `data/src/model/queue-window-drift.ts` — pure `proposeQueueWindowEdits({file, counts: rawQueueId→date→n, today, lookbackDays:21})` → `{next, edits, warnings}`. Rules: **OPEN** when limited+unavailable but ≥2 distinct days AND ≥3 matches observed (start=firstSeen, end:null); **REOPEN** (clear the end) when the last window ended within 7 days of firstSeen; **CLOSE** only when open-ended AND 10 consecutive empty days AND ≥20-match baseline earlier in the window — below baseline never auto-close (warning only). Unknown queueIds → `unknown-queue-id` warnings. Aggregate multi-ID modes (1700+1750, mayhem quartet, doom-bots trio). Full unit suite.

## Item 5 — Temporal watcher (A2)

- NEW `backend/scripts/queue-activity-s3.ts` (S3 walker mirroring `lane-prior-s3.ts`) + `backend/scripts/update-queue-windows.ts` (+ package.json script): scan → drift engine → rewrite JSON (`--dry-run`, `--report <path>`).
- NEW `packages/temporal/src/activities/scout-queue-windows.ts`: heartbeats, `createGitHubAppInstallationToken`, clone, `rootInstallWithoutHooks`+`installScoutWorkspace`, run CLI against `--bucket scout-prod`, `changedFilesInPaths` on the JSON, `openSeasonRefreshPr`. **Auto-merge only when edits are open/reopen; any close → plain PR.** Warnings-only runs → Postal email. PR body includes recent patch-note titles via `riot-patch.ts`. No LLM in the loop.
- NEW thin workflow + export; SCHEDULES entry `scout-queue-windows-daily`, cron `45 6 * * *` PT, overlap SKIP; add to temporal CLAUDE.md pause table.
- Extend `check:rehearsal` canaries (JSON path + script name). Document local dry-run in scout AGENTS.md same-phase.
- First-run expectation: no-diff (catalog fresh as of 2026-07-26).

## Item 6 — preview-as-query (1)

- `backend/src/trpc/router/report.router.ts`: `previewQuery` `.mutation` → `.query` on `guildProcedure("reports","read")` (verified side-effect free). Contract-hash lockstep deploy handles skew.
- `app/src/components/report-query-preview.tsx`: rewrite as `useQuery(trpc.report.previewQuery.queryOptions(..., {enabled, placeholderData: keepPreviousData}))`; delete the manual useEffects + state.
- `report-ai-editor.tsx`: `statusQuery.refetch()` → targeted invalidation.

## Item 7 — staleTime + leftovers (8)

- 5-min `staleTime` on the slow admin lists (report.list, player.listPlayers + alias combobox, getCurrentLinkedPlayer, competition.list, listAuditLog, guild.listChannels, roles.list, guild.listManageable).
- `<caption className="sr-only">` on the data tables where purpose isn't adjacent.
- guild-picker.tsx heading h2→h1.
- version-info.tsx contract-hash tooltip → keyboard-reachable.

## Item 8 — ARIA combobox (2)

- `app/src/components/ui/combobox.tsx`: `ul role="listbox"`, items `role="option"` with stable per-item ids + `aria-selected`; input `aria-activedescendant` tracking an activeIndex; arrow keys move, Enter selects, Escape closes; `scrollIntoView({block:"nearest"})` on active change; reset activeIndex on items change. No consumer API changes.

## Item 9 — data-router migration (4)

- NEW `src/lib/query-client.ts` (QueryClient + 4xx-skip retry), `src/lib/trpc-options.ts` (`createTRPCOptionsProxy`), `src/routes/root-layout.tsx` (ContractMismatchBanner + Outlet + VersionFooter), `src/router.tsx` (route-object tree, basename "/app", catch-all redirect).
- main.tsx: `RouterProvider`; providers unchanged above it. DELETE app.tsx.
- **Loaders are non-blocking `void queryClient.prefetchQuery(...)` only — never `ensureQueryData`** (loaders run in parallel with no session guarantee). Per-route prefetch table; option parity (e.g. `retry:false` on meWeb).
- Unit tests: query-key parity + `matchRoutes` coverage of every current URL.

## Item 10 — suspense + error boundaries (3)

- Error mechanism = RR-native `errorElement`. NEW `src/components/route-error-panel.tsx`: `useRouteError()` + `Sentry.captureException` in effect + "Try again" (reset errored queries + replace-navigate). Place on the RequireSession layout + each guild child route.
- Suspense fallbacks in layouts: wrap `<Outlet/>` with `<Suspense fallback={<SectionSkeleton/>}>`.
- Convert to `useSuspenseQuery`: guild-picker listManageable, player-detail getPlayer (with `src/lib/route-params.ts` Zod param schemas — parse failure throws to errorElement), competition-detail get, report-detail get, report-list list, guild-access roles.list.
- **Stay non-suspense**: usePermissions, RequireSession meWeb, ALL infinite lists, keepPreviousData components, enabled-gated edit-mode queries.

## Item 11 — player-detail hub (5)

- `backend/src/lib/player-admin/queries.ts`: subscription mapping adds parsed `filters` + `isMuted`. Tests: fixture extension + offline-harness roundtrips.
- Extractions: FilterSummary → `subscription-filter-summary.tsx`; result-kind→message switches → `subscription-result-messages.ts` (unit-tested); onboarding concepts grid → `concept-cards.tsx`.
- `player-detail-sections.tsx` PlayerSubscriptionsTable: Filters column + Edit-filters button + kebab (Move/Mute/Add channel/Remove), perm-gated actions column.
- `player-detail.tsx`: host the dialogs, remove/setMuted mutations (optimistic mute against the single-object player cache); invalidate playerKey + subscription.list + player.listPlayers pathKeys.
- `guild-subscriptions.tsx`: adopt extracted pieces; add player.getPlayer/listPlayers invalidations.
- `player-list.tsx`: Collapsible "What are players, accounts, and subscriptions?" → ConceptCards.
- `subscription-fields.tsx`: Discord hint copy — existing players keep their current link.

## Verification

- Per PR: `bunx turbo run typecheck test lint --filter=@scout-for-lol/data --filter=@scout-for-lol/backend --filter=@scout-for-lol/app` (+ `--filter=temporal` for item 5), then `bun run verify -- --affected`; every commit passes the pre-commit gate.
- New unit suites: drift engine, queue-windows schema + loader equivalence, CLI aggregation fixtures, router key-parity + matchRoutes, subscription-result-messages, serializer roundtrips.
- Watcher dry-run: `AWS_PROFILE=seaweedfs bun run update-queue-windows -- --bucket scout-prod --lookback-days 21 --dry-run` — expect no-diff + possible unknown-queueId warnings.
- E2E via `dev:web` + PinchTab per wave; screenshots per visual surface via `toolkit pr asset`.
- Docs: session plan updated per wave; new watcher documented in scout AGENTS.md + temporal CLAUDE.md in the same PRs.

## Risks / notes

- Single large PR (~11 commits): big review surface, offset by per-commit organization and the unit suites + e2e checklist.
- Watcher lake = tracked players only: absence ≠ mode off; sparse modes never auto-close by design. Thresholds (2d/3m open, 10d+20m close) are tunable after a few weeks.
- previewQuery mutation→query changes the tRPC contract hash — lockstep beta deploy handles it.
- New modes with unknown queueIds still need a human to add the QueueType enum + ID mapping (watcher flags them).

## Session Log — 2026-07-26 (evening)

### Done

- All 11 items implemented and committed on `feature/scout-followups` (PR #1689, draft), restacked over the base's three Codex-fix commits (incl. the parallel session's bulk-enroll + riot-id-poll work). `bun run verify -- --affected` green on the tip (48/48).
- Codex findings on #1681 fixed on the base branch (SERVER_WIDE now auto-enrolls on web create per operator decision, with offline-harness tests; tz-neutral preset labels; custom-cron hydration; end-of-day-inclusive windows; current-season preset).
- Watcher shakedown against the real scout-prod lake: first run caught custom lobbies masquerading as Doom Bots (queue id 3130, gameType CUSTOM_GAME) — operator-confirmed false positive, fixed by skipping CUSTOM\* game types (regression-tested). Post-fix dry-run: 0 edits, 3 legitimate warnings (unknown ids 1740/890, sparse mayhem no-close).
- Two impl agents died at the session limit mid-work; their remains were audited, completed (temporal workflow/schedule/rehearsal/docs, a malformed-JSX fix, end-of-day loader semantics), and committed.

### Remaining

- dev:web + PinchTab screenshot pass for the new UI surfaces (checkbox picker, Doom Bots row, player-hub actions, concepts explainer, skeleton/error panel) — blocked twice on 1Password authorization timeouts; run when the operator can approve, then attach via `toolkit pr asset 1689` and promote the PR from draft.
- Operator decisions: map queue id 1740 (likely new Arena variant); decide whether 3130/4220/4250 are real Doom Bots ids or custom-lobby artifacts worth remapping in parseQueueType.
- Watch CI + Codex review on both PRs; merge bottom-up (#1681 then #1689), then `git-spice repo sync` and remove the two worktrees (`scout-ui-burndown`, `scout-codex-fixes`).

### Caveats

- The suspense commit's file state includes the hub manager import one commit early (path-scoped staging captured final file states); the stack tip is consistent and every commit passed the verify gate.
- `scout-codex-fixes` worktree contains ANOTHER session's uncommitted staged work (bulk-enroll refactor follow-ups) — do not remove that worktree without checking its status.
- The watcher's oracle is tracked-player matches only; 890/1740 warnings will repeat daily (email) until the enum decisions are made.

## Session Log — 2026-07-26 (close-out)

### Done

- Queue-id research settled via CommunityDragon client catalog + lake inspection: 1740 = Bravery Arena, 1750 = Arena 3x6, 3130 = SR Tournament Draft (custom), full Doom Bots family remapped by trial tier (Evil→easy, Curse→normal, Hard/Doom→hard; 4200-4210 left to the watcher). Committed + pushed.
- PR #1689 promoted to ready for review with the final body (screenshot pass waived by the operator).
- Branch restacked twice more over the parallel session's Codex cycle-3/cycle-5 base commits (conflicts resolved keeping both sides' improvements: optimistic-mute app-level rollback, CompetitionStatusSchema validation).

### Remaining

- CI + code review on #1681 and #1689; merge bottom-up, then `git-spice repo sync`, remove the `scout-ui-burndown` worktree, and check `scout-codex-fixes` (holds the parallel session's work) before removing it.
- The watcher goes live on the first main deploy after merge; expect daily no-diff runs with the 890/sparse-mayhem warnings until those are tuned or muted.

### Caveats

- Doom-bots trial-tier difficulty labels are ~80% confidence (Trial ordering inference); one real match settles it, and the UI collapses the trio regardless.

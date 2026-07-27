---
id: scout-followups
type: plan
status: complete
board: false
---

# Scout follow-ups — queue-window automation + deferred refactors

One stacked PR on `feature/scout-followups` (atop `feature/scout-ui-burndown` / PR #1681), worktree `.claude/worktrees/scout-ui-burndown`. Mirrors the approved harness plan (`~/.claude/plans/scout-for-lol-swift-penguin.md`) — see it for full per-item specs.

## Items (one commit each, in order of dependency)

| #   | Item                                           | Notes                                                                                                                                                             |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Queue pickers: checkbox reveal                 | Checkbox pinned at top of dropdown; unavailable queues absent when unchecked                                                                                      |
| 2   | Doom-bots names + picker collapse              | "Easy/Normal/Hard Doom Bots", "ARAM: Mayhem" (from loading-screen-builder comments); one picker row toggling all three                                            |
| 3   | Window data hardening                          | PinchTab research pass on wiki availability tables (pre-2024 arurf/urf/arena)                                                                                     |
| 4   | queue-windows.json + Zod schema + drift engine | Loader keeps queue-availability API unchanged; pure proposeQueueWindowEdits (open ≥2d/≥3m; reopen ≤7d gap; close 10 empty days + ≥20 baseline, else warn)         |
| 5   | Temporal watcher                               | backend queue-activity-s3 + update-queue-windows CLIs; activity mirroring scout-showcase-refresh; auto-merge open/reopen only; daily 06:45 PT; rehearsal canaries |
| 6   | previewQuery mutation→query                    | + report-query-preview useQuery rewrite; ai-editor refetch→invalidate                                                                                             |
| 7   | staleTime + leftovers                          | 5-min staleTime on slow lists; sr-only captions; guild-picker h1; focusable contract-hash tooltip                                                                 |
| 8   | ARIA combobox                                  | listbox/option roles, aria-activedescendant, arrow keys — no consumer API change                                                                                  |
| 9   | Data-router migration                          | createBrowserRouter + root layout + non-blocking prefetch loaders; matchRoutes + key-parity tests                                                                 |
| 10  | Suspense + errorElement                        | RouteErrorPanel (+Sentry capture), layout Suspense, 6 routes to useSuspenseQuery; infinite lists stay non-suspense                                                |
| 11  | Player-detail hub                              | Serializer adds filters/isMuted; dialogs reused on player page; FilterSummary/result-messages/concept-cards extractions; Discord hint copy                        |

## Verification

Per-commit pre-commit gate (verify --affected); new unit suites (drift engine, schema+loader equivalence, CLI fixtures, router tests, result-messages, serializer roundtrips); watcher dry-run vs scout-prod expecting no-diff; dev:web + PinchTab e2e walk incl. error-panel and hub actions; screenshots via toolkit pr asset. Draft PR after item 1; promote when everything passes.

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

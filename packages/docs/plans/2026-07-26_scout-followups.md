---
id: scout-followups
type: plan
status: in-progress
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

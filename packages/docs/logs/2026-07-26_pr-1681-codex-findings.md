---
id: pr-1681-codex-findings
type: log
status: complete
board: false
---

# PR #1681 — Codex P1/P2 review-gate burn-down

Branch `feature/scout-ui-burndown`. The `robot-face-review-gate` (Codex) was the
only hard-failing required check, blocking on 13 unresolved P1/P2 review threads.
Worktree: `.claude/worktrees/scout-codex-fixes`.

## Findings and disposition

| #   | Sev | Location                                                | Disposition                                                                     |
| --- | --- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | P1  | report-form-fields.tsx:48 (tz labels)                   | Resolved — already fixed in 555dee81d (cron preset labels are timezone-neutral) |
| 2   | P2  | report-schedule-fields.tsx:57 (custom cron hydration)   | Resolved — already fixed (`isCustom` is derived at line 70)                     |
| 3   | P2  | queue-availability.ts:40 (finite end date)              | Resolved — already fixed (ends parse to `T23:59:59.999Z`)                       |
| 4   | P1  | competition.ts:346 (auto-enroll promise)                | Fixed — create + edit now both enroll, so the description holds                 |
| 5   | P2  | competition-form.tsx:152 (season preset)                | Resolved — already fixed (preset uses `getCurrentSeason()`)                     |
| 6   | P1  | competition.router.ts:240 (enroll bypasses invite perm) | Fixed — SERVER_WIDE create/edit require `competitions:invite`                   |
| 7   | P1  | competition.router.ts:244 (non-atomic orphan)           | Fixed — tolerant enroll helper never throws, so no orphan-retry                 |
| 8   | P2  | competition.ts:346 (edit→SERVER_WIDE no enroll)         | Fixed — edit enrolls on transition to SERVER_WIDE                               |
| 9   | P1  | timezone-select.tsx:103 (typed tz not committed)        | Fixed — exact typed/pasted zone commits                                         |
| 10  | P2  | champion-combobox.tsx:29 (stale text vs value)          | Fixed — sync effect with self-echo ref guard                                    |
| 12  | P1  | player-detail.tsx:188 (unbounded 5s poll)               | Fixed — poll bounded to ~5 minutes                                              |
| 13  | P2  | competition-dates-fields.tsx:34 (season range tz)       | Fixed — format in the catalog's Pacific timezone                                |

Finding #11 (P2, queue-availability language-neutral catalog) was not in the
active thread set for this cycle — see Caveats.

## Design decision — SERVER_WIDE cluster (#4/#6/#7/#8)

The web app's participants panel (`competition-participants-panel.tsx`) disables
the invite field for SERVER_WIDE and states "Server-wide competitions include
everyone automatically", and the shared `visibilityDescription` promises opt-out
auto-enrollment. So the author's intent is that SERVER_WIDE auto-includes the
whole server. Rather than remove the auto-enroll (which would contradict that
UX), the enrollment was **hardened**:

- New `bulkEnrollTrackedPlayers` helper (`database/competition/participants.ts`)
  — tolerant (per-player failures are logged + counted, never thrown), cap
  enforced via oldest-first `take: maxParticipants`. Because it never throws, a
  create-then-enroll caller cannot leave an orphaned competition behind (#7).
- `create` and `edit` require `competitions:invite` for SERVER_WIDE (#6); `edit`
  enrolls the whole server when a draft flips to SERVER_WIDE (#8); the
  description is now accurate on both paths (#4).
- `addAllMembers` refactored onto the same helper (now also cap-aware).

## Session Log — 2026-07-26

### Done

- Fixed 8 findings across 6 files (backend router + participants helper; app
  timezone-select, champion-combobox, player-detail, competition-dates-fields).
- Resolved 4 already-fixed findings (#1, #2, #3, #5) on GitHub with
  justification replies pointing at the current code.
- Committed to `feature/scout-ui-burndown`.

### Remaining

- Push; controller re-runs the review gate.

### Caveats

- Finding #11 (move queue-availability catalog to language-neutral JSON) was not
  among the active threads pulled this cycle. If it resurfaces, it is a larger
  cross-package refactor (JSON + JSON Schema + per-language validation) and
  should be scoped separately.
- The shared `visibilityDescription("SERVER_WIDE")` still reads as "automatic"
  in Discord, where SERVER_WIDE alone does not auto-enroll (enrollment is the
  explicit `add-all-members` flag). That pre-existing Discord discrepancy was
  left as-is; the findings targeted the web surface.

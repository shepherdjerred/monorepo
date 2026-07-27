---
id: plan-2026-07-27-docs-board-task-audit
type: plan
status: complete
board: false
---

# Docs Board Task Audit and UAT Cleanup

## Goal

Reconcile every non-complete board item against current code, Git history, CI,
and available production evidence. Reserve human review for user acceptance
testing, not mechanical engineering verification.

## Remaining

- [x] Reframe awaiting-human checks as observable UAT scenarios and split
      privileged prerequisites into separate blocked operator tasks.
- [x] Execute every safe agent-operable verification and record concrete
      evidence before asking for human acceptance.
- [x] Archive implemented and obsolete plans and TODOs, consolidate duplicates,
      and reclassify blocked, deferred, failed, and genuinely active work.
- [x] Rename the board state to Awaiting User Acceptance and update workflow
      guidance, migration behavior, and tests.
- [x] Verify the cleaned documentation corpus and docs-board package.

## Audit Baseline

The board has 134 non-complete items: 33 planned, 77 in progress, and 24
awaiting human. The read-only audit found that most awaiting-human items are
stale or agent-operable, and that many planned or in-progress records describe
work already merged or superseded.

## Verification Strategy

1. Express acceptance as an observable action and expected result, without
   typecheck, lint, test, CI, merge, or deployment commands assigned to the
   human reviewer.
2. Use local source and Git history first, then read-only GitHub, Buildkite,
   Grafana, Tempo, Loki, Temporal, Kubernetes, Bugsink, and ArgoCD evidence as
   needed.
3. Mark proven work complete and archive it; retain only genuinely subjective
   UAT. Return failed acceptance to in progress and mark external blockers as
   blocked or deferred.
4. Keep physical or privileged mutations separate from UAT and require explicit
   operator authorization.

## Session Log — 2026-07-27

### Done

- Audited all 134 original non-complete board items against current source,
  history, and available read-only production evidence.
- Reconciled the active board to 100 explicit records: 75 planned, 23 in
  progress, and 2 awaiting user acceptance.
- Reserved `awaiting-human` for the two genuine UAT records and split physical,
  privileged, or destructive prerequisites into operator-owned TODOs.
- Archived completed and superseded work, repaired moved-document links and
  provenance, and restored overlooked residual work as narrow successor cards.
- Added `verification: operator`, renamed the UI state to Awaiting User
  Acceptance, and made archival clear board-only metadata.
- Made migration idempotent for archived document types and added validation for
  archived board cards, all document origins, and local Markdown links.
- Addressed automated review by enforcing operator-blocked pairing, repairing
  active types from canonical directories, preserving archived provenance, and
  keeping source cards unchanged when archive setup or movement fails.
- Made archive transactions rewrite inbound provenance and Markdown links with
  rollback, and made migration clear board metadata plus rewrite moved
  references in one pass.
- Verified the docs-board package and the full affected repository surface; all
  gates pass. Captured board, user-acceptance, and operator-action screenshots
  for PR #1732; the prerequisite docs-board UI commit landed through PR #1713.

### Remaining

- None for this audit. Remaining implementation, operator, and UAT work is
  represented by the resulting board records.

### Caveats

- No production mutation, destructive cleanup, secret change, or physical action
  was performed.
- Torvalds still showed approximately 75 container restarts over the observed
  48-hour window, so that investigation remains active.
- Temporal-worker trace-to-log correlation and Mario Kart live trace parenting
  remain unproven and stay agent-owned rather than becoming UAT.

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

# PR Review Bot — Cluster-Key Utility (Phase 3 Prep)

## Status

Complete

## Context

This is a small preparatory PR for Phase 3 of the SOTA PR review bot plan
(`packages/docs/plans/2026-05-10_sota-pr-review-bot.md`, Tasks #3 and #4 in
the team's task tracker). It lands a single pure utility — `clusterKey` /
`clusterFindings` — early so the eval grader (Phase 10, owned by a parallel
agent) can import the same bucketing function the consensus activity will
use. Without a shared utility, the grader and the bot would drift on
edge cases, breaking FP/FN counts.

## Scope

Files added:

- `packages/temporal/src/shared/pr-review/cluster-key.ts` — pure utility,
  no dependencies beyond standard JS.
- `packages/temporal/src/shared/pr-review/cluster-key.test.ts` — 9 tests
  covering bucket math, path scoping, boundary cases, and generic type
  preservation.

Out of scope (lands in Task 3 PR):

- The five specialist activities.
- `consensus.ts` real implementation (currently a passthrough stub from
  Phase 1).
- Diff-slicing helper (`packages/temporal/src/lib/diff-slicing.ts`).

## Design Decisions

### Bucketing scheme

`clusterKey(path, lineStart) = ${path}|${floor(lineStart / 7) * 7}`.
Seven-line buckets anchored on multiples of 7. Worst-case tolerance ±6
lines (boundaries of adjacent buckets); best-case ±3 lines (centered on a
bucket). The boundary caveat is documented in the file header — lines 6
and 7 land in different buckets despite being 1 line apart. If real
fixtures show this drives false negatives, swap the implementation to
dual-key lookup without changing the public API.

### Why `kind` is NOT in the key

Cross-specialist agreement is the load-bearing noise reducer per the SOTA
audit (Refute-or-Promote, Cursor BugBot v11). If `kind` were part of the
key, the security specialist (`kind: 'security'`) and the correctness
specialist (`kind: 'correctness'`) flagging the same line would land in
different clusters and the cross-specialist rule would never fire.
Instead, the cluster representative carries the most-severe kind, and the
post-review comment will surface the set of kinds observed
("security + correctness both flagged this line").

Confirmed with team-lead via teammate messaging before landing.

## Verification

```fish
cd packages/temporal
bun test src/shared/pr-review/cluster-key.test.ts   # 9/9 pass
bun run typecheck                                    # clean
bunx eslint src/shared/pr-review/                    # clean
```

## Session Log — 2026-05-10

### Done

- `packages/temporal/src/shared/pr-review/cluster-key.ts` — utility + header
  doctest + boundary-case documentation
- `packages/temporal/src/shared/pr-review/cluster-key.test.ts` — 9 tests
- Standalone PR opened against `main` (Task 3 parent)

### Remaining

- Task 3 follow-up PR: specialists, consensus impl, diff slicing.
- Task 4 follow-up PR: empirical verification activity.

### Caveats

- Bucketing has documented ±6 worst-case tolerance; revisit only if eval
  fixtures show boundary FN driving regression.
- `clusterKey` deliberately ignores `kind` — eval grader must use the
  same shape (kind-agnostic cluster representative carrying `kinds` set).

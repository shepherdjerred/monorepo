# PR Review Bot — Phase 3 (Specialists × Consensus Voting)

## Status

Complete

## Context

Phase 3 of the SOTA PR review bot plan
(`packages/docs/plans/2026-05-10_sota-pr-review-bot.md`). Replaces the
Phase 2 single-specialist baseline (`correctnessReviewer`) with a
parallel fan-out across 5 specialists × 3 randomized passes each (15 LLM
calls per PR), plus a real consensus-voting activity that drops noise via
within- and cross-specialist agreement rules.

Stacks on top of:

- PR #737 (cluster-key utility) — already merged
- Phase 1 directory shape + `Finding` Zod schema
- Phase 2 single-agent baseline (`correctnessReviewer`, leaves parity tests intact)
- Phase 8 metrics + Grafana dashboard

## Scope

Adds (relative to main):

| File                                                          | Purpose                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/diff-slicing.ts`                                     | Seeded permutation of file order per (specialist, pass)             |
| `src/lib/diff-slicing.test.ts`                                | 10 tests covering determinism + edge cases                          |
| `src/activities/pr-review/specialists/runner.ts`              | Shared SDK-call helper (cache control, schema enforcement, metrics) |
| `src/activities/pr-review/specialists/runner.test.ts`         | 9 tests covering schema kind-pin + diff permutation                 |
| `src/activities/pr-review/specialists/correctness-adapter.ts` | Wraps Phase 2 correctnessReviewer onto runner.ts for multi-pass     |
| `src/activities/pr-review/specialists/security.ts`            | Opus 4.7 + effort:high, OWASP-aware                                 |
| `src/activities/pr-review/specialists/perf.ts`                | Opus 4.7 + effort:high, performance-aware                           |
| `src/activities/pr-review/specialists/convention.ts`          | Sonnet 4.6 + effort:medium, CLAUDE.md-aware                         |
| `src/activities/pr-review/specialists/deps.ts`                | Sonnet 4.6 + effort:medium, Renovate/lockfile-aware                 |
| `src/activities/pr-review/consensus.test.ts`                  | 22 tests covering voting, clustering, ordering, vote metadata       |

Modifies:

| File                                                   | Change                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/activities/pr-review/specialists.ts`              | Replace single-call with parallel fan-out 5 specialists × 3 passes via `Promise.all`; emit cost + latency metrics; return `AnnotatedFinding[]` |
| `src/activities/pr-review/consensus.ts`                | Replace passthrough stub with real `voteOnFindings` + Temporal activity wrapper                                                                |
| `src/workflows/pr-review/index.ts`                     | Update consensus call site to pass `{ annotated }` instead of `Finding[]`                                                                      |
| `src/shared/pr-review/cluster-key.ts` + test           | Rename `path` parameter to `file` to match `Finding.file` rename                                                                               |
| `src/observability/pr-review-metrics.ts`               | Extend `pr_review_cost_usd` with `specialist` label (was `model` only)                                                                         |
| `src/observability/metrics.ts`                         | Add `pr_review_specialist_latency_seconds{model, specialist}` Histogram + `pr_review_consensus_findings_total{outcome}` Counter                |
| `src/observability/pr-review-metrics.test.ts`          | Update assertion to match new help text                                                                                                        |
| `packages/docs/plans/2026-05-10_sota-pr-review-bot.md` | Document the `budget_tokens` → adaptive+effort swap; document kind-agnostic cluster key                                                        |

## Design Decisions

### Opus 4.7 model swap from the plan

The plan literally says "Opus 4.7 specialists (24K thinking budget)" —
4.6-era spec. `thinking: { type: "enabled", budget_tokens: N }` returns
400 on `claude-opus-4-7`. The canonical depth knob is
`thinking: { type: "adaptive" }` + `output_config.effort`.

Effort tier per specialist:

| Specialist  | Model      | Effort   | Notes                                                              |
| ----------- | ---------- | -------- | ------------------------------------------------------------------ |
| correctness | Opus 4.7   | `high`   | xhigh once SDK type lands; currently capped at high                |
| security    | Opus 4.7   | `high`   | OWASP-aware system prompt                                          |
| perf        | Opus 4.7   | `high`   | Performance heuristics + concurrent + algorithmic complexity       |
| convention  | Sonnet 4.6 | `medium` | CLAUDE.md hierarchy enforcement is pattern-matching, not reasoning |
| deps        | Sonnet 4.6 | `medium` | Renovate / lockfile / version-management policy                    |

Approved by team-lead before landing. Documented in `consensus.ts` header
and in the updated SOTA plan.

### Kind-agnostic cluster key

`clusterKey(file, lineStart) = ${file}|${floor(line/7)*7}` deliberately
drops `kind`. If kind were in the key, the cross-specialist rule (≥2
distinct specialists agree) could never fire because security and
correctness specialists emit different `kind` values for the same line.
Cluster representative carries the most-severe kind; `kindsObserved` set
on the representative is surfaced in the post-review comment.

Confirmed with team-lead via teammate messaging before landing — see PR
description.

### Voting rule

Cluster is kept iff EITHER:

- ≥2 of 3 randomized passes within a single specialist produced it
  (within-specialist agreement), OR
- ≥2 distinct specialists produced it (cross-specialist agreement).

Threshold for within-specialist: `ceil(2N/3)` where `N = PASSES_PER_SPECIALIST`.
Currently 2/3.

### Failure tolerance in the fan-out

`runSpecialists` runs all 15 (specialist × pass) calls via `Promise.all`
with per-pass try/catch. A failed pass is logged + Sentry-captured but
does NOT fail the activity — consensus voting degrades gracefully with
1-2 missing passes. If EVERY pass fails, the activity returns an empty
annotated array and downstream postReview logs "no findings".

### `Finding.path → Finding.file` field rename

Foundation renamed the field after my cluster-key utility's first draft.
Renamed my parameter/generic constraint to match so callers can pass
`Finding[]` directly without a translation map. Doctest + tests updated.

## Verification

```fish
cd packages/temporal

# Task 3 unit tests
bun test src/lib/diff-slicing.test.ts          # 10/10 pass
bun test src/activities/pr-review/consensus.test.ts                      # 22/22 pass
bun test src/activities/pr-review/specialists/runner.test.ts             # 9/9 pass
bun test src/shared/pr-review/cluster-key.test.ts                        # 9/9 pass

# Full package
bun run typecheck                                                        # clean
bunx eslint .                                                            # clean
bun test                                                                 # 170/173 pass (3 pre-existing Temporal-integration fails)
```

The 3 pre-existing failures are `temporal integration > connects to
local dev server` and friends — they require a Temporal server running
at `127.0.0.1:7233`. Verified pre-existing: same failures on `origin/main`
HEAD with my changes shelved.

## Out of scope (Task 4 / future)

- Empirical verification activity (Task 4) — extends Finding schema with
  verifier-specific target fields (typecheck package, eslint rule, grep
  pattern, test name), runs the declared verifier in a sandbox, drops
  contradicted findings.
- Per-finding embedding for dedupe (Phase 9).
- Hallucinated-claim fixture corpus (Phase 10).

## Session Log — 2026-05-10

### Done

- `packages/temporal/src/lib/diff-slicing.ts` + test (10/10 pass)
- `packages/temporal/src/activities/pr-review/specialists/runner.ts` + test (9/9 pass)
- `packages/temporal/src/activities/pr-review/specialists/correctness-adapter.ts`
- `packages/temporal/src/activities/pr-review/specialists/{security,perf,convention,deps}.ts` (4 specialists)
- `packages/temporal/src/activities/pr-review/specialists.ts` — 5×3 parallel fan-out
- `packages/temporal/src/activities/pr-review/consensus.ts` — real `voteOnFindings` + 22-test suite
- `packages/temporal/src/workflows/pr-review/index.ts` — workflow call-site update
- `packages/temporal/src/shared/pr-review/cluster-key.ts` + test — `path`→`file` rename
- `packages/temporal/src/observability/{metrics,pr-review-metrics}.ts` — `pr_review_cost_usd` extended with `specialist` label, new `pr_review_specialist_latency_seconds` Histogram + `pr_review_consensus_findings_total` Counter
- `packages/docs/plans/2026-05-10_sota-pr-review-bot.md` — updated to reflect Opus 4.7 effort tiers and kind-agnostic cluster key
- Task 3 PR opened against `main`, stacked on the already-merged cluster-key commit

### Remaining

- Task 4 (verification layer) — stacks on this branch, opens as a separate PR per team-lead's stacking directive
- Continuous-eval (Phase 10) and shadow-mode (Phase 12) will exercise the consensus rule against real fixtures

### Caveats

- Effort tier is `"high"` for Opus specialists; bump to `"xhigh"` once
  `@anthropic-ai/sdk` exports the type. Coding/agentic workloads on
  Opus 4.7 perform best at xhigh per Anthropic's guidance.
- Cluster-key boundary caveat (lines 6 and 7 cross a bucket boundary)
  remains documented and accepted. If the eval grader's FN rate shows
  boundary collisions, swap to dual-key lookup without changing the
  public API.
- Cost cap enforcement ($10/PR) is operational, not API-side. The plan's
  optional `task_budget` beta header (Option C from the design
  conversation) was skipped per team-lead — relying on `MAX_TOKENS` +
  the $10/PR abort logic.

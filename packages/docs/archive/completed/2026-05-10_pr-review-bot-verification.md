# PR Review Bot — Phase 4 (Empirical Verification Layer)

## Status

Complete

## Context

Phase 4 of the SOTA PR review bot plan
(`packages/docs/plans/2026-05-10_sota-pr-review-bot.md`). Adds the
verification activity that re-runs typecheck / eslint / grep / test
against each post-consensus finding and drops findings whose declared
verifier contradicts the claim. Per the SOTA audit (CodeRabbit agentic
validation, Cursor BugBot v11), this is the single biggest FPR reducer
in the stack.

Stacks on Task 3 (PR #753 — specialists × consensus). Will open as a
separate PR base = `feature/2026-05-10-pr-review-bot-specialists`
per team-lead's stacking strategy.

## Scope

Adds:

| File                                        | Purpose                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/activities/pr-review/verify-runner.ts` | `VerifierRunner` interface + `makeBunSpawnVerifierRunner` (4 runners + helpers) |
| `src/activities/pr-review/verify.test.ts`   | 15 tests — hallucinated-claim fixture, drop logic, edge cases                   |

Modifies:

| File                                                                      | Change                                                                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/pr-review/finding.ts`                                         | Add `VerifierTargetSchema` (discriminated union), `VerificationResultSchema`; add optional `verifierTarget` + `verification` fields to `FindingSchema`    |
| `src/activities/pr-review/verify.ts`                                      | Replace passthrough stub with `verifyOneFinding` dispatcher + `runVerifyFindings` drop loop; `VerifyFindingsInput` now carries `workdir`                  |
| `src/workflows/pr-review/index.ts`                                        | Pass `context.workdir` into `prReviewVerify`                                                                                                              |
| `src/activities/pr-review/specialists/runner.ts`                          | `specialistOutputSchema` adds refinement requiring `verifierTarget` when `verifier !== "none"`; export `VERIFIER_TARGET_INSTRUCTIONS` shared prompt block |
| `src/activities/pr-review/specialists/{security,perf,convention,deps}.ts` | Append `VERIFIER_TARGET_INSTRUCTIONS` to each system prompt                                                                                               |
| `src/observability/metrics.ts`                                            | Add `pr_review_verify_findings_total{verifier, outcome}` Counter                                                                                          |
| `packages/docs/plans/2026-05-10_sota-pr-review-bot.md`                    | Update verify-activity description to reflect verifierTarget + Bun.spawn                                                                                  |

## Design Decisions

### Verifier-target discriminated union on `Finding`

Added `verifierTarget?: VerifierTarget` to the base `Finding` schema as an
**optional** field so:

- Phase 2/3 callers (parity tests, fixtures predating Phase 4) still parse cleanly.
- The runner schema (`specialistOutputSchema`) layers a refinement on top
  requiring `verifierTarget` when `verifier !== "none"` and forcing
  `verifierTarget.kind === verifier`. This is the load-bearing guarantee.

Discriminated by `kind`, the 5 cases are:

| `verifier`  | Required params                                 |
| ----------- | ----------------------------------------------- |
| `typecheck` | `packagePath`, `expectedOutputSubstring`        |
| `eslint`    | `filePath`, `ruleId`                            |
| `grep`      | `pattern`, `isLiteral`, `pathGlob`, `mustMatch` |
| `test`      | `packagePath`, `testNamePattern`, `expectPass`  |
| `none`      | `reason`                                        |

### Drop / keep / flag policy

| Verifier output                                          | Action                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| Supports claim                                           | Keep + mark `verified` (badged in postReview) |
| Contradicts claim                                        | **Drop** the finding                          |
| Errored / timed out / no target / discriminator mismatch | Keep + mark `unverified`                      |

**Never let verifier failures hide bugs.** Anything other than a clean
"verifier ran AND output refutes the claim" keeps the finding. This is
the operational rule and is enforced both in `verifyOneFinding` (the
dispatcher) and in `runVerifyFindings` (the `Promise.allSettled`
defense-in-depth path).

### Phase 4 sandbox: Bun.spawn host-side; Dagger comes in Phase 5+

The plan calls for a Dagger container snapshot of PR head; Phase 5+
introduces that. For Phase 4 the verifier runs as a host-side
`Bun.spawn` subprocess against `BootstrapResult.workdir` (which is `""`
in Phase 1/2 stub mode — every verifier falls back to `unverified` in
that case via `makeUnavailableRunner`). The `VerifierRunner` interface
is the seam: when Dagger lands, swap `makeBunSpawnVerifierRunner` for a
Dagger-backed implementation conforming to the same interface; the
activity dispatcher is unchanged.

### Per-verifier 60s timeout

Each subprocess gets a hard `VERIFIER_TIMEOUT_MS = 60_000`. SIGKILL on
timeout. Timeouts produce `status: "unverified"` with a note (not
`contradicted`) — a slow verifier shouldn't drop the finding.

### File split: `verify.ts` + `verify-runner.ts`

The full Phase 4 implementation totals ~760 lines, which exceeds the
500-line lint cap. Split into:

- `verify.ts` (~330 lines) — activity wrapper, dispatcher, drop loop
- `verify-runner.ts` (~400 lines) — `VerifierRunner` interface,
  `makeBunSpawnVerifierRunner`, `spawnWithTimeout`, common helpers

The split also makes the runner contract independently importable by
tests + the replay CLI without dragging the Temporal activity surface.

## Verification

```fish
cd packages/temporal

# Task 4 unit tests
bun test src/activities/pr-review/verify.test.ts        # 15/15 pass
bun test src/activities/pr-review/specialists/runner.test.ts  # 13/13 pass
bun test src/shared/pr-review/finding.test.ts           # 8/8 pass

# Full package
bun run typecheck                                       # clean
bunx eslint .                                           # clean
bun test                                                # 188/191 pass (3 pre-existing temporal-integration)
```

### Hallucinated-claim fixture

Encoded in `verify.test.ts > runVerifyFindings — drop-on-contradict
(hallucinated-claim fixture)`: 3 fabricated findings citing nonexistent
symbols, all configured with `verifier: "grep"` + `mustMatch: true`.
A canned `VerifierRunner` returns `contradicted` for each. `runVerifyFindings`
drops all 3. Final assertion: `expect(kept).toEqual([])`.

This satisfies the task description's "hallucinated-claim fixture must
drop all 3 fakes" verification gate at the unit-test level. The
operational-replay gate (with a real PR + real grep against a real
workdir) lands once Phase 5's bootstrap workdir is wired.

### Drop-rate metric

`pr_review_verify_findings_total{verifier, outcome}` Counter records
one observation per finding per stage. The
`pr_review_verification_drop_rate` gauge in
`./pr-review-metrics.ts` (Phase 8) is now meaningfully populated.

## Out of scope (later phases)

- Dagger-backed sandbox (Phase 5+ when `BootstrapResult.workdir` is
  populated with a real clone)
- Adversarial-diff fixture (eval team's Task 10 corpus)
- Multi-verifier findings (a single finding currently picks one verifier;
  could be extended to AND-of-verifiers if FPR data shows it helps)

## Session Log — 2026-05-10

### Done

- `src/shared/pr-review/finding.ts` — Extended with `VerifierTargetSchema`
  (5-arm discriminated union) + `VerificationResultSchema` + optional
  `verifierTarget` + `verification` fields on `FindingSchema`.
- `src/activities/pr-review/verify-runner.ts` — `VerifierRunner` interface,
  `spawnWithTimeout` helper with 60s wall-clock kill, `truncateExcerpt`,
  `makeVerificationResult`, `makeBunSpawnVerifierRunner` with per-verifier
  decision logic (typecheck / eslint / grep / test), `makeUnavailableRunner`
  fallback when workdir is empty (Phase 1/2 stub mode).
- `src/activities/pr-review/verify.ts` — Replaced passthrough stub with
  `verifyOneFinding` (dispatcher) + `runVerifyFindings` (drop-on-contradict
  loop) + Temporal activity wrapper. Sentry capture path is tolerant of
  missing `Context.current()` (unit tests + replay CLI).
- `src/activities/pr-review/verify.test.ts` — 15 tests including the
  hallucinated-claim fixture (3 fakes → 0 kept), keep-verified-and-unverified,
  drop-on-contradict, runner-throws defense-in-depth, schema edge cases.
- `src/workflows/pr-review/index.ts` — Pass `context.workdir` into verify.
- `src/activities/pr-review/specialists/runner.ts` — Tightened
  `specialistOutputSchema` to require `verifierTarget` matching `verifier`;
  exported `VERIFIER_TARGET_INSTRUCTIONS` shared prompt block.
- 4 specialist files — appended `VERIFIER_TARGET_INSTRUCTIONS` so models
  emit shape-correct findings on the first try.
- `src/observability/metrics.ts` — Added
  `pr_review_verify_findings_total{verifier, outcome}` Counter.
- `packages/docs/plans/2026-05-10_sota-pr-review-bot.md` — Updated verify
  activity description.

### Remaining

- Open Phase 4 PR stacked on the Phase 3 branch (Task 4 PR).
- Operational replay of the hallucinated-claim fixture against a real
  workdir — happens once Phase 5 bootstrap is wired.

### Caveats

- Phase 4 uses host-side Bun.spawn. When Phase 5 introduces the Dagger
  container snapshot, replace `makeBunSpawnVerifierRunner` with the
  Dagger equivalent (the `VerifierRunner` interface stays the same).
- `BootstrapResult.workdir` is `""` in Phase 1/2 stub mode; all
  verifiers return `unverified` in that case. Findings still surface —
  the verifier just can't run.
- The hallucinated-claim drop-rate target (≥80% of single-agent FPs) is
  a corpus-level metric that lands with Phase 10's eval harness. Phase
  4's unit tests assert the mechanism; Phase 10 measures the rate.

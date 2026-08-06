---
id: 2026-07-28-ci-observability-acceptance-closeout
type: plan
status: in-progress
board: false
---

# CI Observability Acceptance Closeout

## Goal

Close the remaining evidence gaps in the CI observability rollout and determine
whether the original CI I/O goal was met. The formal gate remains at least 50%
fewer Buildkite pod-parent write bytes with no required lane p95 duration
regression above 10%.

The current implementation is functionally observable, and the measured
comparison suggests a 58.9% write reduction, but the result is not yet formally
accepted because cAdvisor stopped sampling when each agent container exited.
The post-merge Temporal schedule also advanced past its previous Codex
authentication failure and now fails on the manually maintained strict output
schema.

## Phase 1 — Terminal telemetry and Temporal reliability

- Add an executable Buildkite `agent-shutdown` hook from a ConfigMap and mount it
  through the Agent Stack's native `hooksVolume`.
- Retain the agent container for 20 seconds after Buildkite records job
  completion. The configured cAdvisor interval is 10 seconds, so this provides
  two terminal scrape opportunities without changing Buildkite's recorded job
  duration.
- Keep candidate telemetry strict. Abrupt process or node loss may still omit a
  terminal sample and must remain inconclusive.
- Replace the manually maintained agent-task output JSON Schema with a schema
  generated from a strict wire Zod schema. All wire keys are required and
  semantically optional values are nullable.
- Normalize the wire payload into the existing optional domain result type and
  use the same parser for Claude and Codex.
- Preserve and regression-test the deployed `OPENAI_API_KEY` to
  `CODEX_API_KEY` alias, with an explicit Codex key taking precedence.

## Phase 2 — Conservative proof and reproducible corpus

- Bump the CI I/O report to schema version 4.
- Add `proofKind`, `minimumAggregateWriteReductionPercent`, and
  `baselineSamplingIssueCodes` to the fixed-corpus gate while retaining the
  observed aggregate reduction field.
- Permit a baseline-lower-bound proof only when the candidate is complete and
  the baseline issues are limited to terminal or long-job sampling omissions.
  Continue rejecting ambiguous joins, counter resets, metadata mismatches,
  missing network measurements, unsuccessful jobs, unfinished builds, or
  workload mismatch.
- Treat a conservative minimum reduction below 50% as inconclusive. Treat an
  exact reduction below 50% as failed. Preserve the per-lane 10% p95 duration
  gate in both modes.
- Keep `--benchmark` strict for both windows. Under
  `--enforce-impact-gates`, validate the candidate strictly and let the fixed
  corpus proof decide whether the baseline is admissible.
- Add `CI_IO_FIXED_CORPUS=true` as a fail-fast, main-only operator mode that
  forces the playwright, resume, Docker E2E, images, and tofu selectors while
  leaving unrelated selectors unchanged. The image lane must build every known
  target in this mode.

## Delivery order

Use one isolated worktree containing a two-branch git-spice stack:

1. Phase 1 is independently deployable and lands first.
2. Confirm the hook and Temporal changes are live.
3. Restack and land Phase 2. Its first successful main build is the fixed-corpus
   candidate because the `.buildkite` change naturally runs the full corpus
   after the hook is deployed.

Use `CI_IO_FIXED_CORPUS=true` only if a replacement current-main candidate is
required. This is an operational build: it performs real image pushes and
OpenTofu applies.

After confirming the requested commit is current `main`, an operator can create
that build with:

```bash
bk build create \
  --pipeline sjerred/monorepo \
  --branch main \
  --commit <current-main-sha> \
  --env CI_IO_FIXED_CORPUS=true \
  --yes
```

The value is intentionally exact and main-only. Any other value, an unset
Buildkite branch, or a non-main branch is a configuration error. Fixed-corpus
mode forces only playwright, resume, Docker E2E, images, and Tofu; verify
already runs unconditionally and all unrelated selectors retain their normal
change-based decisions.

## Verification

### Local and PR

- Add cdk8s synthesis tests for the ConfigMap, executable mode, volume, and hook
  path.
- Add Temporal tests for generated-schema strictness, null normalization,
  scheduling validation, provider environment precedence, and secret
  sanitization.
- Add selector tests for normal, forced, invalid, non-main, full-image, and
  unrelated-lane behavior.
- Add reporter tests for exact proof, every allowed and disallowed baseline
  issue, incomplete candidates, conservative results below 50%, workload
  mismatch, unsuccessful jobs, and duration regressions.
- Run focused build, typecheck, test, and lint tasks for `@homelab/cdk8s`,
  `@shepherdjerred/temporal`, and `@shepherdjerred/root-scripts`.
- Run `bun run verify` because this changes CI and verification machinery.
- Require green current-head Buildkite CI and resolved review threads on both
  PRs.

### Post-deploy

- Confirm the agent has the executable hook mounted and logs the shutdown
  retention after Buildkite reports the job finished.
- Require every successful canary job to have a parent sample timestamp at or
  after its Buildkite `finished_at`.
- Require limiter p95 token wait to remain at or below
  `max(30s, pre-rollout p95 + 20s)`, with the work queue cleared and all 20
  tokens restored within 60 seconds after the build.
- Trigger `ci-io-post-merge-impact` after each phase as appropriate and require
  a successful Codex turn, parsed result, Postal delivery, and no credentials
  in logs or traces.
- Compare baseline Buildkite #5809 with the first successful Phase 2 main build.
  Require zero candidate integrity issues, exact workload parity, a conservative
  minimum reduction of at least 50%, and no required lane p95 regression above
  10%.
- Produce the final 24-hour and seven-day/100-finished-build report. Allow the
  Temporal schedule to self-cancel only after the final report is conclusive and
  passing.
- Capture Grafana terminal coverage and a real CLI report. Upload the artifacts
  to `public.sjer.red` and comment them on PR #1686 and the remediation PRs.

## Completion policy

- Complete and archive the observability-overhaul plan after terminal samples,
  dashboards, and Temporal reporting work end to end.
- Complete and archive the original CI I/O plan only if the formal impact gate
  passes.
- If the impact result fails or remains inconclusive, keep the original plan in
  progress and create `packages/docs/todos/ci-io-acceptance-gap.md` with the
  exact remaining condition. Do not claim the original goal was met.

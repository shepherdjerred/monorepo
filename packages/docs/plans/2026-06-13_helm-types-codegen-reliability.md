# Plan: helm-types codegen reliability

## Status

Largely Addressed by [PR #1150](https://github.com/shepherdjerred/monorepo/pull/1150) (in-flight) — this captures only the residual gaps. If #1150 covers them, delete this doc.

> **Update (2026-06-13):** `generate-helm-types` now has a `--check` mode and is run as a fail-fast Buildkite
> `helm-types-drift-check` gate (replacing the weekly Temporal refresh). See `2026-06-13_helm-types-ci-gate.md`.

## Background

`packages/homelab/src/cdk8s/scripts/generate-helm-types.ts` generates the **committed** `generated/helm/*.types.ts`. On 2026-06-13 it cost ~an hour of churn: it `rm -rf`'d the output dir at start, then fetched each chart with a network-flaky `helm repo update`, silently skipping (`warnOnly`) any that failed — so each run left a _different_ random chart missing and never converged, and `setup.ts` Phase 4 deleted committed types (the promtail/kube-prometheus drift, see `reference_setup_codegen_promtail_drift`).

## Already fixed by #1150

Per its description, #1150 "hardened the generator: it did `rm -rf` before regenerating … Now it writes in place, retries transient fetches, prunes only charts [removed from the catalog]." That removes the destructive wipe, adds retries, and stops silent deletion — the core failure modes above.

## Residual gaps (verify against #1150 before acting)

| Gap                                                                                       | Improvement                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serial fetches, ~3–6 min wall time                                                        | Bounded-concurrency `Promise.all` over charts                                                                                                     |
| No single-chart regen (must do all)                                                       | Optional `--chart <name>` arg to refresh one                                                                                                      |
| `setup.ts` still runs full codegen every dev run (churn even if no upstream change)       | Skip in setup unless types are missing, or make it a no-network "verify present" check; rely on the weekly refresh workflow + CI for actual regen |
| Failures after retries: confirm they now `exit 1` (fail loud) rather than `warnOnly`-skip | If still warn-only, fail the run so an incomplete set never lands                                                                                 |

## Acceptance

- A single `generate-helm-types` run with a transient network blip still produces the complete set (atomic, retried) — never a partial/empty dir.
- `setup.ts` doesn't leave committed helm types dirty in `git status` on a clean tree.

## Action

After #1150 merges, re-check this list; close out anything it already did and only implement the true remainder (likely just parallelism + targeted regen).

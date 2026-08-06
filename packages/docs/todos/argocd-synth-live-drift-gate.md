---
id: argocd-synth-live-drift-gate
type: todo
status: planned
board: true
verification: agent
disposition: deferred
---

# Catch source-vs-live ArgoCD drift before it wedges a sync

## Problem

Nothing catches a **mutually-exclusive-field change** (most commonly a probe
handler swap, `httpGet` ↔ `tcpSocket` ↔ `exec`/`grpc`) before it reaches a live
`argocd-sync` on `main`. ArgoCD's default client-side strategic-merge apply
merges the new handler on top of the old one, the apiserver rejects the patch
(`may not specify more than 1 handler type`), and the app is stuck
`SyncFailed` even though the synthesized manifest is already correct. The only
signal today is the `argocd-sync` step failing at deploy time.

This wedged the `media` app in 2026-08 (build #7574) — see
the original investigation. The current `pr-dryrun`
lane (`.buildkite/pipeline.yml`) only checks helm-types regen, tofu plans, and
side-effect-free `--dry-run` rehearsals; it never diffs rendered resource
manifests against live cluster objects, so it can't see this class of drift.

## Options / cost

1. **`argocd app diff` lane** — diff each app's rendered manifests against live
   in CI. Catches all drift, but needs live-cluster/ArgoCD creds in the PR lane
   and every _legitimate_ change also shows as a diff, so it needs careful
   signal design (e.g. only fail on apply-incompatible diffs, or advisory-only).
2. **Synth-diff handler-type detector** — a cheaper, offline check that flags
   when a probe/handler _type_ changed between the merge-base and HEAD synth
   output, and reminds the author a one-time `--replace` will be needed. No
   cluster access; narrow but covers the actual failure mode seen so far.
3. **Do nothing** — accept that these are rare, fail loudly at sync time, and
   remediate with a one-time `argocd app sync <app> --replace` (documented in the
   `argocd-app-patterns` skill).

Deferred at design time (2026-08-02): the two targeted fixes shipped without
building a gate; this records the gap for a future decision.

## Remaining

- [ ] Decide whether the payoff justifies a gate (option 1 vs 2 vs 3), weighing
      live-cluster creds in CI and false-positive noise on every legit change.
- [ ] If pursued, implement the chosen check and add it to the pipeline, with
      regression coverage and a doc of the selected approach.

## Comment Log

### 2026-08-02 — filed from the main-CI-red long-term fix

- Created as the deferred prevention layer for the `media` probe-handler-swap
  wedge. The immediate incident was remediated by a one-time operator replace;
  the recurrence guidance lives in the `argocd-app-patterns` skill.

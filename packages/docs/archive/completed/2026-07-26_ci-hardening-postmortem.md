---
id: ci-hardening-postmortem
type: plan
status: complete
board: false
---

# Post-mortem follow-ups: main-red saga (builds 6281→6352)

## Context

The get-main-green session fixed 7 root causes across 7 PRs
(#1666, #1669, #1670, #1671, #1674, #1677, #1682); main is green
(build 6352) and prod is healthy. This plan is the retrospective: what's left
to clean up or harden so the next incident is shorter. Everything below is
optional — main needs nothing further.

## Recommended work

### A. One "CI hardening" PR — prevents the recurring failure classes

| #   | Item                                        | File                                                                            | Why                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | buildkitd memory 12Gi → 32Gi                | `packages/homelab/src/cdk8s/src/resources/buildkitd.ts` (limits block near L95) | OOMKilled 14×/day during cold full-fleet bakes; liskov has **87.5Gi allocatable** and only CI schedules there. Each OOM = cache wipe + "waiting for connection" build failures.                                                                         |
| 2   | De-flake dvs pacing test                    | `packages/discord-video-stream/test/base-media-stream.test.ts:63`               | `expect(waited).toBeLessThan(150)` wall-clock bound starves under CI load (291ms observed; passed on retry). Add bun:test `{ retry: 2 }` — load spikes are transient so a genuine regression (deterministic slow wait) still fails all attempts.        |
| 3   | health-wait timeout says _which_ app        | `packages/homelab/scripts/argocd.ts` `healthWait` (~L277)                       | Every timeout this session ("apps did not become Synced/Healthy within 300s") required manual kubectl to find the culprit. On timeout, print non-Synced/non-Healthy apps + their first offending resources (data already in the API response it polls). |
| 4   | Derive the `sites` lane from per-site lanes | `.buildkite/scripts/ci-changed.sh`                                              | The #1666 root cause was two hand-maintained path lists skewing. Build the aggregate `sites` list as the union of `site-*` lane arrays so the skew class is structurally impossible (the OR'd gate in pipeline.yml then becomes belt-and-suspenders).   |

Verification: `bun run verify -- --affected`; for (2) loop the dvs test ~10×;
for (1)+(3) `bunx turbo run build test --filter=@homelab/cdk8s`; for (4)
`bash -n` + a CHANGED/unchanged spot-check with `CI_CHANGED_BASE` against a
versions.ts-only commit. One PR (grouped/themed per your preference).

### B. Separate PR — smoke as the deploy uid (would have caught #1682)

Run each app image's in-image smoke as uid 1000 instead of root (e.g.
`USER 1000` in the smoke stages, or setpriv in
`.buildkite/scripts/smoke-app-in-image.ts`). Root-running smoke structurally
cannot see permission failures like the Prisma-engines crash-loop. Kept
separate from A because it can surface false positives (smokes that write
scratch files) and needs a full local bake of each app target to validate.

### C. Housekeeping (no PR)

- **Worktree sweep**: 42 worktrees exist under `.claude/worktrees/`, many for
  long-merged PRs (`pr-1643-bindery-fork-chinese`, `pr-1629-liskov-join`,
  `pr-1514-s3-drop`, …). Squash-merges hide ancestry, so the safe sweep is:
  per worktree, look up its PR state via `gh`, and `git worktree remove` +
  delete branch only when the PR is merged AND the tree is clean; report the
  ambiguous rest. These may be your parked sessions — sweep only on your
  go-ahead.
- **Stale memory**: my `greptile-gate-merge-skip` memory documents the retired
  Greptile gate; the gate is now provider-neutral Codex
  (`robot-face-review-gate`, #1657). Update it with the one new fact learned
  today: an admin-merge cancels the in-flight PR build and the gate reports
  "fail" — benign, not a real failure.

### D. Observations needing no action

`the former session-journal directory` (metadata handshake > re-derived gates; turbo cache
masks environment-dependent test failures until an unrelated input change;
first build after an infra cutover runs latent never-executed code; the
`-liskov` PVC rename pattern; prune exception rationale).

- Cluster state is clean: old `zfs-ssd` git-mirrors PVC pruned, all buildkite
  PVCs on lz4, all ArgoCD apps Synced/Healthy, mario-kart 1/1 Running.
- The release machinery (tag mint, commit-back, release-please) is unblocked
  and proven end-to-end — no follow-up needed there.

## Suggested execution order

1. PR A (CI hardening, 4 small changes) — highest recurrence-prevention per line.
2. Worktree sweep (C) after you confirm which are safe.
3. PR B (smoke-as-uid) when there's appetite for the bake-validation cycle.
4. Memory touch-up (C) — I'll do it inline, no repo change.

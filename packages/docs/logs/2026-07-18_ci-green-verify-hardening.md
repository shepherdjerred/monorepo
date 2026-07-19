# CI Green — Verify Hardening

## Status

In Progress

## Context

Main has had no green build since 5492 (2026-07-12). The two most recent
completed main builds each failed the `:turborepo: verify` step on a
different load-sensitive flake, and every build since has been superseded by
newer pushes before finishing:

- **Build 5694** — `@homelab/cdk8s#test`: the PagerDuty alert rendering test
  compiles a Go helper (`amrender`); `go build` failed with
  `error obtaining VCS status: exit status 128` because the step container's
  checkout had unresolvable git alternates. PR #1544 fixed the mount; the
  test build was still non-hermetic.
- **Build 5698** — `tasknotes-server#test`: `IdempotencyStore` "caps stored
  records, evicting oldest first" does 510 sequential ack-after-persist file
  writes and hit 5.18s against bun's 5s default timeout under CI disk load.
  Same failure class as the scout-for-lol timeout fixed in #1523, different
  package.

Build 5732 (latest main commit) is being monitored while these fixes ride in
a PR.

## Fixes

1. `packages/tasknotes-server/src/__tests__/idempotency.test.ts` — explicit
   20s timeout on the eviction test (matches the #1523 precedent).
2. `packages/homelab/src/cdk8s/src/pagerduty-alerting.test.ts` — build
   `amrender` with `-buildvcs=false`; the helper never reads its VCS stamp,
   so the build no longer depends on git state at all.
3. `packages/scout-for-lol/packages/backend/turbo.json` — `generate` now
   depends on `^build`. The template-DB seed imports `@scout-for-lol/data` →
   `@shepherdjerred/llm-models`, whose exports only resolve from built
   `dist/`. CI was masked by turbo cache hits; every fresh checkout/worktree
   failed at `bunx turbo run generate` with
   `Cannot find module '@shepherdjerred/llm-models'`.
4. Deleted `packages/docs/todos/scout-data-missing-llm-models-dep.md` — the
   dep-declaration half was resolved by the workspace:\* migration; the
   remaining build-ordering half is fixed by (3). Verified: fresh-worktree
   `bunx turbo run generate` now passes.
5. `packages/docs/logs/2026-07-18_ci-node-purchase-sanity-check.md` —
   markdownlint `--fix` for 5 MD004 errors (asterisk bullets) committed to
   main unlinted in `7ea657803` (hooks weren't armed there). This one is not
   a flake: `//#markdownlint` fails deterministically, so build 5732 was
   doomed regardless of the flakes above.

## Round 2 — build 5748: tofu tunnel gate (after #1550 merged)

With the verify flakes fixed, build 5748 got past verify and failed at
`:terraform: tofu apply (cloudflare, after tunnel gate)`: the gate waits for
the seaweedfs S3 `TunnelBinding` to be deleted from the `apps` Application
and timed out with `1 remaining`.

Root cause was two-layered:

- **Nothing ever prunes.** The binding was removed from manifests in #1340
  (June) with this exact gate as the fail-closed ordering guarantee — but
  `apps` has `automated: {}` (no prune) and neither the old nor the new CI
  sync sends `prune`, so the binding sat orphaned
  (`requiresPruning: true`) since 2026-03-15. The old Dagger-era gate
  apparently never actually detected it; the replatformed
  `argocd.ts wait-deletion` reads `status.resources`, which does. Fixed
  operationally: deleted the binding 2026-07-19 (provenance verified: tofu
  already declares the DNS removal, all consumers migrated to tailnet;
  finalizer completed cleanly). Policy decision filed as
  `todos/argocd-apps-prune-policy.md` — includes a full orphan inventory
  (notably the entire leftover Dagger stack in `apps`).
- **The sync step masks failed operations.** Build 5748's `argocd-sync` step
  "passed" although the sync operation failed (kyverno admission webhook
  `connection refused` — kyverno pods restart in lock-step under CI load;
  the admission controller had 19 restarts in 4h). The POST only starts the
  operation; nothing checked its result, so the failure surfaced two steps
  later at the gate with a misleading symptom. Fixed in code:
  `argocd.ts sync` now polls `status.operationState` (guarding against the
  previous operation's state via `startedAt`) until Succeeded/Failed/Error
  and throws on failure, so Buildkite's step retry re-syncs through
  transient webhook downtime. E2E-validated against live ArgoCD:
  stale-op guard, Running → Succeeded tracking, clean exit.

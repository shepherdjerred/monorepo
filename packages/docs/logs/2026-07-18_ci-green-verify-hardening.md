# CI Green — Verify Hardening

## Status

Complete

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

## Round 3 — build 5789: typed lint races Prisma codegen

Build 5789 (with #1515's competition changes invalidating the lint cache)
failed `@scout-for-lol/backend#lint` with dozens of
`no-unsafe-*` errors on `prisma.competitionParticipant` — the generated
Prisma client wasn't there when lint ran. Root turbo.json gives `lint` only
`^build` (unlike `typecheck`/`test`, which also carry `generate`), so on a
cold CI container typed lint (projectService) races codegen and the client
resolves as an error type. Fixed by adding
`"lint": { "dependsOn": ["^build", "generate"] }` to all three Prisma
packages (scout backend, birmel, dpmk backend — birmel/dpmk were the same
latent bomb, just still cache-masked). Validated: dry-run graphs show the
edge; deleting `generated/` and running lint regenerates then passes.

## Round 4 — build 5809: the green run

Builds 5795/5796/5800/5802/5808 were all canceled by pushes to main
(PR merges, the auto-merge version-bump PR #1558, and other agent sessions
committing session logs directly to main — `cancel_running_branch_builds`
is on with no branch filter). After the operator paused the other sessions,
build 5809 ran to completion with two transient hard failures retried in
place:

- `:docker: images` (build 5796's occurrence): ghcr blob-CDN egress flake —
  the pinned `mcp-proxy` digest was verified pullable locally, so the pin is
  correct; job retry succeeded.
- `:package: release-please`: GitHub GraphQL 500 (`Something went wrong
while executing your query`). The step has no automatic retry in
  `.buildkite/pipeline.yml`; manual retry succeeded.

**Build 5809 passed 2026-07-19 19:46 UTC — first green main since 5492
(2026-07-12).**

## Session Log — 2026-07-19

### Done

- PR #1550 (merged): idempotency-test 20s timeout, amrender
  `-buildvcs=false`, scout `generate → ^build` edge, markdownlint MD004
  fixes; deleted resolved todo `scout-data-missing-llm-models-dep`.
- PR #1559 (merged): `argocd.ts sync` waits for the sync operation's
  terminal phase (e2e-tested live); `lint → generate` edges in scout
  backend, birmel, dpmk backend turbo.json.
- Operational: deleted the orphaned seaweedfs `TunnelBinding`
  (provenance-verified; finalizer completed) — unblocked the tofu tunnel
  gate. Re-synced the `apps` ArgoCD Application.
- Filed `todos/argocd-apps-prune-policy.md` (prune decision + full orphan
  inventory incl. the leftover Dagger stack).
- Retried two transient CI failures (ghcr egress, GitHub GraphQL 500) to
  land green build 5809.

### Remaining

- `release-please` step needs `retry: *retry` in `.buildkite/pipeline.yml`
  (a lone GitHub 500 hard-fails the build today).
- `argocd-apps-prune-policy` todo needs an operator decision.
- kyverno pods restart in lock-step under CI load (admission controller
  19 restarts/4h) — syncs now fail fast + retry through it, but the
  underlying instability is unaddressed.

### Caveats

- Main-push build cancellation churn is the dominant failure mode:
  5 candidate builds died to pushes, not defects. Options discussed:
  branch filter `!main` on `cancel_running_branch_builds` (declined for
  now), `[skip ci]` on bot docs commits, batching merges.
- The `pr-monitor` skill description currently claims this repo has no CI —
  stale; Buildkite is live.

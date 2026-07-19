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

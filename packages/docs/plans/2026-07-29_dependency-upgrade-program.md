---
id: plan-2026-07-29-dependency-upgrade-program
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Dependency Upgrade Program

## Goal

Prepare and validate the pending Renovate upgrades for ESLint Unicorn,
Emscripten, Codex, and TypeScript without combining unrelated risk. Keep the AI
SDK upgrade visible but gated until VoltAgent 3 has a compatible stable release.
Scout and Starlight production image promotions are excluded; their TypeScript
manifests remain part of the repository-wide compiler rollout.

## Delivery Model

- Use one focused PR for Unicorn, Emscripten, and Codex.
- Use a two-PR git-spice stack for the TypeScript pilot and repository rollout.
- Keep PRs draft while the repository's dependency-stability policy blocks
  merging. Do not force Renovate's schedule or pending-status checkboxes.
- Rebase and revalidate each PR against current `main` before promoting it to
  ready.
- Treat Buildkite as the exhaustive verification gate and inspect the earliest
  authoritative failure rather than downstream fallout.

## Phase 1 — ESLint Unicorn 72

- [x] Update `eslint-plugin-unicorn` from 69 to 72 and refresh the root lockfile.
- [x] Preserve the explicitly reviewed 137-rule policy rather than inheriting a
      newer recommended preset implicitly.
- [x] Update policy-test wording for the v72 baseline and migrate any renamed or
      behaviorally changed rules.
- [x] Run the ESLint config package's typecheck, tests, and lint, followed by
      downstream lint coverage for consumers of the shared config.

## Phase 2 — Emscripten 6.0.5

- [x] Update both executable Emscripten pins to
      `6.0.5@sha256:76a44fff907397784decc435115d07fcb9587a4f1504977f39f3745e538e3a1e`.
- [x] Update the Renovate configuration fixture and stale build documentation.
- [x] Build the patched N64Wasm source through the real container toolchain.
- [x] Run a ROM-free Worker smoke test and the canonical-ROM input assertion.

## Phase 3 — Codex 0.146.0

- [x] Update the exact `@openai/codex` production dependency and lockfile.
- [x] Add a local, network-free CLI contract test covering the version, required
      execution flags, and disabled feature switches used by release refinement.
- [x] Run the root scripts package's typecheck, tests, and lint.

## Phase 4 — TypeScript 7

### Pilot PR

- [x] Keep `typescript` 6.0.3 as the programmatic compiler API.
- [x] Add exact `@typescript/native: npm:typescript@7.0.2`.
- [x] Select `node_modules/@typescript/native/bin/tsc` explicitly through the
      package-local `PATH` for compiler scripts instead of relying on a
      `.bin/tsc` collision.
- [x] Pilot the split in root scripts, shared ESLint config,
      astro-opengraph-images, CDK8s, Tasks, and the Scout root.
- [x] Update the new-package scaffold so future packages follow the split.

### Rollout PR

- [x] Apply the explicit native compiler invocation to the remaining root
      workspaces, including Scout and Starlight manifests.
- [x] Add a repository compliance guard that detects drift back to ambiguous
      `tsc` resolution or unused native aliases.
- [x] Keep the three maintained non-workspace examples on the TypeScript 6 API
      until the TypeScript 7 JavaScript API is supported.
- [x] Run focused package verification during migration and complete the
      exhaustive 217-task repository validation locally.

## Phase 5 — AI SDK and OpenAI Provider

- [ ] Wait for stable VoltAgent core, LibSQL memory, and logger releases whose
      peer ranges support AI SDK 7 and provider-utils 5.
- [ ] Start the repository's 30-day dependency-stability window from those
      stable releases.
- [ ] Revalidate the migration against the released APIs rather than assuming
      the current VoltAgent prerelease shape.
- [ ] Update `ai`, `@ai-sdk/openai`, the VoltAgent packages, and any required
      schema types in one coordinated PR.
- [ ] Migrate nullable reasoning summaries and other type/API changes, then run
      real provider-backed end-to-end acceptance.

The 2026-07-29 implementation gate remains closed: `@voltagent/core`,
`@voltagent/libsql`, and `@voltagent/logger` still publish versions 2.9.0,
2.1.2, and 2.0.2 on `latest`; version 3 remains on `next`.

## Acceptance

- Each code phase has a focused draft PR with current-head local verification.
- Mandatory Buildkite and review-provider checks pass before a PR is ready.
- Dependency stability windows are respected; blocked upgrades remain visible
  rather than being ignored.
- The AI phase does not begin until stable VoltAgent releases satisfy the peer
  dependency gate.
- No Scout or Starlight production image promotion is included.

## Remaining

- [ ] Rerun current-head Buildkite for draft PRs #1837, #1838, #1840, #1842,
      and #1843 after the CI-only node `liskov` is Ready and schedulable.
- [ ] Recheck dependency eligibility before promoting any draft PR to ready.
- [ ] Begin the AI SDK phase only after stable compatible VoltAgent releases and
      the required stability window.

## Session Log — 2026-07-29

### Done

- Revalidated Renovate Dependency Dashboard issue #481 against current `main`.
- Confirmed the selected Unicorn, Emscripten, Codex, and TypeScript updates
  remain pending status checks.
- Confirmed VoltAgent core 3, LibSQL memory 3, and logger 3 remain prereleases,
  so the AI SDK phase is still gated.
- Recorded the approved implementation and verification sequence in this plan.
- Updated all three direct `eslint-plugin-unicorn` manifests and the root
  lockfile from 69 to 72.
- Added an exact 137-rule policy assertion and migrated the repository for
  Unicorn 72's stricter simple-condition ordering without suppressions.
- Passed the shared ESLint config's typecheck, all 245 tests, and lint.
- Passed all 63 downstream lint tasks across 48 consumers with the unmodified
  Unicorn 72 rule implementation.
- Passed the dependent typecheck and test closure after focused recovery of its
  three initial failures, including 324 root-script tests and 756 Temporal
  tests.
- Published focused draft PRs #1837 (Unicorn 72), #1838 (Emscripten 6.0.5),
  and #1840 (Codex 0.146.0).
- Verified the Emscripten update with the real patched container build,
  ROM-free Worker smoke test, and canonical-ROM input assertion.
- Added a network-free Codex CLI contract suite and passed the root scripts
  package's typecheck, tests, and lint.
- Published the TypeScript 7 pilot and rollout as draft stack PRs #1842 and
  #1843.
- Passed the TypeScript rollout's exhaustive local `bun run verify` graph:
  217 of 217 tasks.
- Rechecked the live package registry and confirmed VoltAgent 3 remains on
  `next`, so AI SDK 7 and `@ai-sdk/openai` 4 remain intentionally unchanged.
- Diagnosed remote CI before retrying: builds #7150, #7153, and #7158 produced
  no job log and ended in Buildkite `stack_error`; the current TypeScript jobs
  are reserved against Pending pods because the CI-only node `liskov` is
  NotReady and cordoned.

### Remaining

- [ ] Restore the CI-only node `liskov`, then rerun and monitor Buildkite on the
      exact current heads of draft PRs #1837, #1838, #1840, #1842, and #1843.
- [ ] Recheck dependency eligibility before promoting any draft PR to ready.
- [ ] Begin the AI SDK phase only after stable compatible VoltAgent releases and
      the required stability window.

### Caveats

- Dependency-policy status checks currently prevent the selected upgrades from
  merging even when their implementation checks pass.
- Remote Buildkite has not executed repository code for these PRs during the
  current node outage; local verification is complete, but remote CI remains
  required.
- The AI migration validated against VoltAgent prereleases is research evidence,
  not authorization to ship before the stable releases.
- Scout and Starlight manifests are included in the TypeScript compiler rollout;
  no Scout or Starlight production image promotion is included.

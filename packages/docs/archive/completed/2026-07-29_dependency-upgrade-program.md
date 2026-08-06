---
id: plan-2026-07-29-dependency-upgrade-program
type: plan
status: complete
board: false
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

- [x] Split the ecosystem-gated AI SDK 7 and OpenAI provider 4 migration into
      `packages/docs/todos/voltagent-ai-sdk-7-upgrade.md` so the four delivered
      phases can close without hiding the external compatibility gate.

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

- [x] Rerun current-head Buildkite for draft PRs #1837, #1838, #1840, #1842,
      and #1843 after the CI-only node `liskov` is Ready and schedulable.
- [x] Recheck dependency eligibility and merge the five focused PRs after their exact-head gates pass.
- [x] Move the AI SDK phase to its dedicated blocked tracker pending stable compatible VoltAgent releases and the required stability window.

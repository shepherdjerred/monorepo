# Code-Quality Remediation Plan

## Status

In Progress — **item #1 (pre-commit ↔ CI parity) shipped on `feature/code-quality-ci-parity`**; items 2–10 below are
deferred and tracked here. Mirror of the approved harness plan `~/.claude/plans/ok-let-s-work-on-fancy-conway.md`.

## Context

A high-bar audit (2026-06-13, see `logs/2026-06-13_code-quality-audit.md`, `logs/2026-06-13_consistency-conventions-audit.md`,
`logs/2026-06-13_error-handling-audit.md`, `logs/2026-06-13_suppressions-ignore-inventory.md`) found the repo's safeguards
are often **performative** — present enough to look governed, not wired tightly enough to bind. The thesis: most of the work
is making _existing_ policy binding and uniform, not inventing new policy. The maintainer scoped the first PR to item #1 and
deferred the rest to this doc.

### Corrections to the original audit (verified in-tree before shipping)

The audit was run against `8f3538b1b`; some claims were wrong once re-checked on current `main`:

- **ESLint _does_ run in CI** — `scripts/ci/src/steps/per-package.ts` emits an `:eslint: Lint` step
  (`dagger call lint <pkg>` / `generate-and-lint`) per package, gated by change detection. Changed `packages/*` are
  re-linted in CI. The real gap is the trees **outside `ALL_PACKAGES`**: `.dagger/src/`, top-level `scripts/`, `scripts/ci/`
  have no eslint config and no lint step (item #6).
- **`migration-guard` is already a CI gate** (`migrationGuardHelper`/`migrationGuard` func/`migrationGuardStep`, registered
  in `pipeline-builder.ts`). The original audit asserted it was pre-commit-only; that was an unverified inference. **Only
  `check-todos` was genuinely missing from CI** — fixed in item #1.

These corrections are why item #1's parity test exists: a maintained guard so this class of "advisory-only gate" can't recur.

## Item #1 — DONE (this branch)

Added `check-todos` as a CI gate (`.dagger/src/quality.ts` `checkTodosHelper`, `.dagger/src/index.ts` `checkTodos` func,
`scripts/ci/src/steps/quality.ts` `checkTodosStep`, registered in `pipeline-builder.ts` blocking gates) **and** a durable
parity meta-test (`scripts/ci/src/__tests__/lefthook-ci-parity.test.ts`) that fails if any lefthook leaf job lacks a CI
disposition. Verified: `scripts/ci` typecheck + 241 tests green; full pipeline emits the `check-todos` step.

## Deferred workstreams (2–10)

| #   | Workstream                                                                                               | Core action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Effort / risk                             |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 2   | **Safeguard sign-off**                                                                                   | CODEOWNERS won't work (solo maintainer). Add a Buildkite **`block` step** (manual unblock) triggered when a PR touches governance/baseline paths: `.quality-baseline.json`, `.coverage-baseline.json`, `lefthook.yml`, `packages/eslint-config/**`, `scripts/ci/**`, `.dagger/**`, `clippy.toml`, `.golangci.yml`, `knip.json`, `rulesets.tf`. **Caveat:** BK block steps are unblockable via the REST API with a build-write token — the gate only holds if no agent/automation token can unblock; make the block a required check via `rulesets.tf`.                                                                                                                                                                                                                                                                                       | med / low                                 |
| 3   | **Split-brain rules → enable for all TS packages**                                                       | Promote scout-only custom rules into the base config: `prefer-async-await` (≈0 fallout — repo already passes), `prefer-structured-logging` (birmel/temporal/streambot/monarch), `prefer-bun-apis` (4 `process.env` holdouts), `prefer-date-fns` (scoped to date-math packages), `no-re-exports` (63 barrels to de-barrel — maintainer wants it on), add `eslint-plugin-no-only-tests`, `strict-boolean-expressions` warn→error once clean. Codemod-then-enable, one rule per PR so each lands green.                                                                                                                                                                                                                                                                                                                                         | med-high / med (fallout)                  |
| 4   | **Duplication: jscpd for ALL packages**                                                                  | jscpd CLI (cross-file/cross-package; the existing `jscpd-duplication` eslint rule is per-file and off) + `.jscpd.json` + lefthook job + Dagger CI step (clone `knip-check`) + a baseline so duplication only decreases. Extractions (`createHelmApp`, shared logger, shared HTTP client, `discord-plays-common`) are separate refactors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | med / low (detection); high (extractions) |
| 5   | **Ratchet → 100% suppression coverage**                                                                  | Extend `scripts/quality-ratchet.ts` + `check-suppressions.ts`: track module-level `#![allow(` (currently invisible — `main.rs` silences 20 lints unseen), Go `//nolint`, Python `# noqa`/`# type: ignore`, shell `# shellcheck disable`, CSS/YAML; widen `searchPaths` to `scripts/`; rebuild baseline; reconcile the mario-kart-frontend `main.tsx` drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | med / low                                 |
| 6   | **Lint `.dagger`/`scripts`** (confirmed unlinted: no eslint config, not in `ALL_PACKAGES`, no lint step) | Add `eslint.config.ts` to `.dagger/` + `scripts/` (covering `scripts/ci`); a dedicated lint step/matrix + lefthook jobs; fix the type-aware fallout (likely home of the audit's floating-promise/empty-catch escapes). Un-ignore per-package `scripts/` subdirs (monarch/homelab/scout eslint configs ignore them — monarch's holds the `as`-cast files).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | med / med (fallout)                       |
| 7   | **Coverage**                                                                                             | (a) make Dagger `test()` return the `Container` (like `buildPackage`) + a `testCoverage` func → export lcov + BK artifact/annotation (clone `knip-check`); (b) delete useless tests (scout ~16 empty `*.skip`, 6× `expect(true).toBe(true)`, vacuous Rust `tests.rs`) + add `check-test-quality.ts` + `no-only-tests`; (c) standardize bunfig coverage block across packages, `coverage-ratchet.ts` + `.coverage-baseline.json`, `check-package-gates.ts` (every `ALL_PACKAGES` entry has eslint config + coverage bunfig + lint/typecheck/test scripts + CI step — closes the "new package skips the gates" leak); backfill monarch `apply.ts`/`monarch/*` (money mutations, 0 tests) + 16 untested temporal workflows toward a real floor (70% line / 60% branch); Go `-coverprofile`; Rust `cargo llvm-cov` (no Rust CI test step today). | high / low-med                            |
| 8   | **Dangerous suppressions**                                                                               | Re-scope `.golangci.yml` gosec `G104` (unhandled errors) to `_test.go` only — stop hiding it in production `internal/client/` (the `nvram.go` bug class); stop excluding `**/*.test.ts` from typecheck (tasks-for-obsidian, eslint-config, scout/report, both discord backends); remove stale ignores (e.g. better-skill-capped `fetcher/**`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | low / low                                 |
| 9   | **Convention drift**                                                                                     | Small fixes now-ish: `sjer.red/.../event.ts:12` `z.date()`→`z.coerce.date()`; `leetcode-graphql.ts:1-2` non-null env; the 4 error-handling offenders (`tasknotes-server` reader/store, `webring` cache) get logging+rethrow. Big convergences (codemod-then-enforce, one per PR): timeouts → `AbortSignal.timeout` everywhere (+ new `require-fetch-timeout` rule), collapse 3 OTel loggers + 5 toolkit `{success,data,error}` clients, 2 express webservers → Hono. New rules: `no-non-null-env`, `catch-returning-default-must-log-or-throw`.                                                                                                                                                                                                                                                                                              | mixed                                     |
| 10  | **Exemptions / new linters**                                                                             | Gate or delete, no vibe-exemptions: `leetcode` (add config **or** drop from `ALL_PACKAGES`), `dotfiles`/`stocks-sjer-red`, `SKIP_PACKAGES` (anki/docs/dotfiles/fonts), `discord-video-stream` (its own strict gate that ratchets toward the repo standard). New-language linters, warn-first → ratchet: **ruff** (Python — unlinted cluster exporters!), **hadolint** (9 Dockerfiles), **`tofu fmt`/validate + tflint** (27 `.tf`), **stylelint** (21 CSS/SCSS), **shfmt** (42 `.sh`), yamllint.                                                                                                                                                                                                                                                                                                                                             | med / low (warn-first)                    |

## Sequencing (deferred items)

Themed PRs, low→high risk: (1) enable existing rules §3 one at a time; (2) ratchet→100% §5 + jscpd §4; (3) lint `.dagger`/`scripts` §6; (4) BK sign-off §2; (5) coverage §7; (6) suppression fixes §8; (7) convergence §9; (8) exemptions/new-linters §10. Each new gate lands _after_ its existing violations are fixed, so it goes in green.

## Out of scope

- Module-boundary enforcement — handled separately via **dependency-cruiser** (maintainer).
- A full Nx-style visibility system.

## Session Log — 2026-06-13

### Done

- Shipped item #1 (check-todos CI gate + lefthook↔CI parity meta-test) on `feature/code-quality-ci-parity`.
- Wrote the findings docs (consistency, error-handling, suppressions inventory) + this remediation plan.

### Remaining

- Items 2–10 above (deferred by maintainer to plan-doc tracking).

### Caveats

- Corrected two audit inaccuracies (ESLint _is_ in CI per-package; `migration-guard` _was_ already a CI gate) — re-verify
  any audit claim against current `main` before acting, since the audit ran on `8f3538b1b`.

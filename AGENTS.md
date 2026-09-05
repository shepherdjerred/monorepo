# Repository agent guidance

This is Jerred's personal production homelab monorepo. Treat it as a live
system, not a sample repository.

Every first-party hosted site, API, bot, worker, and supporting service runs
through the repo-owned homelab infrastructure and GitOps release path. Native
applications, browser extensions, libraries, and published packages are not
hosted workloads. External APIs and control planes are dependencies, never
deployment targets.

## Where guidance belongs

- This file and nested `AGENTS.md` files contain always-on, non-obvious
  constraints. The nearest file wins when scopes differ.
- `.agents/skills/` contains procedures loaded only for matching tasks.
- Package READMEs contain package APIs and contributor reference.
- `packages/docs/wiki/` explains architecture and holds durable operator
  how-tos. Follow its Diátaxis rules.
- `package.json` and `packages/README.md` are the package inventory authorities.
  Do not copy a static workspace tree into agent guidance.

Do not turn plans, work logs, or historical rollout details into repository
documents. Track unfinished work in Linear or the PR.

## Workspace and runtime

This is one Bun workspace with one root `bun.lock` and the isolated linker.
Run `bun install --frozen-lockfile` once at the root. Internal dependencies use
`workspace:*`; never use npm, Yarn, pnpm, per-package lockfiles, or copied
workspace artifacts. Use Bun APIs in Bun-only TypeScript when they are clearer
than Node compatibility APIs.

After dependency or schema changes:

```bash
mise install
bun install --frozen-lockfile
bunx turbo run generate
bunx lefthook install
```

Recurring and scheduled work belongs in Temporal Workflows and declarative
Schedules under `packages/temporal`, never Kubernetes CronJobs, host crontabs,
or in-process timers.

## Engineering invariants

- Never use TypeScript assertions except `as const` and `as unknown`. Parse
  untyped boundaries with Zod or narrow them explicitly.
- Let broken internal contracts fail loudly. Handle expected user and external
  boundary errors with typed, useful responses.
- Do not add fallbacks for corrupt data, unknown enums, missing assets, or
  required tools. Fix the producer or contract.
- Never suppress CI, lint, tests, Renovate, or architecture rules to get green.
  Do not skip tests because generated output is missing; build the prerequisite.
- Fix dependency upgrades forward using the migration guide and validation
  tools. Do not revert merely to avoid the migration.
- Shared cross-language data uses a language-neutral source of truth plus
  per-language validation.
- Module boundaries are enforced by `@shepherdjerred/architecture`. Fix cycles
  or coupling; never weaken a rule. Boundary fixtures must prove each rule can
  fail.
- After roughly two failed attempts at the same workaround, step back and
  reconsider the design instead of layering more exceptions.
- No directory may exceed 50 code files, counted per directory with source and
  colocated tests holding separate budgets
  (`scripts/checks/check-directory-file-counts.ts`). Split the directory into
  sub-domains; never raise `CEILING`, which is already at the permanent target
  and has no allowlist to add to.

Automation under `scripts/`, `.buildkite/`, and deploy/build scripts must not
hide failures or credentials. In particular, do not add `|| true`,
`2>/dev/null`, `|| echo`, `|| bun install`, `--no-exit-code`, token-bearing
URLs, token files, `git add .`, or `git add -A`.

Every newly added or rewritten URL must return HTTP 200 before commit.

## Configuration and secrets

For first-party applications, environment variables are for credentials and
bootstrap only. Product and operational behavior uses the typed configuration
and feature-flag packages. Load the `feature-flags` skill before changing that
boundary.

Never print, paste, or persist secrets. Use existing 1Password-backed commands.
On macOS, `op whoami` may be false while Desktop-authorized operations work;
probe with the exact read or `op vault list`. An empty `cf auth list` is normal
for environment-token authentication; use `cf auth whoami` or a read-only API
call and distinguish authentication from authorization.

## Homelab ownership and delivery

Infrastructure source lives under `packages/homelab`. Change repo-owned IaC and
let Buildkite and ArgoCD apply it; do not make an untracked dashboard or cluster
mutation when a declarative path exists. Load the homelab development or
operations skill before changing or operating that system.

These are separate acceptance layers:

1. source and focused local checks;
2. exact-head Buildkite CI;
3. built and published artifacts;
4. ArgoCD reconciliation to the intended revision;
5. observed runtime health and user-visible behavior.

State exactly which layers were verified. A green PR does not prove deployment,
and ArgoCD health does not prove the user flow.

Root ArgoCD releases and pruned syncs use the repository's `release-root`
workflow. Never infer prune candidates from `OutOfSync` alone or bypass its
exact-revision, lifecycle, immutable-field, and request-ownership checks.

## Development and verification

During implementation, run focused tasks:

```bash
bunx turbo run build typecheck test lint --filter=<package>
bunx lefthook run pre-commit
```

Buildkite is the exhaustive gate and the CI source of truth. Use `toolkit bk` or
`toolkit pr health`, not GitHub Actions. Run `bun run verify` locally only when
reproducing CI or changing verification machinery.

Verify claims from the live tree before reporting them. Preserve unrelated
worktree changes. Do not call an issue "pre-existing" when the task explicitly
requires complete quality.

When a change alters an architecture boundary, operator workflow, or system
rationale, update the relevant README or wiki page in the same change. Do not
write a session journal.

## Git and pull requests

Feature work uses `toolkit git-spice`; a single PR is a stack of one. Load the
`monorepo-delivery` skill before branch, stack, PR, or CI-recovery work. Never
hand-roll a stack rebase or create a feature PR with bare `gh pr create`.

Commits use `type(scope): outcome`. The primary commit and PR body include
`Why`, `What`, and `Verification`, including live checks not run. Stage explicit
paths only. Keep PR metadata based on the complete branch diff.

Attach the lightest useful visual proof when behavior is visual or interactive;
pure logic and internal refactors need exact commands instead. Use
`toolkit pr asset` for externally hosted PR media.

Automated review focuses on P0-P2 correctness, architecture, process, and secret
hygiene. Mechanical formatting and type errors are covered elsewhere. Before
pushing a review fix, inspect and resolve the provider finding so the required
review gate observes both the code and thread state.

## Task-specific guidance

Use the matching repository skill in `.agents/skills/` for repeatable delivery,
homelab, Scout, Temporal, TaskNotes, docs, Linear, PostHog, Discord, or report
rendering work. Package-local runtime skills remain application assets and do
not replace repository workflow guidance.

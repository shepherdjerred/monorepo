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
documents. Track unfinished work in the Tracker `AI` team or the PR. Never
create an issue in `SJ`, which is reserved for human-created work; update an
existing `SJ` issue only when the task explicitly identifies it.

When the development environment blocks you — a reliably failing tool, broken
documented command, missing verification access/fixtures, or repeated manual
sequence — search `AI`'s `Developer Experience` project, vote on a match, or
file a new issue for systemic problems (not one-off mistakes, guesses, or small
in-scope fixes). File inefficiency, automation candidates, poor architecture,
and tech debt the same way in `AI` with `Improvement`. Filing never blocks or
widens the task: deliver first, then file and name every filed or upvoted issue
in the final report (`tracker-work-management`).

## Workspace and runtime

This is one Bun workspace with one root `bun.lock` and the isolated linker.
Run `bun install --frozen-lockfile` once at the root. Internal dependencies use
`workspace:*`; never use npm, Yarn, pnpm, per-package lockfiles, or copied
workspace artifacts.

After dependency or schema changes, run `mise install`, root
`bun install --frozen-lockfile`, `bunx turbo run generate`, and
`bunx lefthook install`.

Recurring and scheduled work belongs in Temporal Workflows and declarative
Schedules under `packages/temporal`, never Kubernetes CronJobs, host crontabs,
or in-process timers.

## Engineering invariants

- Let broken internal contracts fail loudly. Handle expected user and external
  boundary errors with typed, useful responses.
- Do not add fallbacks for corrupt data, unknown enums, missing assets, or
  required tools. Fix the producer or contract.
- Do not skip tests because generated output is missing; build the prerequisite.
- Fix dependency upgrades forward using the migration guide and validation
  tools. Do not revert merely to avoid the migration.
- Shared cross-language data uses a language-neutral source of truth plus
  per-language validation.
- After roughly two failed attempts at the same workaround, step back and
  reconsider the design instead of layering more exceptions.
- Never add a fixed waiting, soak, or bake period to a rollout, migration, or
  cleanup. Gate on evidence such as replay, canaries, drainage, and live checks,
  and proceed as soon as it passes.

Every newly added or rewritten URL must return HTTP 200 before commit.

## Configuration and secrets

For first-party applications, environment variables are for credentials and
bootstrap only. Product and operational behavior uses the typed configuration
and feature-flag packages. Load the `feature-flags` skill before changing that
boundary. For a working feature, its feature flag on in the intended live Flags
deployment is part of done unless that skill's default-off exception applies.

Never print, paste, or persist secrets; use existing 1Password-backed commands.
Toolkit resolves registered credentials automatically (`packages/toolkit/README.md`);
run it directly before fetching tokens by hand. Outside toolkit, wrap homelab-vault
`op run`/`op read` calls with `scripts/onepassword/with-service-account.sh`
(Keychain service account, no desktop approval), and start long-lived children
with `env -u OP_SERVICE_ACCOUNT_TOKEN`. On macOS, `op whoami` can be false while
Desktop-authorized reads work; probe with the exact read or `op vault list`. An
empty `cf auth list` is normal for token auth; use `cf auth whoami` or a read
call and separate authentication from authorization.

## Homelab ownership and delivery

Infrastructure source lives under `packages/homelab`. Change repo-owned IaC and
let CI and ArgoCD apply it; do not make an untracked dashboard or cluster
mutation when a declarative path exists. Load the homelab development or
operations skill before changing or operating that system.

The version catalog contains upstream and toolchain dependencies. First-party
deployment image selections, worker routing, and retained release identities
belong to Delivery PostgreSQL, never Git image defaults or commit-back queues.

Talos and Kubernetes version bumps must include the matching live cluster
upgrade. Follow `packages/homelab/AGENTS.md`; never deliver a pin-only update or
advance to another target while the previous live upgrade remains incomplete.

These are separate acceptance layers:

1. source and focused local checks;
2. exact-head Woodpecker CI;
3. built and published artifacts;
4. ArgoCD reconciliation to the intended revision;
5. observed runtime health and user-visible behavior.

State exactly which layers were verified. A green PR does not prove deployment,
and ArgoCD health does not prove the user flow.

Root ArgoCD releases and pruned syncs use the repository's `release-root`
workflow. Never infer prune candidates from `OutOfSync` alone or bypass its
exact-revision, lifecycle, immutable-field, and request-ownership checks.

## Development and verification

Read around in Tracker's Forum (`toolkit forum list --json`, `inbox`) at task
start and before shared CI, Delivery, host, or cluster actions to spot active
work or interventions that could interrupt you; for `m`+ effort work, post a
scoped `discussion` and give occasional milestone updates (`xs`/`s` work needs
none unless posting an operational `notice`; see `tracker-work-management`).
When `main`, Delivery, or another shared system is red, follow the forum —
someone may pick it up. You must pick up problems you caused, and may pick up an
unowned problem that blocks you when there is no better owner and nobody else is
working on it (claim or post a `notice` with `--owner me` first).
During implementation, run focused tasks:

```bash
bunx turbo run build typecheck test lint --filter=<package>
bunx lefthook run pre-commit # includes jscpd (standalone: bun run jscpd)
```

Woodpecker runs the `ci` test tier exhaustively and is the CI source of truth.
Use `toolkit ci wait <PR>` for merge readiness, `toolkit ci explain <PR>` for
blockers, and `toolkit ci load` for capacity. Use `toolkit woodpecker` for
native CI operations and `toolkit pr health` for a one-shot combined report.
Run `bun run verify` locally only when reproducing CI or changing verification
machinery.

Steps marked `tier: "extended"` in a workspace's `ci-tests.json` (suites that
start PostgreSQL, the Temporal test server, ffmpeg or a game server, or exceed
a three-minute p50) do not run on pull requests. Before marking a PR ready, run
`bun run verify:extended -- --filter='...[origin/main...HEAD]'` (or
`bunx turbo run test:extended --filter='...[origin/main...HEAD]' --continue`)
and record the command and result in the PR body's Verification. The nightly
`ci-extended-verify` run on main is the safety net, not a substitute.

Verify claims from the live tree before reporting them. Preserve unrelated
worktree changes. Do not call an issue "pre-existing" when the task explicitly
requires complete quality.

When a change alters an architecture boundary, operator workflow, or system
rationale, update the relevant README or wiki page in the same change. Do not
write a session journal.

## Git and pull requests

Feature work uses `toolkit git-spice`. Every stack, including a single PR, is a
git-spice stack. Load `monorepo-delivery` before branch, stack, PR, or CI work.
Never hand-roll a rebase, use `gh pr create` or `gh stack` / `github/gh-stack`,
or set PR bases into a chain. git-spice may register its stacks with GitHub.

The primary commit includes `Why`, `What`, and `Verification` (including live
checks not run); the PR body adds `Demo` from the complete branch diff so a
reviewer immediately sees what changed. Stage explicit paths only.

Upload PR media with `toolkit pr asset [PR] <file|dir...> --markdown` (GitHub
cannot reach the tailnet; the `artifacts` skill shows Jerred work for feedback):
**before and after** for UI, sites, docs, and reports (screenshots, recordings,
`.html` previews), an asciinema `.cast` for CLI/TUI, and concrete output for
backend/data/infra (payload, plan, or SQL diff, `duckdb -markdown` table, `uplot`
chart, or `mermaid` diagram) — only mechanical chores write `None — <reason>`.

Automated review focuses on P0-P2 correctness, architecture, process, and secret
hygiene. Mechanical formatting and type errors are covered elsewhere. Before
pushing a review fix, inspect and resolve the provider finding so the required
review gate observes both the code and thread state.

## Task-specific guidance

Use the matching repository skill in `.agents/skills/` for repeatable delivery,
homelab, Delivery recovery, Scout, Temporal, TaskNotes, Minecraft harness and
building, docs, Tracker, PostHog, Discord, or report rendering work. Package-local runtime
skills remain application assets and do not replace repository workflow
guidance.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

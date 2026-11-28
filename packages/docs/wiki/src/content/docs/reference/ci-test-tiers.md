---
title: CI test tier reference
description: The rule that places a test step in the ci or extended tier, each workspace's classification, the commands that run each tier, and the nightly schedule.
sidebar:
  order: 9
---

Every step in a workspace's `ci-tests.json` belongs to one tier. The schema is
`scripts/ci-tests.schema.json`; `scripts/ci/run-ci-test.ts --tier` selects the
steps. [How CI selects work](/explanation/ci-pipeline-shape/#two-test-tiers)
explains why the tiers exist.

## The rule

| Tier       | Applies to                                                                                                                                                                                                                                                                                              | Runs                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ci`       | Every step without a `tier` field. The default.                                                                                                                                                                                                                                                         | Woodpecker `verify` on every pull request and main push, through `test:ci`                      |
| `extended` | A step that starts or requires a process other than the test runner — a database server (`initdb`, `pg_ctl`, the shared dev PostgreSQL), the Temporal time-skipping test server, a browser, a game server, a container service, ffmpeg/ffprobe/node-av — or whose uncached CI p50 exceeds three minutes | Locally before a PR is marked ready and nightly on main, through `test:extended`; never on a PR |
| `shared`   | A `command` prerequisite both tiers need (a generated-file stub, a codegen run). Only `runner: "command"` may use it.                                                                                                                                                                                   | In whichever tier is requested                                                                  |

Spawning a CLI that reads files and exits (`helm template`, `tofu validate`) or
an in-process `Bun.serve` does not make a step `extended`. `excludedSuites`
entries run in neither tier.

Vitest workspaces split by file name: the `ci` step adds
`--exclude "**/*.integration.test.ts"` and the `extended` step selects the
positional substring `.integration.test.ts`. The standardization check accepts
a test file when any step in either tier selects it.

## Workspaces with extended steps

| Workspace                              | `ci` steps                                              | `extended` steps                  | Runtime the extended steps start                          |
| -------------------------------------- | ------------------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `@shepherdjerred/media`                | Vitest `src`, no integration files                      | `integration`                     | Private PostgreSQL per file; ffmpeg                       |
| `@shepherdjerred/temporal`             | `ha-schema` (shared); Bun Vitest, no integration files  | `integration`; `workflows` (Node) | Delivery PostgreSQL; media fixtures; Temporal test server |
| `@scout-for-lol/backend`               | Vitest, no integration files                            | `integration`                     | Shared dev PostgreSQL (`createTestDatabase`)              |
| `@scout-for-lol/temporal`              | Vitest `src`, no `src/workflows`                        | `workflows` (Node)                | Temporal test server                                      |
| `@shepherdjerred/delivery`             | `generate` (shared); Vitest `src`, no integration files | `integration`                     | `delivery-pg-*` PostgreSQL per process                    |
| `@shepherdjerred/discord-video-stream` | Vitest, no integration files                            | `integration`                     | ffmpeg, node-av, a real player                            |

"Integration files" are `**/*.integration.test.ts`; each `integration` step
selects exactly those under the workspace's Vitest root.
`bunx turbo run test:extended --filter=<workspace>` runs one workspace's
extended steps. Every other workspace has only `ci` steps. The Storm's Paper,
load and native client suites are `excludedSuites`, outside both tiers.

## Commands

| Command                                                                      | Scope                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun run verify:extended -- --filter='...[origin/main...HEAD]'`              | Extended steps of the workspaces a branch changed and their dependents (bounded)   |
| `bunx turbo run test:extended --filter='...[origin/main...HEAD]' --continue` | Same affected selection directly through Turbo                                     |
| `bun run verify:extended -- --filter=<package>`                              | One workspace under `verify:extended`'s serial concurrency and 2-worker Vitest cap |
| `bun run verify:extended`                                                    | Every extended step, uncached; what the nightly runs                               |
| `bun run e2e:affected`                                                       | The Playwright projects a branch affects since its merge base with `origin/main`   |
| `bun <rel>/scripts/ci/run-ci-test.ts --tier extended [--group <g>]`          | The `test:extended[:<group>]` package script; fails when the tier has no steps     |

`test:extended` is `cache: false` in the root `turbo.json`: the run exists to
execute suites against servers Turbo cannot hash.

## Browser and Paper smoke lanes

Two Woodpecker lanes are outside the ordinary pull-request graph. They are not
test tiers (the `ci` and `extended` steps above are Turbo tasks); each is its
own workflow.

| Lane                                | Pull request                            | Main push | Nightly | Local command                                 |
| ----------------------------------- | --------------------------------------- | --------- | ------- | --------------------------------------------- |
| `playwright-e2e` (browser E2E)      | Only when `ci/ci-playwright/**` changes | Yes       | No      | `bun run e2e:affected`                        |
| `paper-smoke-nightly` (Paper smoke) | No                                      | No        | Yes     | `bun run --cwd packages/the-storm test:smoke` |

The browser lane's pull-request exception is the `ci-playwright` image
promotion: every promotion rewrites `ci/ci-playwright/DIGEST` and `STATE.json`,
so the candidate digest runs the browser suites before the promotion
auto-merges. A change to `bun.lock` or a root `package.json` does not select it.
The lane stays on main because `sites` ships the `sjer-red-dist` and
`wiki-dist` bundles it publishes.

`bun run e2e:affected` is `scripts/e2e-affected.ts`. It wraps
`ci/scripts/selection/run-playwright.ts`, the selector and runner the main lane
executes, with `CI=true` and `CI_CHANGED_BASE` set to
`git merge-base HEAD origin/main`.

| Option         | Effect                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none           | Builds and runs the Playwright projects the committed diff reaches; writes `playwright-selection-report.json` and `.ci-reports/`                                                             |
| `--base <ref>` | Compares against `<ref>` instead of `origin/main`                                                                                                                                            |
| `--all`        | Runs every project                                                                                                                                                                           |
| `--linux`      | Runs the same selection in the pinned `ci-playwright` image (digest from `ci/ci-playwright/DIGEST`, run as `linux/amd64`, emulated on Apple silicon) with Docker, on a clean clone of `HEAD` |

It refuses to run when `git status --porcelain` is not empty (except `--all`
without `--linux`), because selection reads committed changes while Turbo tests
the working tree, and it fails when the merge base cannot be found. Visual
snapshots are per platform: `packages/sjer.red` keeps `*-darwin.png` and
`*-linux.png` baselines, CI checks the Linux ones, and a non-Linux run prints a
warning naming `--linux` when a selected project owns such snapshots. A host
run needs browsers from `bunx playwright install`; `--linux` needs a reachable
Docker daemon and fails otherwise. When to run it is in the
[delivery skill](https://github.com/shepherdjerred/monorepo/blob/main/.agents/skills/monorepo-delivery/SKILL.md).

## Nightly schedule

| Field               | Value                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule            | `ci-extended-verify-nightly`                                                                                                                                          |
| Workflow            | `runCiExtendedVerifyWorkflow`                                                                                                                                         |
| Cron                | `0 2 * * *` `America/Los_Angeles`                                                                                                                                     |
| Overlap             | `SKIP`; four-hour execution timeout                                                                                                                                   |
| Pipeline            | Manual Woodpecker pipeline on the newest verified main, a `verify-extended` workflow and a `paper-smoke-nightly` workflow, `pr` pool at the lowest admission priority |
| Flags (default off) | `ci-extended-verify-dispatch-enabled` (Temporal), `woodpecker-extended-verify-enabled` (extension)                                                                    |
| On red              | The Workflow fails; `temporal-failure-watch` raises the alert                                                                                                         |

The pipeline is green only when both workflows pass. The run is not a main verdict. See the
[workflow inventory](/reference/temporal-workflows/) and
[schedule mechanics](/reference/temporal-schedules/).

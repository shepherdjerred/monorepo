# CI cold-path hardening — follow-ups from the 2026-07-04 remediation

## Status

Not Started

## Context

The 2026-07-03 Dagger cache wipe exposed ~8 latent bugs at once (full story:
[`../logs/2026-07-04_ci-eexist-isolated-linker.md`](../logs/2026-07-04_ci-eexist-isolated-linker.md)).
The common thread: **warm layer cache had become load-bearing for
correctness** — installs, postinstalls, image steps, and deploy paths hadn't
actually executed in months, so bugs accumulated invisibly and then presented
simultaneously, each costing a 15-45 min CI cycle to isolate. This plan turns
that night's pain into structural fixes.

## Work items

| #   | Item                                           | Value | Effort | Notes                                           |
| --- | ---------------------------------------------- | ----- | ------ | ----------------------------------------------- |
| 1   | Weekly cold-cache canary build                 | High  | Med    | The structural fix; catches latent debt         |
| 2   | `AWS_EC2_METADATA_DISABLED` in CI containers   | High  | Low    | IMDS hang class, repo-wide                      |
| 3   | Timeouts on per-package Build + Smoke steps    | High  | Low    | They currently have **none**                    |
| 4   | ArgoCD sync isolation for the dagger engine    | High  | Low    | Sync restarted the engine mid-build             |
| 5   | setup.ts ordering: shared builds before copies | Med   | Low    | Fresh-worktree scout failure, hit 3× that night |
| 6   | temporal-worker smoke test                     | Med   | Med    | Build-only today → blind runtime changes        |
| 7   | Vendored/cached node-datachannel prebuild      | Med   | Med    | 13-min silent source build per cold image       |
| 8   | No-wall-clock-assertions test convention       | Low   | Low    | Two tests fixed that night, same pattern        |

### 1. Weekly cold-cache canary build

Every latent bug from 2026-07-04 (isolated-linker EEXIST, IMDS hang, 30-min
chown, cold-build-vs-timeout math) would have surfaced months earlier, one at
a time, under calm conditions.

- **Design**: a scheduled Buildkite build (Buildkite cron on `main`, weekly,
  off-hours) that runs the standard pipeline against a **fresh ephemeral
  Dagger engine** (engine-as-a-service container inside the job, cold by
  construction) rather than pruning the shared engine — pruning would make
  the next real builds cold too.
- Report-only: soft-fail the build's steps or route to email/PagerDuty
  low-urgency; a red canary must not block PRs.
- Wire via `scripts/ci/src/main.ts` (env flag, e.g. `COLD_CANARY=1`, selects
  an ephemeral-engine `DAGGER_*` config instead of
  `tcp://dagger-engine.dagger.svc.cluster.local:8080`).
- Success criteria: canary red = a cold-path regression email with the failing
  step, before any real wipe finds it.

### 2. `AWS_EC2_METADATA_DISABLED=true` in CI containers

The scout chart-render hang (`runReport` → bare `S3Client` → IMDS probe at
169.254.169.254 blackholes; bun doesn't enforce the probe timeout) is a
_class_: any AWS SDK usage in any package's tests can hang CI when no ambient
config exists. PR #1401 fixed scout's `test-setup.ts` only.

- Set `AWS_EC2_METADATA_DISABLED=true` via `withEnvVariable` in the shared bun
  container builders: `bunBaseContainer` (`.dagger/src/base.ts`) and the image
  helpers in `.dagger/src/image.ts` (there is no IMDS anywhere in this infra).
- Keep scout's `test-setup.ts` line so local `bun test` on config-less
  machines stays deterministic too.
- Optional second layer: request/connection timeouts (as added to scout's
  `s3-client.ts`) for other S3 client construction sites — `rg "new S3Client"`.

### 3. Timeouts on per-package Build + Smoke steps

`:package::heartbeat: Build + Smoke *` steps have `timeout_in_minutes: null`
(verified on build 5030 — a job "ran" 45 min with a wedged log and nothing
would ever have killed it). Docker image steps got 45 min in PR #1400; the
per-package steps in `scripts/ci/src/steps/per-package.ts` got nothing.

- Add `timeout_in_minutes: 45` (match `images.ts`, which documents the cold
  measurements: 32-45 min).
- Audit every step builder under `scripts/ci/src/steps/` for missing
  timeouts while there.

### 4. ArgoCD sync isolation for the Dagger engine

Main build 5039's deploy wave ran the first sync in two days; it reconciled
the outage-drifted dagger chart and **restarted the engine under the running
build** (`error committing …: database not open` killed three jobs).

- Options, cheapest first:
  - `syncWindows` on the `dagger` Application (sync only in a quiet window,
    e.g. 05:00), or
  - manual `syncPolicy` for the dagger app + a runbook line (the engine
    changes rarely; its restarts are already runbook-managed), or
  - keep auto-sync but order it: make the argo-sync step for the dagger app
    depend on the build's image jobs completing.
- File: `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`.

### 5. setup.ts ordering: shared builds before file:-dep copies

Fresh-worktree `bun run scripts/setup.ts` fails in scout `generate`:
per-package `bun install` (phase 2) copies `file:` deps **before** phase 3
builds their `dist/` (e.g. `@shepherdjerred/llm-models`), so the copy lacks
the built entrypoint. Hit three times on 2026-07-04; the workaround is a
manual re-`bun install` at the consumer root after shared builds.

- Fix: in `scripts/setup.ts`, either run Shared Builds before per-package
  installs, or add a re-copy pass (re-run `bun install` in consumers of
  built `file:` deps) after phase 3.
- Success criteria: `git worktree add … && bun run scripts/setup.ts` green on
  the first run.

### 6. temporal-worker smoke test

temporal-worker's CI step is build-only, so runtime changes (like the
chown → `BUN_INSTALL_CACHE_DIR` swap) ship blind and get verified by watching
the prod pod. Every other bun image has a Build + Smoke step.

- Add a smoke: boot `bun run src/worker.ts` with a fake/absent Temporal
  address and assert it reaches its "connecting" log line (the startup path is
  what historically broke: bun cache EACCES at import-graph load).
- Wire like the other smoke tests in `.dagger/src/image.ts` + catalog entry.

### 7. Vendored/cached node-datachannel prebuild

Every cold dpp/dpmk image build stalls ~13 min in silence: `@lng2004/node-datachannel`'s
`prebuild-install` fails to download in this environment and falls back to a
single-threaded cmake source build (documented in `.dagger/src/base.ts`; the
`extracted [184]` stall).

- Options: mirror the prebuild artifact (SeaweedFS bucket +
  `npm_config_*`/`prebuild-install` mirror env), or bake it into a base layer
  keyed on the dep version, or a Dagger cache volume for the built `.node`.
- Success criteria: cold dpp image build loses the ~13-min silent phase.

### 8. No-wall-clock-assertions test convention

birmel's backoff test and scout's chart-render test both flaked on wall-clock
assumptions; both had neighbors already using the right patterns (injected
`sleep`, injected clock).

- Document the pattern in `packages/docs/patterns/` (assert _requested_
  delays via injected sleep; never compare measured `Date.now()` gaps).
- Optional: a `custom-rules/` ESLint rule flagging `Date.now()` deltas inside
  `test()` bodies — only if it can be done without false-positive noise.

## Related, already tracked

- [`../todos/bun-isolated-linker-eexist.md`](../todos/bun-isolated-linker-eexist.md) —
  un-pin the hoisted linker when oven-sh/bun#12917 / #20142 are fixed (move
  scout's phantom `@shepherdjerred/llm-models` dep into `packages/data` first).

## Non-goals

- Re-litigating the hoisted-linker pins or the `.astro` typed-lint disable —
  both are documented decisions in the remediation log with their own exit
  criteria.
- General CI speed work beyond the items above; warm-path performance was and
  is fine.

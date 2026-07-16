# Mac Mini → Buildkite CI agent

## Status

In Progress

## Goal

Bring a fresh-macOS Mac Mini online as a Buildkite agent on a new `macos` queue,
so native Swift/Xcode builds (starting with SwiftLint over
`tasks-for-obsidian/ios`) have an execution surface. All CI today is
Linux/Dagger in-cluster; there is no macOS runner.

## Decisions

| Question               | Decision                                                           | Why                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Provision the Mac how? | **Thin bootstrap script** (`packages/homelab/mac-ci/bootstrap.sh`) | User rejected chezmoi (personal-workstation layer) and Ansible/Nix (dead/absent). Headless appliance = one idempotent script. |
| Agent daemon           | `brew services` LaunchAgent + auto-login                           | User context keeps keychain/Xcode working for future signing; no custom plist.                                                |
| Token                  | Reuse existing per-cluster agent token from 1Password              | Token is per-cluster, not per-queue — the in-cluster token registers macOS agents too.                                        |
| Job execution          | Plain command step, **no k8s/Dagger plugin**                       | macOS has no in-cluster Dagger engine; step uses the agent's native git checkout.                                             |
| First job              | Native SwiftLint on `tasks-for-obsidian/ios`                       | Revives the dead `swiftLint` helper; gives the agent a real job to validate e2e.                                              |
| Safety                 | Dormant behind `MACOS_CI_ENABLED` (default off)                    | Mirrors `PR_BABYSIT_ENABLED`. Prevents `tasks-for-obsidian` PRs hanging on a not-yet-online macOS agent.                      |
| Checkout auth          | None needed                                                        | Pipeline repo is public HTTPS (`github.com/shepherdjerred/monorepo.git`).                                                     |

## Changes in this PR

| #   | Change                                                                                   | File                                             |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | `agents?: { queue }` field on `BuildkiteStep`                                            | `scripts/ci/src/lib/types.ts`                    |
| 2   | `macosSwiftLintStep()` — gated on `MACOS_CI_ENABLED`, routed to `queue=macos`, no plugin | `scripts/ci/src/steps/per-package.ts`            |
| 3   | `buildkite_cluster_queue "macos"`                                                        | `packages/homelab/src/tofu/buildkite/cluster.tf` |
| 4   | Bootstrap script (Homebrew, agent cfg, service)                                          | `packages/homelab/mac-ci/bootstrap.sh`           |
| 5   | Runbook (setup, tailnet, auto-login, activation, security)                               | `packages/homelab/mac-ci/README.md`              |

## Operator steps (post-merge, on the Mac)

1. `tofu -chdir=buildkite apply` — create the `macos` queue.
2. `BUILDKITE_AGENT_TOKEN=… ./bootstrap.sh` on the Mac.
3. `sudo tailscale up`; enable auto-login.
4. Confirm agent connected in Buildkite UI.
5. Flip `MACOS_CI_ENABLED=true` → first SwiftLint build lands on the Mac.

## Caveats / follow-ups

- No `.swiftlint.yml` in `ios/` yet → `--strict` may fail on first real run;
  add a config or start the step `soft_fail: true`.
- Native execution ≠ ephemeral-pod isolation. `git-clean-flags="-ffxdq"`
  scrubs between builds; layer **Tart** later if per-job VM isolation matters.
- Don't add `buildkite/monorepo/pr/swiftlint-tasks-for-obsidian` to
  `src/tofu/github/rulesets.tf` (required checks) until the step is enabled and
  green, or it blocks all PRs.

## Session Log — 2026-07-03

### Done

- Added `agents?: { queue }` to `BuildkiteStep` (`scripts/ci/src/lib/types.ts`).
- Added dormant `macosSwiftLintStep()` gated on `MACOS_CI_ENABLED`, routed to
  `queue=macos` with no k8s plugin (`scripts/ci/src/steps/per-package.ts`).
- Added `buildkite_cluster_queue "macos"`
  (`packages/homelab/src/tofu/buildkite/cluster.tf`).
- Wrote `packages/homelab/mac-ci/bootstrap.sh` (thin idempotent provisioner)
  and `README.md` runbook.
- Verified: `tsc --noEmit` clean, 304 CI tests pass, shellcheck clean,
  `tofu validate` clean, dagger-hygiene + check-todos + prettier clean.
  Confirmed the step is omitted when `MACOS_CI_ENABLED` is unset and emitted
  (with `agents.queue=macos`, no plugin) when `=true`.

### Remaining

- Operator: `tofu apply` the queue; run `bootstrap.sh` on the Mac with the
  1Password token; `tailscale up`; enable auto-login; flip `MACOS_CI_ENABLED=true`.
- Open the PR (not yet committed/pushed).

### Caveats

- No `.swiftlint.yml` in `ios/` — first real `--strict` run may fail; add a
  config or start `soft_fail: true`.
- Native execution has no ephemeral-pod isolation; Tart is the later upgrade.

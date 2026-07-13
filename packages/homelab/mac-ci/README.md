# mac-ci — Mac Mini Buildkite agent

Provisions a Mac Mini as a Buildkite CI agent on the **`macos`** queue, for
native Swift/Xcode builds that couldn't run in the Linux in-cluster path.

> **2026-07:** the monorepo's CI pipeline (Dagger + Buildkite) was removed, so
> nothing dispatches jobs to this agent; this setup is dormant pending the
> Buildkite service teardown.

This is a **thin, headless-appliance** setup — deliberately separate from the
personal chezmoi dotfiles layer (`packages/dotfiles/`, which is for
workstations). Provisioning is a single idempotent shell script plus a few
documented manual steps; there's no Ansible/Nix/chezmoi involved.

## Why this exists

CI ran in-cluster via `agent-stack-k8s` on the Talos node (`torvalds`) — all
Linux. There was no macOS execution surface. Swift builds need real macOS.
The Mac Mini was that surface.

## What runs where

| Layer         | Mechanism                              | Notes                                                                      |
| ------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Host packages | `bootstrap.sh` → Homebrew              | `buildkite-agent`, `swiftlint`, `tailscale`                                |
| Agent daemon  | `brew services` (LaunchAgent)          | user context (keychain/Xcode-friendly); needs auto-login for headless boot |
| Queue         | Tofu `buildkite_cluster_queue "macos"` | `src/tofu/buildkite/cluster.tf`                                            |
| Job routing   | per-step `agents.queue = "macos"`      | `scripts/ci/src/steps/per-package.ts`                                      |
| Activation    | `MACOS_CI_ENABLED=true`                | env at pipeline-upload time; default off                                   |

## First-time setup

1. **Apply the Tofu queue** (creates the `macos` queue in the Buildkite cluster):

   ```bash
   cd packages/homelab/src/tofu
   op run --env-file=buildkite/.env -- tofu -chdir=buildkite apply
   ```

2. **Run the bootstrap on the Mac** (needs the agent token from 1Password —
   the same per-cluster token the in-cluster agents use):

   ```bash
   # On the Mac Mini, from a checkout of this repo:
   BUILDKITE_AGENT_TOKEN="$(op read 'op://<vault>/Buildkite Agent Token/<field>')" \
     ./packages/homelab/mac-ci/bootstrap.sh
   ```

   The script installs Homebrew (if missing), the packages above, writes
   `$(brew --prefix)/etc/buildkite-agent/buildkite-agent.cfg` (tagged
   `queue=macos`, `chmod 600`), and starts the agent. Re-running is safe.

3. **Join the tailnet** (manual — needs interactive auth):

   ```bash
   sudo tailscaled install-system-daemon
   sudo tailscale up
   ```

   Optionally tag the device in `src/tofu/tailscale/acl.tf`.

4. **Enable auto-login** for headless reboots: System Settings → Users &
   Groups → Automatically log in as … . The agent runs as a **LaunchAgent**
   (user session), so it only starts after login — auto-login makes that
   happen on boot without a keyboard attached.

5. **Verify the agent is connected**:
   <https://buildkite.com/organizations/sjerred/agents> — it should show up
   with the `queue=macos` tag. Locally: `brew services info buildkite-agent`.

## Activating the first job

The macOS SwiftLint step (`swiftlint-tasks-for-obsidian`) is **dormant by
default** — the pipeline generator only emits it when `MACOS_CI_ENABLED=true`.
This keeps `tasks-for-obsidian` PRs from hanging on a macOS agent before one
exists.

Once the agent above shows connected, set `MACOS_CI_ENABLED=true` in the
pipeline-upload environment (Buildkite pipeline env var, or the bootstrap
`.buildkite/pipeline.yml` env). The next `tasks-for-obsidian` change will route
a `:swift: SwiftLint (macOS)` step to the Mac.

> **Note:** there's no `.swiftlint.yml` in `packages/tasks-for-obsidian/ios`
> yet, so the step runs `swiftlint --strict` with defaults — expect to either
> add a config or fix violations on the first real run. Consider starting with
> `soft_fail: true` on the step while shaking it out.

## Security posture

Unlike the in-cluster agents (ephemeral pods), macOS jobs run **natively** on a
persistent host as your user — untrusted PR code touches the real filesystem.
`git-clean-flags="-ffxdq"` scrubs the working tree between builds, but there's
no container isolation. If that matters, layer **Tart** (ephemeral macOS VMs
per job) on top later — orthogonal to this setup.

## Teardown

```bash
brew services stop buildkite/buildkite/buildkite-agent
brew uninstall buildkite/buildkite/buildkite-agent
# Then set MACOS_CI_ENABLED back to unset/false and `tofu apply` to drop the queue.
```

# mac-ci — Mac Mini Buildkite agent

Provisions a Mac Mini as a Buildkite CI agent on the **`macos`** queue, for
native Swift/Xcode builds that cannot run in the Linux in-cluster path.

> **Status: dormant.** The monorepo's CI pipeline is live — the static
> [`.buildkite/pipeline.yml`](../../../.buildkite/pipeline.yml) runs every PR
> and main build on the Linux in-cluster (`agent-stack-k8s`) queue — but no
> macOS agent is registered and the pipeline has no macOS-queue steps. The
> `macos` cluster queue still exists in Tofu
> (`src/tofu/buildkite/cluster.tf`). macOS-only suites (e.g.
> `packages/macos-ai-subscription-tracker`'s `verify:macos`) therefore remain
> local-only developer/release gates. Reactivation is tracked in
> [`packages/docs/todos/mac-mini-buildkite-agent.md`](../../docs/todos/mac-mini-buildkite-agent.md).

This is a **thin, headless-appliance** setup — deliberately separate from the
personal chezmoi dotfiles layer (`packages/dotfiles/`, which is for
workstations). Provisioning is a single idempotent shell script plus a few
documented manual steps; there's no Ansible/Nix/chezmoi involved.

## Why this exists

CI runs in-cluster via `agent-stack-k8s` on the Talos nodes — all Linux. There
is no macOS execution surface. Swift builds need real macOS. The Mac Mini is
that surface.

## What runs where

| Layer         | Mechanism                              | Notes                                                                      |
| ------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Host packages | `bootstrap.sh` → Homebrew              | `buildkite-agent`, `swiftlint`, `tailscale`                                |
| Agent daemon  | `brew services` (LaunchAgent)          | user context (keychain/Xcode-friendly); needs auto-login for headless boot |
| Queue         | Tofu `buildkite_cluster_queue "macos"` | `src/tofu/buildkite/cluster.tf`                                            |
| Job routing   | per-step `agents.queue = "macos"`      | steps added directly to the static `.buildkite/pipeline.yml`               |

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

5. **Verify the agent is connected**: on the Buildkite agents page for the
   `sjerred` organization (requires login) it should show up with the
   `queue=macos` tag. Locally: `brew services info buildkite-agent`.

## Activating the first job

The pipeline is the committed static `.buildkite/pipeline.yml` — there is no
generator or activation env var. Once the agent shows connected, add a step
with `agents: { queue: "macos" }` to the pipeline (candidates: the
`verify:macos` suite for `packages/macos-ai-subscription-tracker`, the
`tasks-for-obsidian` Maestro e2e suite, and the tasknotes-server differential
test — see the TODO doc). Do not add a macOS-queue step before an agent is
online, or every PR touching those packages will hang waiting for it.

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
# Then `tofu apply` after removing the queue from cluster.tf to drop it.
```

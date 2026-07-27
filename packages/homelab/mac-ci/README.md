# mac-ci — Mac Mini Buildkite agent

Provisions a Mac Mini as a Buildkite CI agent on the **`macos`** queue, for
native Swift/Xcode builds that couldn't run in the Linux in-cluster path.

> **Status (2026-07-25):** the `macos` queue exists (Tofu-applied 2026-07-06)
> and dispatch is unpaused, but **no macOS agent is currently connected**
> (`bk agent list` only reports currently-connected agents, so this doesn't
> establish whether the Mini has ever registered before) — run `bootstrap.sh`
> on the Mini to register/re-register one. CI was replatformed from the old
> Dagger + dynamic-generator setup to a **static `.buildkite/pipeline.yml`**;
> that migration dropped the per-package macOS SwiftLint step (it lived in the
> now-deleted `scripts/ci/src/`), so no job routes to this queue **yet** —
> re-adding a `agents: { queue: macos }` step to the static pipeline is the
> outstanding follow-up (see "Activating the first job"). Bringing the agent
> online is independent of that and worth doing first.

This is a **thin, headless-appliance** setup — deliberately separate from the
personal chezmoi dotfiles layer (`packages/dotfiles/`, which is for
workstations). Provisioning is a single idempotent shell script plus a few
documented manual steps; there's no Ansible/Nix/chezmoi involved.

## Why this exists

CI ran in-cluster via `agent-stack-k8s` on the Talos node (`torvalds`) — all
Linux. There was no macOS execution surface. Swift builds need real macOS.
The Mac Mini was that surface.

## What runs where

| Layer         | Mechanism                              | Notes                                                                                                   |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Host packages | `bootstrap.sh` → Homebrew              | `buildkite-agent`, `swiftlint`, `tailscale`                                                             |
| Power         | `bootstrap.sh` → `pmset`               | never sleep (`sleep 0`, `powernap 0`, `womp 1`, `autorestart 1`) — a sleeping agent drops off Buildkite |
| Agent daemon  | `brew services` (LaunchAgent)          | user context (keychain/Xcode-friendly); needs auto-login for headless boot                              |
| Queue         | Tofu `buildkite_cluster_queue "macos"` | `src/tofu/buildkite/cluster.tf` (applied)                                                               |
| Job routing   | per-step `agents: { queue: macos }`    | to be added to `.buildkite/pipeline.yml` (static; the old generator is gone)                            |

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
   `queue=macos`, `chmod 600`), saves the existing power profile to
   `/var/db/buildkite-mac-ci-pmset-before`, applies the **never-sleep `pmset`
   profile** (prompts for sudo), and starts the agent. Re-running is safe and
   preserves the first saved profile.

   The `pmset` step is what keeps a Mac Mini from dropping off Buildkite: a
   sleeping host disconnects its agent and hangs any dispatched job. It forces
   `sleep 0` / `disksleep 0` / `powernap 0` / `womp 1` / `autorestart 1`.
   Verify afterward with `pmset -g custom` (look for `sleep 0`).

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

**No macOS step exists in CI right now.** The original SwiftLint step and its
`MACOS_CI_ENABLED` gate lived in the dynamic pipeline generator
(`scripts/ci/src/steps/per-package.ts`), which was deleted when CI was
replatformed to the static `.buildkite/pipeline.yml`. Nothing dispatches to the
`macos` queue until a step is re-added there.

To wire it up (do this **after** the agent shows connected, so PRs never hang on
a missing agent):

1. Add a step to `.buildkite/pipeline.yml` with `agents: { queue: "macos" }`,
   `soft_fail: true`, an `if:` gating it to PR builds, and an
   `if_changed.include` list scoped to `packages/tasks-for-obsidian/**` — not
   just `.../ios/**`, since the `lint:swift` task it runs is defined in
   `packages/tasks-for-obsidian/package.json` and configured in
   `packages/tasks-for-obsidian/turbo.json`, both outside `ios/`, and a
   future `.swiftlint.yml` would likely sit at the package root too. Path
   filters are `if_changed:`, not `if:` (`if:` only evaluates boolean
   build/pipeline expressions and can't match a changed-file glob; see the
   neighboring `playwright-e2e-pr` step for the `if:` + `if_changed:` pattern
   to copy). Include the same global CI/toolchain closure that step's
   `if_changed.include` carries (`.buildkite/**`, `.mise.toml`, `bun.lock`,
   `bunfig.toml`, `package.json`, `patches/**`, `turbo.json`) alongside the
   package path, so a change to the macOS step itself or the shared toolchain
   still runs it. `bootstrap.sh` installs `swiftlint` but not `bun`, so this
   step can't invoke the `lint:swift` package script directly — run
   `swiftlint`'s own command scoped to the package directory instead:
   `cd packages/tasks-for-obsidian &&
swiftlint lint --strict --quiet ios/TasksForObsidian ios/TasksWidget` — or
   the iOS build / Maestro suite, which likely does need `bun`/Xcode
   provisioned (add those to `bootstrap.sh` if so) — as the command. Not a
   bare `swiftlint --strict` from the repo root: that has no input paths and
   would also lint the 155 unrelated Swift files under `sandbox/archive`. It
   executes on the agent's native checkout, **not** via the kubernetes
   plugin the Linux steps use.
2. Leave it `soft_fail: true` until it's green, then drop `soft_fail`. Do
   **not** add a macOS-specific required status check — the replatformed
   pipeline posts only a single aggregate `buildkite/monorepo/pr` commit
   status per PR build; the old per-step `buildkite/monorepo/pr/<step>`
   contexts are gone (`src/tofu/github/rulesets.tf` requires only the
   aggregate). Once `soft_fail` is removed, a red macOS step already fails
   that existing aggregate check — adding a new required context that no
   build will ever produce would block every PR forever.

> **Note:** there's no `.swiftlint.yml` in `packages/tasks-for-obsidian/ios`
> yet, so `swiftlint --strict` runs with defaults — expect to either add a
> config or fix violations on the first real run. `soft_fail: true` keeps the
> build green while that's shaken out.

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
# Restore the exact pre-bootstrap values for every setting bootstrap.sh
# changed: sleep, disksleep, displaysleep, powernap, womp, and autorestart.
# This intentionally fails if the saved profile is unavailable rather than
# guessing stock defaults for a host that might have been customized.
./packages/homelab/mac-ci/restore-power.sh
# Then remove any macos-queue step from .buildkite/pipeline.yml and, if the
# queue is no longer wanted, delete the resource in src/tofu/buildkite and apply.
```

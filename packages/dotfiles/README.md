# dotfiles

Chezmoi source tree for dotfiles, shell configuration, macOS defaults, and
machine bootstrap (`install.sh`, `install_macos.sh`), plus a small Bun scripts
package (`bun run test` covers `scripts/`). Preview and apply intentional source
changes to exact live targets, then verify a clean targeted diff. See the
[chezmoi constraints](AGENTS.md#chezmoi) in [AGENTS.md](AGENTS.md).

For macOS open-file exhaustion, follow [How to persist higher file limits](macos-file-limits/README.md).

The Windows PC uses a separate source, [dotfiles-windows](../dotfiles-windows/).

## Codex appearance changes

A running Codex keeps the terminal palette it saw at startup
([openai/codex#45163](https://github.com/openai/codex/issues/45163)), so the
macOS `dark-notify` LaunchAgent calls `sync-theme.sh`, which starts an
independent `restart-codex-panes` worker. The first run records the current
appearance; subsequent light/dark transitions immediately restart identifiable
Codex terminals on the local [Herdr](https://herdr.dev) core, through `hc`.
Repeated notifications in the same mode do not restart terminals. Remote
machines are outside this automation.

Preview eligible terminals without changing any with
`~/bin/restart-codex-panes --dry-run`. Verify current conversation identities
with `~/bin/restart-codex-panes --probe-identities`; this submits the local
`/status` command in each idle terminal without restarting clients or starting
model turns. Manually restart with `~/bin/restart-codex-panes`. Use
`--terminal ADDRESS` (an `hc ls` address such as `t7`) to restrict a manual
run. Results append to `~/.local/state/codex-theme-restart/restart.log`; the
launcher returning success means the independent worker started, so inspect that
log for completion.

Restarts preserve the exact conversation, directory, and supported launch
options, including bypass flags. The worker types `codex resume <uuid> ...` into
the terminal's interactive shell after Codex exits, retaining the `codex` shell
wrapper. Before restarting, the worker writes `tui.theme` (Catppuccin Latte or
Mocha) and `tui.resume_cwd` through Codex's atomic settings API on the running
daemon. It does not add CLI config overrides: current Codex treats those
overrides as a request for an embedded server, which cannot reopen a thread
still held by the shared daemon. Active clients exit through "Run in
background" to keep their shared-daemon task running. If a working conversation
needs continuation after restart, it receives at most one prompt across all
views. Idle terminals receive no continuation prompt. Terminals with composer
drafts, dialogs, or uncertain input state stay running. Live subprocess state is
not restored. When a restarted client offers to resume a paused goal, the worker
selects "Leave paused" so the restart preserves the goal's state. Empty
conversations without saved history also stay running: their UUIDs cannot yet
be resumed after a client exit. The worker checks the current local Codex
`state_5.sqlite` catalog read-only before stopping a client.

Neither `hc` nor Codex reports the current conversation, and launch arguments go
stale after `/new` or `/resume`. The worker therefore reads a fresh native
`/status` card before stopping each client and again after resuming it, and
verifies the full conversation UUID. Unidentified terminals stay running and are
reported as skipped. Changed targets, unsupported launch options (including any
argument that cannot be shell-quoted safely), failed exits, and blocked startups
are reported without force-killing or blindly retrying continuation prompts.
Failed or skipped terminals require inspection and an explicit manual retry;
duplicate appearance events do not replay partial restarts.

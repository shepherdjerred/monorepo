# dotfiles

Chezmoi source tree for dotfiles, shell configuration, macOS defaults, and
machine bootstrap (`install.sh`, `install_macos.sh`), plus a small Bun scripts
package (`bun run test` covers `scripts/`). Preview and apply intentional source
changes to exact live targets, then verify a clean targeted diff. See the
[chezmoi constraints](AGENTS.md#chezmoi) in [AGENTS.md](AGENTS.md).

For macOS open-file exhaustion, follow [How to persist higher file limits](macos-file-limits/README.md).

The Windows PC uses a separate source, [dotfiles-windows](../dotfiles-windows/).

## Codex appearance changes

The macOS `dark-notify` LaunchAgent calls `sync-theme.sh`, which starts an
independent `restart-codex-panes` worker. The first run records the current
appearance; subsequent light/dark transitions immediately restart identifiable
Codex panes across running local Herdr sessions. Repeated notifications in the
same mode do not restart panes. Remote machines are outside this automation.

Preview hook metadata without changing any pane with
`~/bin/restart-codex-panes --dry-run`. Verify current conversation identities
with `~/bin/restart-codex-panes --probe-identities`; this submits the local
`/status` command and repairs Herdr metadata without restarting clients or
starting model turns. Manually restart with `~/bin/restart-codex-panes`.
Use `--session NAME` and optionally `--pane ID`
to restrict a manual run. Results append to
`~/.local/state/codex-theme-restart/restart.log`; the launcher returning success
means the independent worker started, so inspect that log for completion.

Restarts preserve the exact conversation, directory, agent name, and supported
launch options, including bypass flags. Herdr launches through the pane's
interactive shell, retaining the `codex` shell wrapper. Before restarting, the
worker writes `tui.theme` (Catppuccin Latte or Mocha) and `tui.resume_cwd` through
Codex's atomic settings API on the running daemon. It does not add CLI config
overrides: current Codex treats those overrides as a request for an embedded
server, which cannot reopen a thread still held by the shared daemon.
Active clients exit through "Run in background" to keep their shared-daemon task
running. If a working conversation needs continuation after restart, it receives
at most one prompt across all views. Idle panes receive no continuation prompt. Panes with composer
drafts, dialogs, or uncertain input state stay running. Live subprocess state is
not restored.
When a restarted client offers to resume a paused goal, the worker selects
"Leave paused" so the restart preserves the goal's state.
Empty conversations without saved history also stay running: their UUIDs
cannot yet be resumed after a client exit. The worker checks the current local
Codex `state_5.sqlite` catalog read-only before stopping a client.

The worker reads a fresh native `/status` card before stopping each client and
again after resuming it. It verifies the full conversation UUID and publishes
it to Herdr, without depending on the shared daemon's inherited pane environment
or changing the footer. Launch arguments and old status cards cannot identify
the current conversation after `/new` or `/resume`. Read-only previews cannot
repair missing hook identities; use `--probe-identities` for that check.
Unidentified panes stay running and are reported as skipped.
Changed targets, unsupported launch options, failed exits,
and blocked startups are reported without force-killing or blindly retrying
continuation prompts. Failed or skipped panes require inspection and an explicit
manual retry; duplicate appearance events do not replay partial restarts.

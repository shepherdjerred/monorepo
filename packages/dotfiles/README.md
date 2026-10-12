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

Preview with `~/bin/restart-codex-panes --dry-run`, or manually force a restart
with `~/bin/restart-codex-panes`. Use `--session NAME` and optionally `--pane ID`
to restrict a manual run. Results append to
`~/.local/state/codex-theme-restart/restart.log`; the launcher returning success
means the independent worker started, so inspect that log for completion.

Restarts preserve the exact conversation, directory, agent name, and supported
launch options, including bypass flags. Herdr launches through the pane's
interactive shell, retaining the `codex` shell wrapper. The final runtime theme
override chooses Catppuccin Latte or Mocha. Working panes receive one prompt to
continue after restart; idle and blocked panes receive no continuation prompt.
Unsaved composer drafts and live subprocess state are not restored.

The worker requires Herdr's current conversation report from its Codex
SessionStart integration. Launch arguments alone cannot identify the current
conversation after `/new` or `/resume`. Unidentified panes stay running and are
reported as skipped. Changed targets, unsupported launch options, failed exits,
and blocked startups are reported without force-killing or blindly retrying
continuation prompts. Failed or skipped panes require inspection and an explicit
manual retry; duplicate appearance events do not replay partial restarts.

# dotfiles

Chezmoi source tree for dotfiles, shell configuration, macOS defaults, and
machine bootstrap (`install.sh`, `install_macos.sh`), plus a small Bun scripts
package (`bun run test` covers `scripts/`). Preview and apply intentional source
changes to exact live targets, then verify a clean targeted diff. See the
[chezmoi constraints](AGENTS.md#chezmoi) in [AGENTS.md](AGENTS.md).

For macOS open-file exhaustion, follow [How to persist higher file limits](macos-file-limits/README.md).

The Windows PC uses a separate source, [dotfiles-windows](../dotfiles-windows/).

## Agent wrappers

`~/.local/share/agent-bin` holds one POSIX `sh` wrapper per coding-agent CLI:
`claude`, `codex`, `agy`, `cursor-agent` and its `agent` alias, `grok`, `kimi`,
and `muse`. fish, zsh (`.zshenv` and `.zlogin`), and bash (`.bash_env`) move
the directory to the front of `PATH`, so typed commands, scripts, Herdr panes
and Brim all run the same wrapper. Brim finds wrappers by that fixed path
rather than `PATH`.

Each wrapper execs `agent-exec`, which:

- removes direct provider API keys and the homelab service tokens, so agents
  always use their subscription logins;
- sets the agent git and GitHub identity (`~/.config/agent/gitconfig`,
  `~/.config/gh-agent`) and no-op editors and pagers;
- adds the agent's approval and sandbox bypass flags, unless `AGENT_SAFE=1`;
- runs the next binary of that name on `PATH` after the wrapper directory,
  passing every argument through, so `codex resume` and `claude --resume`
  work unchanged.

| Wrapper                 | Bypass flags                     |
| ----------------------- | -------------------------------- |
| `claude`, `agy`         | `--dangerously-skip-permissions` |
| `codex`                 | none; `~/.codex/config.toml`     |
| `cursor-agent`, `agent` | `--yolo --sandbox disabled`      |
| `grok`                  | `--always-approve`               |
| `kimi`                  | `--auto`                         |
| `muse`                  | `--yolo --disable-sandbox`       |

`codex` also passes the `tui.theme` for the current macOS appearance on every
launch (see below).

## Codex appearance changes

macOS switches between light and dark at local sunrise and sunset. Herdr and
the terminals recolor, but a running Codex TUI keeps the theme it launched with
([openai/codex#45163](https://github.com/openai/codex/issues/45163)) and becomes
unreadable. Until Codex follows the appearance itself, each local Codex terminal
is restarted into the same conversation with the matching theme.

The theme comes from the `codex` wrapper in `~/.local/share/agent-bin`: on
macOS every launch appends `-c tui.theme="catppuccin-latte"` or
`"catppuccin-mocha"` for the current `AppleInterfaceStyle`. The
`tui.theme = "catppuccin-latte"` in `~/.codex/config.toml` is only the default
elsewhere, and `tui.resume_cwd = "session"` is set there statically. Nothing
writes the Codex config or uses the Codex daemon socket, so this works with
the `--no-daemon` clients that Herdr requires.

The `dark-notify` LaunchAgent calls `sync-theme.sh`, which starts an independent
`restart-codex-panes --on-change` worker. The first run records the current
appearance; each later light/dark transition restarts identifiable Codex
terminals on the local [Herdr](https://herdr.dev) core through `hc`. Repeated
notifications in the same mode do not restart terminals. Remote machines are
outside this automation.

Check the result with `~/bin/restart-codex-panes --status`. It is read-only and
prints the last run, the recorded appearance against the current one, and the
theme each live local Codex terminal was launched with (`config default` when it
has no override) against the expected theme. It exits non-zero on any mismatch
or when the last run failed. Every worker run, including one that throws,
appends one JSON line (`ts`, `host`, `trigger`, `previous`, `mode`, `theme`,
`ok`, `error`, `panes`, `counts`) to
`~/.local/state/codex-theme-restart/events.jsonl`, which keeps the last 500
runs. Each run summary and each failed or skipped terminal is also mirrored to
the macOS unified log:

```bash
/usr/bin/log show --last 1d --style compact --predicate 'eventMessage CONTAINS "codex-theme-restart"'
```

Preview eligible terminals without changing any with
`~/bin/restart-codex-panes --dry-run`. Verify current conversation identities
with `~/bin/restart-codex-panes --probe-identities`; this submits the local
`/status` command in each idle terminal without restarting clients or starting
model turns. Manually restart with `~/bin/restart-codex-panes`. Use
`--terminal ADDRESS` (an `hc ls` address such as `t7`) to restrict a manual
run. The launcher returning success means only that the independent worker
started; use `--status` or `events.jsonl` for its result.

Restarts preserve the exact conversation, directory, and supported launch
options, including `--no-daemon` and bypass flags. The worker types
`codex resume <uuid> ...` into the terminal's interactive shell after Codex
exits, so `codex` resolves to the wrapper and picks the current theme. Any
launch-time `-c tui.theme=...` override is dropped so it cannot pin the stale
theme. A relaunch whose process does not carry the expected theme is reported
as failed after the conversation is restored. When a client offers "Run in
background" on exit, the worker chooses it so a running task keeps running. If a
working conversation needs continuation after restart, it receives at most one
prompt across all views. Idle terminals receive no continuation prompt.
Terminals with composer drafts, dialogs, or uncertain input state stay running.
Live subprocess state is not restored. When a restarted client offers to resume
a paused goal, the worker selects "Leave paused" so the restart preserves the
goal's state. Empty conversations without saved history also stay running:
their UUIDs cannot yet be resumed after a client exit. The worker checks the
current local Codex `state_5.sqlite` catalog read-only before stopping a client.

Neither `hc` nor Codex reports the current conversation, and launch arguments go
stale after `/new` or `/resume`. The worker therefore reads a fresh native
`/status` card before stopping each client and again after resuming it, and
verifies the full conversation UUID. Unidentified terminals stay running and are
reported as skipped. Changed targets, unsupported launch options (including any
argument that cannot be shell-quoted safely), failed exits, and blocked startups
are reported without force-killing or blindly retrying continuation prompts.
Failed or skipped terminals require inspection and an explicit manual retry;
duplicate appearance events do not replay partial restarts.

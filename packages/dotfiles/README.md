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

## New worktree dialog

The Herdr `my-worktree` mod's New dialog takes the agent's first message
instead of a branch name. Pick the agent (Brim's ranking) and, for agents that
take them, a mode, model and effort: click a chip, or step it with ⌥M, ⌥O and
⌥E. Model lists come from each CLI's own catalog and are cached; choices are
remembered per agent. Plan modes run with `AGENT_SAFE=1`, so the wrapper adds
no bypass flag that would contradict them.

Enter closes the dialog and starts `~/bin/herdr-new-worktree` detached. It
names a branch and a title with one OpenAI Responses call (`naming.js`, the
personal key read with `op read`), creates the worktree on the space's machine
through `hc exec`, and opens a space named with that title, whose agent starts
with the message. A generated branch that already exists gets a `-2` suffix. A
given `{ branch }` skips naming and runs in the dialog; that space stays
unnamed.

While a run is in progress it writes
`~/.local/state/herdr-worktree/active/<id>.json` (the step, and the title,
branch and path once known; no message text) and deletes it when the run
finishes. The sidebar shows that file as a row under the repo.

Every run appends one line to `~/.local/state/herdr-worktree/events.jsonl`
(no message text) and to the unified log; a failure also posts a macOS
notification. `~/bin/herdr-new-worktree --status` prints the last runs and
exits non-zero when the latest failed:

```bash
/usr/bin/log show --last 1d --style compact --predicate 'eventMessage CONTAINS "herdr-worktree"'
```

Windows has no Brim. When the space's machine is Windows, the dialog lists
Herdr's installed agents, unranked. The worker starts the agent through its
PowerShell profile wrapper, and through `agent-safe` for plan modes, instead of
`brim --provider`. On a Windows PC, the dialog starts `bun
~/bin/herdr-new-worktree.ts --request-env` with `Start-Process`, passing the
request in `HERDR_WORKTREE_REQUEST`. A failure there posts a Windows toast and
writes no unified log. [`../dotfiles-windows`](../dotfiles-windows/README.md)
links the script into `~/bin`.

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

## Herdr core daemon

[Herdr](https://herdr.dev)'s `hc` daemon owns every terminal and agent, and it
starts on demand. Started from a local login, it moves itself into a one-shot
launchd job and outlives whatever started it. Started from an SSH login — another
machine's `hc connect` — it runs as a child of that SSH session, and so does the
holder process that owns its terminals. Once that login ends, both are left in a
launchd Background session: agents in those terminals cannot see the login
Keychain, so Keychain-backed credentials such as the homelab 1Password service
account fail, and the terminals can die with the session. On a Mac that others
reach as a Herdr machine, that SSH client usually reconnects first after the
core goes away, so nothing else would move the core back to launchd.

On macOS the `com.jerred.herdr-core` LaunchAgent runs `~/.local/bin/herdr-core-ensure`
through a login fish shell at login and every minute:

- It starts a missing core through launchd, with an interactive login's
  environment.
- It replaces a core started from SSH with `hc server restart`. A planned
  restart keeps every running terminal in its existing holder, so a restart
  alone does not fix an SSH-born holder.
- It ends an SSH-born holder that has no terminals; the launchd core starts a
  fresh one for the next terminal.
- It never ends an SSH-born holder with live terminals, because that ends them.
  It reports that holder once, in the log and as a macOS notification. Replace
  it with `kill <holder pid>` from outside its terminals; kept terminals come
  back as shells in a new launchd holder, and agents need resuming.

The script logs only what it changes or reports, to
`~/Library/Logs/herdr-core-ensure.log`.

Check ownership with `hc server status --json`: for the core `pid` and each
`holders[].pid`, `ps -E -ww -o command= -p <pid>` must not contain
`SSH_CONNECTION=`. A launchd-owned core has parent 1 and runs as
`hc --hc-launchd …`.

## Taildrop inbox

On the workstation profile, the `com.jerred.taildrop` LaunchAgent keeps
`tailscale file get --loop --conflict=rename ~/taildrop` running, so files sent
with `tailscale file cp <file> macbook:` move straight from the Taildrop inbox
into `~/taildrop`. The open-source `tailscaled` on the MacBook otherwise holds
received files until someone runs `tailscale file get`. A same-named file gets a
numbered suffix instead of being overwritten. Agent hosts only send files, so
the LaunchAgent and the `~/taildrop` directory are not installed there.

Check the receiver with `launchctl print gui/$(id -u)/com.jerred.taildrop`.

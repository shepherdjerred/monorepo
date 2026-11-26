# dotfiles

Chezmoi source tree for dotfiles, shell configuration, macOS defaults, and
machine bootstrap (`install.sh`, `install_macos.sh`), plus a small Bun scripts
package (`bun run test` covers `scripts/`). Preview and apply intentional source
changes to exact live targets, then verify a clean targeted diff. See the
[chezmoi constraints](AGENTS.md#chezmoi) in [AGENTS.md](AGENTS.md).

For macOS open-file exhaustion, follow [How to persist higher file limits](macos-file-limits/README.md).

The Windows PC uses a separate source, [dotfiles-windows](../dotfiles-windows/).

## Update command

`~/bin/update.ts` runs `chezmoi update --init` before package maintenance.
This pulls the source, regenerates the chezmoi config using the recorded machine
profile, and applies once. Local file conflicts still prompt for a decision;
the command does not force-overwrite changes. A failed apply stops maintenance.

The macOS LaunchAgent hook validates each installed plist and checks its exact
`gui/<uid>/<label>` service before reloading it, waiting for `bootout` teardown
to finish before calling `bootstrap`. The caller's launchd session can differ
from that GUI domain, especially over SSH. The GUI login must exist before the
hook can load its agents.

## Anthropic API access in Fish

On the workstation, run `with-anthropic <command> [args...]` for an external
tool that needs the Anthropic API key. 1Password resolves the workstation
credential for that command. Coding-agent wrappers still use subscription
logins.

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
- sets the plain-output agent gitconfig (`~/.config/agent/gitconfig`, sharing
  the normal `~/.config/gh` login), exports `AGENT_CLI`, `AI_AGENT`, and a
  per-launch `AGENT_LAUNCH_ID` UUID, and sets no-op editors and pagers;
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

Enter starts `~/bin/herdr-new-worktree` and closes the dialog. The detached
worker names a branch and title with one OpenAI Responses call (`naming.js`,
the personal key read with `op read`). It allocates the checkout on the
space's machine and opens a background space with the title and first
message. The current terminal keeps keyboard focus. A generated branch or
folder collision adds a numeric suffix. A given `{ branch }` skips naming,
opens an unnamed space, and preserves that branch's history if it exists.

MacBook, Karpathy, and the Windows desktop maintain three Git-only staged
monorepo worktrees. The login job seeds the pool and claims trigger a host-local
background refill. The worker fetches `origin/main` before allocating a new
branch. If the pool is empty it creates the checkout from the fetched commit.
If fetching fails it reports the error and leaves the request unlaunched.
Staged checkouts are hidden in Herdr's picker and Git-locked against ordinary
cleanup. A dirty or ambiguous checkout is preserved. Inspect the latest
seed and refill results in `~/.local/state/herdr-worktree/pool.log` on the
target host. To seed manually, run `~/bin/herdr-worktree-pool --seed` on macOS
or `bun ~/bin/herdr-worktree-pool.ts --seed` on Windows.

On a Mac, the checkout a request ends up with then shares its unchanged files
with the main checkout. Each new pool slot does too, right after it is staged:
the pool worker starts `~/.local/bin/toolkit tend dedupe --worktree <path>
--apply --no-refresh --lock-wait 15m` in the background, which replaces them
with APFS clones and queues behind any other tend run. A claim moves the slot
to its branch's folder, and the sharing record is kept by path, so the new-worktree
worker starts one more pass there; `git switch -c` leaves unchanged files
alone, so the slot's clones stay shared. Nothing waits on it, and it is skipped
on other machines and platforms and when toolkit is missing or does not
provide the command. The run's `events.jsonl` line records `dedupe` as
`started` or `skipped`.

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

## Agent menus and alerts

Right-click an agent in the Agents sidebar to rename its tab or space, rename
a parked agent, or close the named target. The menu scrolls and follows the
selection when you use the arrow keys or Home and End. Close actions from
this sidebar ask for confirmation and identify the selected target.
For Codex sessions on a macOS agent host, the same menu offers
**Restart Codex session**. When the agent is working, choose **Wait until
idle** or confirm **Interrupt and restart** for its current turn.

The personal layout's toast shows the agent and host and opens the session
when clicked. Herdr Desktop still decides when to notify you. **Settings →
Alerts** plays the completion and needs-attention sounds. Their MP3 paths
are set separately in `~/.config/herdr-app/settings.json` under `sounds.done`
and `sounds.blocked`, relative to the app's config directory.

## Session takeover

The Herdr `my-takeover` dialog hands a stalled or quota-exhausted coding-agent
session to another Brim-ranked provider in the same space, or migrates the
session to another Herdr machine. Open it from the global keybind (`cmd-shift-o`
on macOS, `ctrl-alt-o` on Windows), the takeover button on an agent row in
`my-agents` (always shown when a provider is at its limit, and on hover
otherwise), or **Take over…** / **Move to machine…** in a pane, tab, space, or
agent context menu (`my-menu`).

On the same machine, the dialog excludes the current terminal's provider from
the top choices. Choosing another target machine via **Move to machine…** or the
`Machine` pill (`⌥D` on macOS, `Alt+D` on Windows) switches the dialog to
cross-machine migration: it keeps the current provider selectable (and
pre-selects it when under quota), runs a live git preflight on the source
checkout to block dirty or unpushed work, and offers the same ⌥M / ⌥O / ⌥E
mode, model, and effort controls as `my-worktree` plus an optional handoff note.
Enter closes the dialog immediately and starts `~/bin/herdr-takeover` detached:

1. It runs `brim takeover --prepare --json --terminal <addr>` (locally or on the
   source machine via `hc exec --on <machine>`) to extract the structured
   transcript and write a handoff bundle before changing any Herdr UI state. On
   Windows spaces (`profile` launcher), it falls back to `hc read --lines 200`
   and writes a local handoff markdown file. If preparation fails, the source
   tab or pane stays untouched.
2. On the same machine, a single-pane tab opens the replacement tab (`tab.new`),
   moves it into the original tab's index (`tab.move`), and only then closes the
   old tab (`tab.close`), so a single-tab space never closes; a split tab splits
   beside the stalled pane (`pane.split`, passing the handoff prompt in `argv`)
   and closes only the stalled pane (`pane.close`). Across machines, the worker
   verifies a clean, pushed git checkout, fetches the branch from `origin` into
   a checkout or worktree on the target machine (or verifies a matching folder
   for non-git sessions), transfers the handoff bundle, opens the target space
   and agent, and closes the source pane, tab, or single-tab space once live.
   For Kimi, it waits for `idle` and sends the prompt via `hc send`.

Every run appends a summary line (without prompt or note text) to
`~/.local/state/herdr-takeover/events.jsonl` and to the macOS unified log, and
posts a macOS or Windows notification on failure. `~/bin/herdr-takeover --status`
prints the last runs and exits non-zero when the latest failed:

```bash
/usr/bin/log show --last 1d --style compact --predicate 'eventMessage CONTAINS "herdr-takeover"'
```

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
`restart-codex-panes --on-change` worker. Each event reconciles the actual
launch theme of managed Codex terminals on that Mac. Working turns, blocked
prompts, and drafts wait up to one hour for a safely idle composer. Another
appearance event or an ordinary theme sync rechecks remaining mismatches.

After installing the managed configuration, open `/hooks` in Codex and
trust the two exact Herdr identity hooks, then reopen the session. The
`SessionStart` hook binds the current thread and saved transcript to the
terminal's Codex process after the first prompt. `UserPromptSubmit` updates
the transcript path when a new conversation first gets saved. Restart checks
the current thread using Codex's configured `session-id` footer, verifies the
transcript, and resumes the same thread in the same terminal. Because the
replacement may defer its start hook until the next prompt, a matching live
footer confirms the resume and carries the process binding forward. Restart
requires a managed `codex` wrapper running inside a macOS fish,
zsh, or Bash terminal. The Windows core currently reports the root shell as
the foreground process, so this action is available on macOS.

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

Preview eligible terminals with `~/bin/restart-codex-panes --dry-run` or verify
the hook and saved transcript with `~/bin/restart-codex-panes --probe-identities`.
Both commands are read-only. Use **Restart Codex session** in the Agents
context menu to select a client. Working sessions offer a queued restart or a
confirmed interruption of the current turn. For CLI use, `--terminal t7`
targets a single local address and `--wait` queues that conversation. Use
`--status` or `events.jsonl` to check the result of a queued restart.

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

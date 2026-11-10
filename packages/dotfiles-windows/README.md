# dotfiles-windows

The chezmoi source for Jerred's Windows PC: shell setup, a few config files,
the installed-software record, and Windows settings. It is separate from
[`../dotfiles`](../dotfiles/), which serves macOS and Linux (including WSL),
so neither side carries the other's templates.

## Bootstrap

Clone the monorepo to `~/Git/monorepo`, then from PowerShell:

```powershell
~/Git/monorepo/packages/dotfiles-windows/install.ps1
```

It installs Git, PowerShell 7, chezmoi, MSYS2 and noctty with winget, installs
fish into MSYS2, turns on Developer Mode (one admin prompt; chezmoi needs it to
create symlinks), applies this source, installs the Fisher plugins, and installs
the Ubuntu WSL distro. Re-running it is safe.

## Shell

fish comes from MSYS2. Two settings make it behave like a native shell:

- `db_home: windows` in `C:\msys64\etc\nsswitch.conf` makes the MSYS2 home
  `C:\Users\Jerred`, so fish reads the chezmoi-managed `~/.config/fish`.
- The user environment variable `MSYS2_PATH_TYPE=inherit` passes the Windows
  `PATH` into fish, so native tools such as `claude`, `codex` and `op` resolve.

`~/.local/bin/fish.cmd` puts `fish` on the Windows `PATH`, so it starts from
PowerShell, cmd and other programs that search `PATH`. Herdr does not use it:
herdr-core opens PowerShell for every terminal on Windows.

noctty, Cursor and VS Code open fish by default. The fish credential exports
are a copy of the shared fish config; update both when they change.

## Agent wrappers

The PowerShell 7 profile's `Invoke-AgentCli` is the Windows counterpart of the
macOS `agent-exec` wrappers. Herdr starts its terminals in PowerShell with the
profile loaded, so agents started from its menus behave like typed ones. Each
of `claude`, `codex`, `agy`, `cursor-agent`, `grok`, `kimi` and `muse` becomes
a wrapper when it is installed. The wrapper removes provider API keys and
homelab tokens, adds the agent's approval and sandbox bypass flags (none with
`AGENT_SAFE=1`), and points the editor at Git's `true.exe` with `cat` as the
pager. `codex` also gets `--no-daemon` and a theme matching the Windows light or
dark setting. `agent` is left alone because on this PC it is Grok's.
`agent-safe <agent> [args]` runs one agent with `AGENT_SAFE=1`, because
Herdr's argv cannot set a variable; the new-worktree dialog uses it for plan
modes. fish
defines the same wrappers with `__agent_exec`; change both together. The
agent git and `gh` identity used on the Macs is not set up here.

## Software record

`.chezmoidata/packages.yaml` is the Windows counterpart of the Brewfile.
`winget` and `msstore` entries are installed by
`run_onchange_install-packages.ps1.tmpl` whenever the file changes. `manual`
entries have no package and are a record only. Games and runtimes are left out.

To find installed software that is not recorded yet, compare
`winget export -o packages.json` with `packages.yaml`.

## Herdr app

`~/.config/herdr-app` carries the same customizations as the Macs: the `mine`
layout, the Catppuccin themes, and the `my-*`, `agents-filter` and
`spaces-nobranch` mods. Select the layout once with
`herdr-app do layout.switch '{"name":"mine"}'`. `settings.json` and `keys.json`
are Windows-specific. The key bindings use Ctrl and Alt in place of Cmd, and
add `ctrl-alt-x` to toggle exhausted agents and `ctrl-alt-left` and
`ctrl-alt-right` for tab history.

The shared files are real copies of
[`../dotfiles/private_dot_config/herdr-app`](../dotfiles/private_dot_config/herdr-app),
not symlinks, because Herdr on Windows loads a mod's script through a symlinked
folder but not its SVG icons. Edit the macOS source, then copy each changed
folder here. `packages/dotfiles/scripts/herdr-windows-copy.test.ts` fails when
a copy differs. `herdr-app check` writes `gpui-kit.d.ts` and `jsconfig.json`
into a mod folder; they are generated and never committed.

The `my-worktree` dialog's New worktree runs the shared worker
`~/bin/herdr-new-worktree.ts`, a symlink into
`../dotfiles/bin/executable_herdr_new_worktree.ts` that needs `bun` on PATH.
The first naming call asks 1Password to approve reading the OpenAI key; a
failure posts a Windows toast. See
[New worktree dialog](../dotfiles/README.md#new-worktree-dialog).

## Changing a managed file

Edit the source here, then preview and apply only that target:

```powershell
chezmoi diff ~/.config/fish/config.fish
chezmoi apply ~/.config/fish/config.fish
```

When an app rewrites its own settings file, bring the change back with
`chezmoi re-add <target>`.

## Riot Client auto-close

Riot removed the option to close the Riot Client window when a game starts.
`~/.local/bin/riot-autoclose.ps1` restores it: while League or VALORANT is
running, and for 30 seconds after, it closes the `Riot Client` UI window. It
never touches `RiotClientServices`, Vanguard or the game.
`run_onchange_riot-autoclose-task.ps1.tmpl` registers it as the logon task
`RiotClientAutoClose`; remove it with
`Unregister-ScheduledTask RiotClientAutoClose`.

## Brim sync

This PC pushes its Claude Code and Codex transcripts to the encrypted Brim
sync archive so the Macs can browse them and count today's usage across
machines. It only pushes: it holds the archive's public age recipient and a
SeaweedFS key scoped to the `brim-sessions` bucket, never the decryption key.

Build the binary from the checkout, then apply the task and credentials:

```powershell
cd ~/Git/monorepo/packages/toolkit
bun run install:local
chezmoi apply ~/.aws/config ~/.aws/credentials
```

`run_onchange_brim-sync-task.ps1.tmpl` registers the `BrimSyncPush` task,
which runs `~/.local/bin/brim.exe sync push` at logon and every 5 minutes.
`~/.toolkit/brim-sync/logs/task.log` holds the last run's output and
`brim.exe sync status` summarizes the archive. Rebuild after pulling toolkit
changes. Remove it with `Unregister-ScheduledTask BrimSyncPush`. The
[how-to](../docs/wiki/src/content/docs/how-to/sync-agent-history-across-machines.md)
covers the Macs and first-time setup.

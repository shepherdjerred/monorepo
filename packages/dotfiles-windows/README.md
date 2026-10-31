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

noctty, Cursor and VS Code open fish by default. Both fish and the PowerShell 7
profile wrap `claude` and `codex`: direct provider API keys are removed and the
agents run without permission prompts or a sandbox. The fish credential
exports are a copy of the shared fish config; update both when they change.

## Software record

`.chezmoidata/packages.yaml` is the Windows counterpart of the Brewfile.
`winget` and `msstore` entries are installed by
`run_onchange_install-packages.ps1.tmpl` whenever the file changes. `manual`
entries have no package and are a record only. Games and runtimes are left out.

To find installed software that is not recorded yet, compare
`winget export -o packages.json` with `packages.yaml`.

## Herdr app

`~/.config/herdr-app` carries the Catppuccin themes, the `settings.json` that
selects them, and the `agents-filter` mod: a copy of the shipped `agents`
sidebar mod with a funnel menu that hides agents by provider (the choice is
saved in the app's shared state) and a Windows or laptop icon on each row for
the machine it runs on. The `spaces-nobranch` mod is the shipped `spaces` mod
without the branch and repo text on each row. The app does not take a new mod
into an existing layout, so `layouts/main.json` is managed here too: it is the
shipped `main` layout with the `agents` block on `agents-filter` and the
`spaces` block on `spaces-nobranch`. The app can rewrite that file when the
layout is edited in the window (resizing the sidebar is kept in
`layouts/.state/`, which is not managed); after an app update or a layout
change, compare it with `chezmoi diff` and bring changes back with
`chezmoi re-add`. The macOS and Linux source carries the themes and mods but
not the layout or `settings.json`.

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

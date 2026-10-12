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

## Changing a managed file

Edit the source here, then preview and apply only that target:

```powershell
chezmoi diff ~/.config/fish/config.fish
chezmoi apply ~/.config/fish/config.fish
```

When an app rewrites its own settings file, bring the change back with
`chezmoi re-add <target>`.

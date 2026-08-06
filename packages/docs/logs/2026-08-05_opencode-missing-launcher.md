---
id: log-2026-08-05-opencode-missing-launcher
type: log
status: complete
board: false
---

# OpenCode Missing Launcher

The Fish `opencode` wrapper is present, but the underlying executable is not
installed or reachable on `PATH`.

## Evidence

- The live Fish function is managed from
  `packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl` and runs
  `(command -s opencode) --auto $argv` through `env`.
- In a fresh Fish process, `command -s opencode` returns no path and the PATH
  scan finds no executable named `opencode`.
- Reproducing the wrapper with an empty command lookup returns exactly
  `env: --auto: No such file or directory` with exit status 127.
- OpenCode configuration and plugin state still exist under
  `~/.config/opencode`, so this is a missing CLI binary rather than missing
  configuration.
- Homebrew knows about the `opencode` formula (currently reports version
  `1.18.10`), but it is not installed. The managed Darwin Brewfile does not
  include `brew "opencode"`, so the bootstrap does not restore it.
- The wrapper itself predates the recent plain-tool environment change; that
  change only added environment variables around the existing invocation.

## Session Log — 2026-08-05

### Done

- Confirmed the live Fish wrapper and reproduced the exact failure.
- Confirmed the `opencode` executable is absent from PATH and common install
  locations.
- Confirmed Homebrew can provide OpenCode, while the managed Brewfile does not
  declare it.

### Remaining

- Reinstall OpenCode, or add it to the managed Brewfile and apply the dotfiles,
  if the user wants the machine repaired and future bootstrap runs to preserve
  the installation.

### Caveats

- No software was installed and no live configuration was changed during this
  investigation.

## Session Log — 2026-08-05 (Repair)

### Done

- Installed Homebrew `opencode` 1.18.10.
- Verified the Fish wrapper resolves `/opt/homebrew/bin/opencode`.
- Verified `opencode --version` succeeds through the wrapper.

### Remaining

- None.

### Caveats

- Homebrew warned that macOS 27 is a pre-release/unsupported version; the
  installation itself completed successfully.

## Session Log — 2026-08-05 (Managed Brewfile)

### Done

- Added `brew "opencode"` to `packages/dotfiles/.Brewfile_darwin`.
- Applied the generated `~/.Brewfile` target with chezmoi.
- Verified the source and rendered Brewfile both contain the formula, with no
  remaining chezmoi diff for `~/.Brewfile`.

### Remaining

- None.

### Caveats

- The live `~/.Brewfile_darwin` fragment is not an independently managed target;
  applying `~/.Brewfile` is the correct way to render the included source.

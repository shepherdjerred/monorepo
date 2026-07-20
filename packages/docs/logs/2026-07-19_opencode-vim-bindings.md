---
id: log-2026-07-19-opencode-vim-bindings
type: log
status: complete
board: false
---

# OpenCode Vim Bindings

## Session Log — 2026-07-19

### Done

- Verified OpenCode's current TUI and keybinding documentation.
- Confirmed OpenCode supports individual `tui.json` key remappings, not Vim's modal editing mode.
- Left the configuration unchanged because binding `h`, `j`, `k`, and `l` globally would break normal prompt text entry.
- Updated the Fish `opencode` wrapper to always pass `--auto`; this also applies to the `oc` abbreviation.
- Mirrored the setting in the chezmoi source.

### Remaining

- None.

### Caveats

- OpenCode can use Vim or Neovim as the external editor through the `EDITOR` environment variable, but this does not add Vim bindings to its prompt.
- `--auto` approves every permission that OpenCode has not explicitly denied.

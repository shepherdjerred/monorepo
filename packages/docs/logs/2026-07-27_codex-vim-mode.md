---
id: log-codex-vim-mode-2026-07-27
type: log
status: complete
board: false
---

# Codex Vim Mode

The Codex CLI can start every new terminal session in Vim normal mode by adding
the following user-level setting to `~/.codex/config.toml`:

```toml
[tui]
vim_mode_default = true
```

The `/vim` slash command still toggles Vim editing for the current session.

## Session Log — 2026-07-27

### Done

- Verified the persistent setting against the current Codex configuration
  reference and the locally installed Codex CLI 0.145.0.
- Added `vim_mode_default = true` to `~/.codex/config.toml`.
- Added the previously unmanaged Codex configuration to chezmoi at
  `packages/dotfiles/private_dot_codex/private_config.toml`.
- Verified that the live and chezmoi-managed configurations have no diff.
- Mapped the broader Codex configuration surface and identified named profiles,
  review-model overrides, permission profiles, agent defaults, history controls,
  and TUI customization as the main unused levers in the current configuration.

### Remaining

- None.

### Caveats

- The setting affects the Codex CLI composer; it does not configure editor Vim
  extensions or unrelated Codex interfaces.
- Chezmoi now manages the full private Codex configuration, not only the Vim
  setting; future live configuration changes should be captured with
  `chezmoi re-add ~/.codex/config.toml`.

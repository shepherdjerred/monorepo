# OpenCode Fish Alias

## Status

Complete

Added the `oc` Fish abbreviation for OpenCode and verified its expansion.

## Session Log — 2026-07-19

### Done

- Added `abbr oc opencode` to the managed Fish source at `packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl`.
- Added the same abbreviation to the active `~/.config/fish/config.fish` configuration.
- Confirmed OpenCode supports `--auto` to automatically approve permissions not explicitly denied.
- Confirmed Pi has no command, Homebrew formula, active configuration directory, or managed-dotfiles configuration.
- Inventoried installed coding-agent CLIs: Claude Code, Codex CLI, OpenCode, Gemini CLI, and Kimi Code.
- Uninstalled Gemini CLI from Homebrew and Mise's Node global package prefix, removed Kimi Code, and deleted the un-managed `~/.gemini` state directory.
- Compared OpenCode, Codex, and Claude Code global configuration. OpenCode currently only configures a Kimi provider plugin and has no equivalent model, permission, instruction, MCP, or plugin-workflow policy.

### Remaining

- None.

### Caveats

- `--auto` is intentionally dangerous: explicit deny rules continue to apply, but other permission requests are approved automatically.
- The shared `GEMINI_API_KEY` Fish environment variable remains because other software may use the provider credential.

---
id: log-2026-07-19-opencode-fish-alias
type: log
status: complete
board: false
---

# OpenCode Fish Alias

## Session Log — 2026-07-19

### Done

- Added `abbr oc opencode` to the managed Fish source at `packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl`.
- Added the same abbreviation to the active `~/.config/fish/config.fish` configuration.
- Confirmed OpenCode supports `--auto` to automatically approve permissions not explicitly denied.
- Confirmed Pi has no command, Homebrew formula, active configuration directory, or managed-dotfiles configuration.
- Inventoried installed coding-agent CLIs: Claude Code, Codex CLI, OpenCode, Gemini CLI, and Kimi Code.
- Uninstalled Gemini CLI from Homebrew and Mise's Node global package prefix, removed Kimi Code, and deleted the un-managed `~/.gemini` state directory.
- Compared OpenCode, Codex, and Claude Code global configuration. OpenCode currently only configures a Kimi provider plugin and has no equivalent model, permission, instruction, MCP, or plugin-workflow policy.
- Audited 52 distinct first-party OpenCode documents: 36 official documentation pages, the published configuration schema, and 16 repository guides/specifications.
- Enabled OpenCode LSP support, disabled transcript sharing, and merged the active local Kimi/quota plugin configuration into the managed template.
- Added the Claude-equivalent OpenCode destructive-command denylist and managed Codex narrow safety rules.
- Verified OpenCode Kimi model discovery, chezmoi synchronization, and Codex policy decisions for forbidden and safe commands.

### Remaining

- None.

### Caveats

- `--auto` is intentionally dangerous: explicit deny rules continue to apply, but other permission requests are approved automatically.
- The shared `GEMINI_API_KEY` Fish environment variable remains because other software may use the provider credential.
- No OpenCode model defaults are configured so provider selection can change with subscription quotas.
- Codex rules use literal command prefixes; recursive force deletion is blocked for every target because the rule language cannot match a home-directory path prefix safely.

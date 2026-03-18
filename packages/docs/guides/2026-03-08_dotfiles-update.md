# Dotfiles Update Script

## Overview

`packages/dotfiles/bin/executable_update.ts` is a Bun-based system update orchestrator. It runs sequential then parallel tasks:

1. **Sequential:** `chezmoi update`, `chezmoi apply`, (Linux: apt update/upgrade)
2. **Parallel:** `mise upgrade`, `fisher update`, `fish_update_completions`, `brew update && brew upgrade`, LunarVim updates
3. **Post:** tmux plugin updates (if tpm exists), `write_brewfile.sh`

## Chezmoi Source Directory

Configured in `.chezmoi.toml.tmpl` to use `~/git/monorepo/packages/dotfiles` (not the default `~/.local/share/chezmoi/`).

## Known Issues

### 1Password references in fish config

`private_dot_config/private_fish/config.fish.tmpl` loads secrets via `onepasswordRead`. If a 1Password item is deleted/archived, `chezmoi apply` fails entirely.

Affected secrets (lines 39-46):

- `GITHUB_TOKEN` — Homelab vault
- `GRAFANA_TOKEN` — Homelab vault
- `PAGERDUTY_TOKEN` — was Homelab vault item `yio3tx4wkvysvy5umdrqh7fe2e`, **deleted as of 2026-02-28**
- `BUGSINK_TOKEN` — Personal vault
- `ARGOCD_AUTH_TOKEN` — separate vault

### write_brewfile.sh path mismatch

`bin/executable_write_brewfile.sh` hardcodes `~/.local/share/chezmoi/` but the actual source dir is the monorepo. Should use `chezmoi source-path` instead.

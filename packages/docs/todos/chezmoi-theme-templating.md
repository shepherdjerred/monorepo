---
id: chezmoi-theme-templating
status: deferred
origin: packages/docs/logs/2026-05-13_chezmoi-update.md
source_marker: false
---

# Templatize chezmoi theme files instead of baking literal Light/Dark values

## What

Six theme-related configs (zellij, btop, atuin, claude private_settings, gemini private_settings, plus one more captured in Round 4) currently store **literal** theme values in the chezmoi source — `catppuccin-mocha` vs `catppuccin-latte`, dark vs light, etc. Each time macOS toggles appearance and `~/bin/sync-theme.sh` rewrites the live files, the chezmoi source diverges and a future `chezmoi re-add` round becomes necessary. The Round 4 cycle (2026-05-14) was the second time this happened in a week. The architectural fix is to template these values off `{{ if eq .chezmoi.os "darwin" }}` + a macOS appearance probe (or a chezmoi `data` entry refreshed by `sync-theme.sh`), so source carries only the conditional, not the resolved value.

## Why it's open

Round 4 shipped the immediate fixes (anchored sed patterns, removed `|| true` swallowers, fixed `run_after_generate-themes.sh.tmpl` source path bug) but the structural change was explicitly deferred — it requires designing the chezmoi data probe and reworking each of the six templates, and the live state was already correct after the re-add.

## Done when

- All six theme files in `packages/dotfiles/` use `{{ }}` template expressions to pick palette / theme name from a single `.chezmoidata` source of truth (e.g. `appearance: dark|light`).
- `sync-theme.sh` updates that single data value (and runs `chezmoi apply`), instead of `sed`-rewriting each file independently.
- A `chezmoi diff` immediately after a Light↔Dark toggle is empty (no per-file divergence).
- The fragile sed-anchoring in `bin/executable_sync-theme.sh` can be deleted.

## References

- Originating log: `packages/docs/logs/2026-05-13_chezmoi-update.md` (Round 4 section, lines 132+)
- Round 4 plan: `~/.claude/plans/virtual-strolling-hamster.md`
- Files affected (live + source): zellij `config.kdl`, btop config, atuin config, claude `private_settings.json`, gemini `private_settings.json`, plus the sixth captured in Round 4
- Driver script: `bin/executable_sync-theme.sh`

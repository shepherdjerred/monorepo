# Chezmoi Source ↔ Live Reconciliation (auto-theme)

## Status

Complete

## Context

`/chezmoi-update` found 6 diverging files between the chezmoi source (`packages/dotfiles/`)
and live `$HOME`. The dotfiles source working tree was clean, so the divergence was not
random drift — commit `3ced80ac8` ("switch to auto theme — native where possible, slim
sync script with create\_ guards", May 30) had moved the **source** ahead but
`chezmoi apply` was never run, so live lagged.

Decisive evidence the auto-theme system is actively in use (→ source is intentionally
ahead, apply repo→live): `~/bin/sync-theme.sh` was modified Jun 2 16:55, and macOS is
currently in Light mode — so live `theme "catppuccin-latte"` / Claude Code `"light"`
were just the light-state _output_, not deliberate pins.

## Direction decision (per file)

| File                                   | Direction            | Rationale                                                                          |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Cursor `settings.json`                 | re-add (live→source) | Cursor live is always truth (standing rule); restored `files.autoSave`, icon→latte |
| Sublime `Preferences.sublime-settings` | re-add (live→source) | Sublime-owned formatting drift (`[]`→`[\n  ]`)                                     |
| `.claude/settings.json`                | apply (source→live)  | theme `light`→`auto` (deliberate commit; visually no-op while OS=light)            |
| `.config/zellij/config.kdl`            | apply (source→live)  | native `theme_dark`/`theme_light` auto-switch                                      |
| `.config/fish/config.fish`             | apply (source→live)  | template is SOT; dropped one stray blank line                                      |
| `~/sync-theme.sh` (`run_after_`)       | apply (runs script)  | benign wrapper calling already-active `~/bin/sync-theme.sh`                        |

## Actions

1. `chezmoi re-add` Cursor + Sublime → verified empty diff for both.
2. Confirmed only the 4 theme items remained divergent.
3. `chezmoi apply` aborted (non-interactive, no TTY) because Claude Code had rewritten
   `.claude/settings.json` since chezmoi last touched it. Re-ran with `chezmoi apply --force`
   (documented in the chezmoi-update skill) — safe because only the 4 theme items diverged.
4. Verified live: Claude Code `theme: "auto"`, zellij `theme_dark`/`theme_light`,
   fish blank line removed. `run_after` sync script executed (apply exit 0).

## Verification

- `chezmoi diff` is empty **except** the `run_after_sync-theme.sh` entry, which is
  expected: `run_after_` (non-`once`/non-`onchange`) scripts always render as a pending
  "new file" in `chezmoi diff` because they execute on every apply. Not a real divergence.

## Session Log — 2026-06-02

### Done

- Re-added live state into source for Cursor `settings.json` (restored `files.autoSave`,
  `workbench.iconTheme` mocha→latte) and Sublime `Preferences.sublime-settings`
  (`ignored_packages` `[]`→`[\n  ]`). Left as uncommitted working-tree changes in
  `packages/dotfiles/`.
- Applied source→live for the auto-theme feature: `.claude/settings.json` `theme: "auto"`,
  `.config/zellij/config.kdl` dark/light auto-switch, `.config/fish/config.fish` blank-line
  trim; `run_after_sync-theme.sh` ran.
- `chezmoi diff` clean (only the expected always-pending `run_after` script remains).

### Remaining

- None required. Optional: commit the two re-added dotfiles source changes
  (`packages/dotfiles/Library/Application Support/{Cursor,Sublime Text}/...`) — left
  uncommitted pending user review.

### Caveats

- `run_after_sync-theme.sh` will always appear in `chezmoi diff`; this is by design for
  non-`once`/non-`onchange` run scripts and does not indicate divergence.
- `chezmoi apply` on `.claude/settings.json` needs `--force` in non-interactive shells
  because Claude Code rewrites that file out-of-band (chezmoi sees "changed since last write").
- Theme changes are visually a no-op right now (macOS in Light mode); they take visible
  effect when the OS switches to Dark.

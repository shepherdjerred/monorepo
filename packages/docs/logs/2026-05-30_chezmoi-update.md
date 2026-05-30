# Chezmoi update — pin latte, drop sync-theme script, untrack codex

## Status

In Progress (awaiting PR merge, then post-merge live cleanup)

## Context

Routine `/chezmoi-update` session that turned into a larger cleanup:

- 14 files showed divergence in `chezmoi diff`, including theme drift (mocha/dark in source vs latte/light in live, driven by `~/bin/sync-theme.sh` flipping on macOS appearance change)
- Codex was constantly auto-rewriting `~/.codex/config.toml`, generating perpetual drift
- `gh/hosts.yml.tmpl` template still referenced an OAuth token via 1Password, but `gh` now uses keychain auth — live had empty `users.shepherdjerred: {}`
- The deferred [chezmoi-theme-templating todo](../todos/chezmoi-theme-templating.md) had been open for ~2 weeks because the theme dance was about to repeat

User decision tree this session:

| Question               | Answer                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Codex drift            | Untrack via `.chezmoiignore`                                                          |
| gh token in template   | Strip — root-cause fix                                                                |
| Gemini                 | Remove from chezmoi entirely                                                          |
| Theme strategy         | **Pin to latte, delete `sync-theme.sh` and the dark-notify LaunchAgent**              |
| AWS config direction   | Re-add (live has the seaweedfs-as-default + `[profile aws]` structure the user wants) |
| Sublime drift          | Re-add (accept Sublime's whitespace)                                                  |
| pinchtab perms         | Re-add — source goes private (700/600) to match what pinchtab writes                  |
| Worktree vs main edits | Edit in worktree, commit + PR, user merges                                            |

Branch: `chore/chezmoi-pin-latte-untrack-codex` in worktree `cosmic-leaping-plum`.

## What changed (source)

### Removed

- `packages/dotfiles/private_dot_codex/` — whole dir (replaced by `.codex/**` in `.chezmoiignore`)
- `packages/dotfiles/dot_gemini/` — whole dir
- `packages/dotfiles/run_after_sync-theme.sh.tmpl`
- `packages/dotfiles/run_after_generate-themes.sh.tmpl`
- `packages/dotfiles/run_onchange_after_launchagent.sh.tmpl`
- `packages/dotfiles/bin/executable_sync-theme.sh`
- `packages/dotfiles/Library/LaunchAgents/com.jerred.dark-notify.plist`
- `packages/dotfiles/private_dot_config/private_fish/conf.d/theme-env.fish.tera`
- Per-theme variants we no longer need: `eza/theme-mocha.yml`, `ov/config-mocha.yaml`
- `packages/docs/todos/chezmoi-theme-templating.md` (resolved by pinning, not templating)
- `dark-notify` and `whiskers` from `.Brewfile_darwin` (only used by sync-theme infra)

### Pinned to latte

- `private_dot_config/private_atuin/private_config.toml` → `catppuccin-latte`
- `private_dot_config/btop/btop.conf.tmpl` darwin branch → `catppuccin_latte`
- `private_dot_config/starship.toml` → `catppuccin_latte`
- `private_dot_config/zellij/config.kdl` → `catppuccin-latte`
- `dot_claude/private_settings.json` `"theme"` → `light`

### New static files (replacing dynamic ones)

- `private_dot_config/private_fish/conf.d/theme-env.fish` — static latte values, replaces the tera template + whiskers generator
- `dot_gitconfig-theme` — static latte delta/difft features, replaces the heredoc-written file from sync-theme.sh

### Renames

- `Library/Application Support/eza/theme-latte.yml` → `theme.yml` (single static file, no more symlink)
- `private_dot_config/ov/config-latte.yaml` → `config.yaml` (same)
- `Library/Application Support/pinchtab/` → `private_pinchtab/`, `config.json` → `private_config.json` (capture live 700/600 perms)

### Re-add equivalents (live state copied into source)

- `private_dot_aws/config` — restored seaweedfs-as-default + `[profile aws]` block
- `Library/Application Support/Sublime Text/.../Preferences.sublime-settings` — captured Sublime's `[\n  ]` formatting

### Other

- `private_dot_config/private_gh/hosts.yml.tmpl` — stripped both `oauth_token: '{{ onepasswordRead ... }}'` lines (gh uses keychain now)
- `.chezmoiignore` — added `.codex/**`
- `dot_agents/skills/chezmoi-helper/SKILL.md` + `references/advanced.md` — updated examples that referenced removed scripts

## What changed (live)

- `launchctl bootout` of `com.jerred.dark-notify` to stop the theme-flip noise during this session

Everything else is deferred until the PR merges and the user runs `chezmoi apply`.

## Verification

`chezmoi --source=<worktree>/packages/dotfiles status` shows only the expected post-merge changes — pure latte propagation plus an unrelated `.kube/config` cert rotation (skipped this session). No more pinchtab perm diff, no gh token diff, no codex diff.

## Session Log — 2026-05-30

### Done

- Source edits described above committed to `chore/chezmoi-pin-latte-untrack-codex`
- LaunchAgent unloaded to stop sync-theme.sh noise mid-session
- TODO `chezmoi-theme-templating` deleted (resolved by the pinning approach instead of templating)

### Remaining (post-merge cleanup)

After the PR merges, the user needs to:

1. `chezmoi apply` — propagates source changes to live (theme files become latte, eza/ov theme files become real files instead of symlinks, gitconfig-theme gets static latte values)
2. Manually remove orphaned live files chezmoi won't delete:

   ```bash
   rm ~/Library/LaunchAgents/com.jerred.dark-notify.plist
   rm ~/bin/sync-theme.sh
   rm ~/.config/fish/conf.d/theme-env-{frappe,latte,macchiato,mocha}.fish
   rm ~/.config/fish/conf.d/theme-env.fish.tera
   rm "~/Library/Application Support/eza/theme-mocha.yml"
   rm "~/Library/Application Support/eza/theme-latte.yml"
   rm ~/.config/ov/config-mocha.yaml
   rm ~/.config/ov/config-latte.yaml
   ```

3. Optional: `brew uninstall cormacrelf/tap/dark-notify catppuccin/tap/whiskers` if no other use
4. Optional: leave `~/.codex/` alone — chezmoi just stops managing it; user keeps the file

### Caveats

- `.kube/config` is also diverged (cert rotation 2026-05-30). Untouched this session — separate concern.
- The PR cannot be verified with `chezmoi diff` against main until after merge. The worktree-source diff (`chezmoi --source=<worktree>/packages/dotfiles`) is the substitute and it's clean.
- If the user opens a new shell session before running `chezmoi apply` post-merge, the live theme files are still whatever they were when dark-notify was last running. `chezmoi apply` will fix them.
- pinchtab daemon writes config.json at 600 each time; that now matches the `private_` source, so the diff won't re-appear. If pinchtab is ever reconfigured to write at 644, the source rename will need to be reverted.

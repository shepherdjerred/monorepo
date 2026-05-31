# PinchTab config-split fix & chezmoi tracking cleanup

## Status

Complete

## Summary

Restarting the stale pinchtab daemon (0.11.0 → 0.13.1) surfaced repeated `401 bad_token` from the CLI. Root cause: pinchtab read **two different config files** — the launchd daemon used `~/Library/Application Support/pinchtab/config.json` (its plist pins `PINCHTAB_CONFIG` there) while the interactive CLI, lacking `PINCHTAB_CONFIG`, fell back to `~/.pinchtab/config.json`. The two `.server.token` values had drifted. The split was baked into the install recipe, which ran `pinchtab config set …` without `PINCHTAB_CONFIG`, writing settings/token to the wrong file.

We also found the daemon's config was **committed in plaintext** to the dotfiles and **rewritten at runtime** (perpetual `chezmoi diff`, apply-clobber risk). Decision (user): the localhost-only token is acceptable to keep public — no rotation, no 1Password templating. Fix justified on drift/clobber-prevention grounds: track the recipe, not the generated config.

Plan: `~/.claude/plans/can-we-track-any-snappy-lollipop.md` (approved).

## Changes (working tree, branch `fix/expand-bugsink-scout-pvcs`)

| File                                                                                                       | Change                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl` (+ live `~/.config/fish/config.fish`) | Add `set -gx PINCHTAB_CONFIG …` (darwin-guarded) so CLI + daemon share one config                                                                                                              |
| `packages/dotfiles/run_once_after_install-pinchtab-daemon.sh.tmpl`                                         | `export PINCHTAB_CONFIG=…` at top of the pinchtab block; fix stale field `security.idpi.allowedDomains` → `security.allowedDomains` (unknown field in 0.13.1, would abort `set -euo pipefail`) |
| `packages/dotfiles/.chezmoiignore`                                                                         | Ignore `Library/Application Support/pinchtab/config.json`                                                                                                                                      |
| `packages/dotfiles/Library/Application Support/pinchtab/config.json`                                       | Removed (untracked — daemon-owned runtime state)                                                                                                                                               |
| `packages/dotfiles/dot_agents/skills/pinchtab-helper/SKILL.md`                                             | New `## Authentication` section; fixed two hardcoded config-path references                                                                                                                    |

Live-system changes (not in git): replaced `~/.pinchtab/config.json` with a **symlink** → the Library config (single source of truth; default path and daemon path now resolve to one file, works without the env var); removed `~/.pinchtab/config.json.bak`. Applied the skill to `~/.agents/skills/…` (`~/.claude/skills` symlinks to it).

## Verification

- `pinchtab health` → `ok` from both a bare shell (via symlink) and `fish -c` (via env var); previously 401.
- `pinchtab nav https://example.com` → `title: Example Domain`, `url: https://example.com/`.
- `chezmoi diff "$HOME/Library/.../pinchtab/config.json"` → `not managed`; `chezmoi managed` no longer lists it (still tracks skill, install script, dir).
- Daemon healthy on `0.13.1` (`/health` → `status: ok`).
- Dotfiles changeset is the 5 files above (1 deletion, 4 modifications).

## Session Log — 2026-05-30

### Done

- Restarted stale pinchtab daemon 0.11.0 → 0.13.1 (`launchctl kickstart -k`); earlier in session synced the token as a band-aid.
- Diagnosed and durably fixed the CLI/daemon config split (env var + symlink); see table above.
- Untracked the runtime-rewritten, plaintext-token config from chezmoi (forget + `.chezmoiignore`).
- Fixed a latent install-script bug (`security.idpi.allowedDomains` is unknown in 0.13.1).
- Documented the auth model in the `pinchtab-helper` skill.
- Updated memory `reference_pinchtab_config_split.md` with the durable state.

### Remaining

- None required. Optional: commit the 5-file dotfiles changeset (left uncommitted for user review).

### Caveats

- **Claude's Bash tool shell does not source fish config**, so `$PINCHTAB_CONFIG` is empty there — pinchtab still works via the `~/.pinchtab/config.json` symlink. Use `fish -c '…'` if you need the env var explicitly.
- The **token remains public** in git history (user-accepted; server binds 127.0.0.1). Not rotated.
- The headed default instance (`always-on`) periodically loses its tab after idle; `pinchtab nav` then 500s ("context deadline exceeded", not 401) on a stale tab. Fix: stop the instance (`POST /instances/{id}/stop`) and it respawns. This is a pinchtab stability quirk, not a config issue.
- chezmoi still tracks the now-empty `Library/Application Support/pinchtab/` directory (harmless; the dir is needed and the install script repopulates it).

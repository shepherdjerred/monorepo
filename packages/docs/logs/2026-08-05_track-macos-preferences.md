---
id: 2026-08-05-track-macos-preferences
type: log
status: complete
board: false
---

# Track macOS preferences

Capture the locally customized macOS preferences into the dotfiles Chezmoi source.

## Findings

- `chezmoi status` cannot detect macOS preference-database changes because the
  managed source is declarative YAML, not a mirror of those databases.
- `macos-defaults dump` identified the current values for the existing
  preference domains, but it cannot identify which values a user explicitly
  changed.
- The raw dumps also contain host-specific identifiers, timestamps, Dock
  bookmarks, recent-file history, app state, and account-related data. Those
  values are intentionally excluded from the desired machine configuration.

## Session Log — 2026-08-05

### Done

- Created the `feature/track-macos-preferences` git-spice stack in an isolated
  worktree.
- Captured the stable macOS preference values into
  `packages/dotfiles/private_dot_config/macos-defaults/`.
- Retained the existing declarative macOS preferences, the explicitly requested
  Dock hot-corner setting, Clipboard History retention, Celsius, and the
  configured trackpad preferences; discarded unrelated inferred values.
- Disabled the Dock's lower-right Quick Note hot corner in both the managed
  configuration and the active macOS preferences.
- Validated the full configuration with `macos-defaults --dry-run apply` and
  checked all changed YAML with Prettier.
- Published the resulting changes as draft PR #1998.
- Fixed the tracked Sublime settings formatting and unique session-log headings
  required by repository-wide Prettier and Markdownlint checks.

### Remaining

- None.

### Caveats

- Privacy permissions, account sign-ins, and app-specific state remain outside
  the portable dotfiles boundary.
- A macOS defaults dump has no provenance, so any future capture must be
  confirmed explicitly before it becomes managed configuration.
- `macos-defaults --dry-run apply` restarts declared processes, so it is not
  side-effect free; preference values were verified with direct reads instead.
- `git-spice` removed stale local tracking metadata for the already-absent
  `feature/dotfiles-default-apps` branch while committing this stack.

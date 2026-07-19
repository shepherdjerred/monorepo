---
id: log-2026-05-22-archive-projects
type: log
status: complete
board: false
---

# Archive Legacy Projects

## Summary

Archived six legacy projects out of the active `packages/` tree:

- `castle-casters`
- `clauderon`
- `glance`
- `hn-enhancer`
- `macos-cross-compiler`
- `tips`

The active package catalog, CI generator, Dagger registrations, local setup script, hooks, release-please config, and current documentation were updated so these projects no longer participate in normal package discovery, CI, or release flows.

## Session Log — 2026-05-22

### Done

- Moved the six project directories from `packages/` to `archive/`.
- Removed active CI and Dagger registrations for archived projects, including Clauderon binary build/upload steps and Castle Casters package test steps.
- Updated release-please, knip, lefthook, setup, lint/quality helpers, docs, and website links that referenced the old active package paths.
- Verified JSON parsing, CI catalog imports, affected CI tests, CI typecheck, Dagger hygiene, and Prettier formatting for supported edited files.

### Remaining

- None.

### Caveats

- `toolkit recall search` was unavailable because the local recall SQLite database is readonly in this environment.
- `mise` config is not trusted in this worktree; verification commands need `MISE_TRUSTED_CONFIG_PATHS` to bypass the trust prompt without mutating the global mise state.
- Prettier does not infer parsers for `.gitattributes`, `.gitleaks.toml`, `.largeignore`, or shell scripts; those were reviewed by targeted checks rather than Prettier.

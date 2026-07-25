---
id: log-2026-07-24-claude-managed-settings-split
type: log
status: complete
board: false
---

# Claude Code settings — split durable config into the managed layer

## Problem

`~/.claude/settings.json` was chezmoi-managed (`dot_claude/private_settings.json`).
Claude Code rewrites session state — `model`, `effortLevel`, fast mode — back into
that file on every `/model` or `/effort`, so it perpetually drifted from the
chezmoi source, and `chezmoi re-add` risked snapshotting a transient model
(observed: a `/chezmoi-update` run captured `model: claude-fable-5[1m]` mid-session).

## Approach

The **managed-settings** tier is the one config layer the Claude Code runtime never
writes, and it sits at the top of the precedence chain
(`managed > CLI > project-local > project > user`). Managed permission rules are
also authoritative — a `deny` there cannot be overridden even in
`bypassPermissions` mode. So durable, safety-critical config moves to managed;
the churny keys stay in an untracked user file.

Semantics confirmed via `code.claude.com/docs/en/settings` + claude-code-guide:

- Permission rules **merge** across tiers (deny/ask/allow cumulative; deny wins).
- `enabledPlugins` in managed **replaces** the user list (does not merge) — so
  `/plugin` UI toggles become inert. User accepted this (plugins managed
  declaratively).
- `defaultMode` at managed scope is undocumented → kept user-side. `deny` still
  enforced regardless.
- Recovery is trivial: delete the managed file; Claude re-reads at launch (no
  secondary cache for a local managed file).

## The split

- **managed** (`packages/dotfiles/claude-managed/managed-settings.json`, installed
  to `/Library/Application Support/ClaudeCode/managed-settings.json`): only the
  enforcement policy `permissions.deny` + `permissions.ask`, plus `enabledPlugins`.
- **user** (`~/.claude/settings.json`, now `.chezmoiignore`d; seeded from
  `claude-managed/settings.user-reference.json`): `permissions.defaultMode`, prefs
  (`editorMode`, `theme`, skip-flags, `alwaysThinkingEnabled`,
  `agentPushNotifEnabled`), and the churny `model`/`effortLevel` (now untracked).

Both files carry **only non-default customizations** — no boilerplate. Dropped
vs the original settings: `hooks: {}` (Claude Code default) and
`permissions.allow` (a no-op under `bypassPermissions`).

Parity check: the union of the two new files reproduces the original committed
`private_settings.json` exactly, except `effortLevel: xhigh→high` (an intentional
change made earlier this session).

## Files

- `claude-managed/managed-settings.json` — authoritative policy (permissions + plugins)
- `claude-managed/settings.user-reference.json` — seed/backup for user-scope keys
- `claude-managed/install-managed-settings.sh` — strict-JSON-validated sudo installer
  (uses `python3`, not `plutil` — plutil is lenient and accepts trailing commas)
- `claude-managed/README.md` — architecture, bootstrap, recovery
- `.chezmoiignore` — added `.claude/settings.json` + `claude-managed`
- removed `dot_claude/private_settings.json`

## Session Log — 2026-07-24

### Done

- Created `packages/dotfiles/claude-managed/` (managed policy, user reference,
  installer, README) in worktree `feature/claude-managed-settings`.
- Added `.chezmoiignore` entries for `.claude/settings.json` and `claude-managed`;
  removed `dot_claude/private_settings.json`.
- Validated: strict JSON (python3) on both JSON files, shellcheck clean on the
  installer, parity vs original settings confirmed (only intentional
  `effortLevel` delta).

### Remaining (operator steps — need the user's sudo / live machine)

- Run `packages/dotfiles/claude-managed/install-managed-settings.sh` to install the
  managed policy to the system path, then restart Claude Code and confirm via
  `/status` that the managed source is active and permissions still apply.
- Trim the live `~/.claude/settings.json` down to the user-reference keys (remove
  the now-managed `permissions.allow/ask/deny` + `enabledPlugins`). Harmless if
  left — permissions merge — but cleaner to match the reference.

### Caveats

- `enabledPlugins` in managed **replaces**: after install, `/plugin` toggles won't
  take effect until `managed-settings.json` is edited + the installer re-run.
- `defaultMode: bypassPermissions` stays user-side (undocumented at managed scope);
  if the ignored user file is ever deleted without reseeding, Claude drops to the
  default prompt mode until reseeded from the reference.
- The installer needs `python3` on PATH (strict validation) and macOS (system path).

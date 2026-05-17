---
name: chezmoi-update
description: >
  This skill should be used when the user asks to "update chezmoi", "sync dotfiles",
  "match live state", "match repo state", "chezmoi re-add", "chezmoi diff fix",
  "chezmoi apply", or mentions chezmoi source/live discrepancies, divergence between
  dotfiles repo and filesystem, or wants to reconcile chezmoi state in either direction.
---

# Chezmoi Update — Syncing Source and Live State

## Principle: Live is Truth

The live filesystem is always the source of truth. The chezmoi source (repo) is a
**snapshot** of live state. All config files are plain files — no modify templates.

## Workflow

1. Run `chezmoi diff` to identify divergence
2. Classify each file by source filename
3. Sync using the correct method
4. Verify with `chezmoi diff` — expect empty output

## Classification

```bash
chezmoi source-path ~/.example/config.json
```

| Source filename pattern        | Type       | Sync method            |
| ------------------------------ | ---------- | ---------------------- |
| `*.tmpl`                       | Template   | Edit template directly |
| Plain file (no special prefix) | Plain file | `chezmoi re-add`       |

Also check for **permission diffs** (`old mode`/`new mode` in diff output):

- Mode `100600` = private (needs `private_` in filename)
- Mode `100644` = normal (no `private_` prefix)

## Live-to-Repo Sync (most common)

Since live is truth, the typical operation is capturing live state back to source:

```bash
chezmoi re-add ~/.example/config.json
```

Verify immediately with `chezmoi diff` — expect empty output.

## Repo-to-Live Sync

Only use when the source was intentionally edited (e.g., a bug fix in a config):

```bash
chezmoi apply ~/.example/config.json          # specific file
chezmoi apply --force ~/.example/config.json  # if chezmoi warns about changes
```

## Verification

After any sync operation:

1. `chezmoi diff <path>` — expect empty output for each synced file
2. If diff persists, compare: `chezmoi cat <path>` vs `cat <path>`
3. For source repo changes, review `git diff` in the dotfiles directory

## Anti-Patterns

- **Never use modify templates.** They create a fake SOT that drifts from reality and
  prevent `chezmoi re-add` from working.
- **Never assume `re-add` succeeded without verifying.** Always check `chezmoi diff` after.
- **Never apply without checking direction.** Confirm that source is intentionally ahead
  of live before overwriting live state.

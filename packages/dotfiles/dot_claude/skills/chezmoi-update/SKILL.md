---
name: chezmoi-update
description: >
  This skill should be used when the user asks to "update chezmoi", "sync dotfiles",
  "match live state", "match repo state", "chezmoi re-add", "chezmoi diff fix",
  "chezmoi apply", "fix MCP server config", or mentions chezmoi source/live
  discrepancies, divergence between dotfiles repo and filesystem, or wants to
  reconcile chezmoi state in either direction.
---

# Chezmoi Update — Syncing Source and Live State

## Purpose

Reconcile differences between chezmoi source (repo) and the live filesystem. The critical
insight: `chezmoi re-add` silently fails for `modify_` templates. Those require reading the
template logic and editing the template directly.

## Workflow Overview

1. Run `chezmoi diff` (optionally with specific paths) to identify divergence
2. Classify each file
3. Apply the correct sync procedure per file type
4. Verify with `chezmoi diff` — expect empty output for synced files

## Step 1: Classify Each Divergent File

For each file shown in `chezmoi diff`:

```bash
chezmoi source-path ~/.example/config.json
```

Classify based on the source filename:

| Source filename pattern | Type | Live-to-Repo method |
|---|---|---|
| `modify_*.tmpl` | Modify template | Edit template (Section 3) |
| `modify_*` (no `.tmpl`) | Modify script (chezmoi-native) | Edit template (Section 3) |
| `*.tmpl` (no `modify_`) | Regular template | Edit template directly |
| Plain file (no special prefix) | Plain file | `chezmoi re-add` |

Also check for **permission diffs** (`old mode`/`new mode` in diff output):
- Mode `100600` = private (needs `private_` in filename)
- Mode `100644` = normal (no `private_` prefix)
- Add or remove `private_` prefix on the source filename as needed

## Step 2: Repo-to-Live Sync (Simple Direction)

To update live files to match chezmoi source:

```bash
chezmoi apply ~/.example/config.json    # specific file
chezmoi apply                           # all files
```

For modify templates, the script receives existing file content on stdin and outputs the merged
result. The DESIRED values in the template always win on key conflicts.

## Step 3: Live-to-Repo Sync (Modify Templates)

This is the critical procedure. **Never use `chezmoi re-add` on modify templates.**

### 3a: JSON/jq Merge Templates

Most modify templates in this repo use this pattern:

```bash
#!/bin/bash
DESIRED='{{ dict "key" "value" | toPrettyJson }}'
if [ -s /dev/stdin ]; then
  jq -s '.[0] * .[1]' /dev/stdin <(echo "$DESIRED")
else
  echo "$DESIRED" | jq .
fi
```

The merge semantics: `jq -s '.[0] * .[1]'` does a shallow merge where DESIRED (second arg)
wins on conflicts. Keys only in the existing file are preserved.

To sync live-to-repo:

1. Read the source template to find the `DESIRED` variable (the Go template `dict` calls)
2. Read the live file to see current values
3. Compare: identify which values in DESIRED differ from live
4. Edit the Go template `dict` calls to match live values
5. If a value exists in live but NOT in DESIRED, it was preserved from the existing file — no
   template change needed
6. If a value exists in DESIRED but differs in live, update the template value
7. If unclear whether a live value should be tracked in the template, ask the user

### 3b: Chezmoi-Native Modify Templates

Some templates use the `chezmoi:modify-template` directive with format-specific functions:

- **INI format**: `fromIni`/`toIni` with `setValueAtPath` calls
- **TOML format**: `fromToml`/`toToml` with `setValueAtPath` calls

To sync live-to-repo, update the `setValueAtPath` calls to match live values, or add/remove
calls as needed.

### 3c: Permission Changes

If the diff shows a mode change (e.g., `old mode 100600` / `new mode 100644`):

```bash
# To make output mode 600 (private): add private_ to filename
mv modify_settings.json.tmpl modify_private_settings.json.tmpl

# To make output mode 644 (normal): remove private_ from filename
mv modify_private_settings.json.tmpl modify_settings.json.tmpl
```

## Step 4: Live-to-Repo Sync (Plain Files)

```bash
chezmoi re-add ~/.example/config.json
```

Verify immediately — if `chezmoi diff` still shows the file, it may actually be a template
or modify script (re-check classification).

## Shared Templates

The file `.chezmoitemplates/claude-mcp-servers.json.tmpl` is included by multiple modify
templates via `includeTemplate`. When MCP server configuration changes:

1. Determine if the change is to a shared MCP server definition (edit the shared template) or
   a file-specific setting (edit that file's template only)
2. After editing the shared template, run `chezmoi diff` with no path arguments to check for
   cascading changes in all dependent files

See `references/modify-templates.md` for the full dependency list.

## Verification

After any sync operation:

1. `chezmoi diff <path>` — expect empty output for each synced file
2. If diff persists, debug with: `chezmoi cat <path>` to see what chezmoi would produce,
   then compare with `cat <path>` (the live file)
3. For source repo changes, review `git diff` in the dotfiles directory to confirm only
   intended edits

## Anti-Patterns

- **Never `chezmoi re-add` on modify templates.** It silently does nothing or creates a plain
  file that overwrites the template logic.
- **Never assume `re-add` succeeded without verifying.** Always check `chezmoi diff` after.
- **Never edit a live file expecting `chezmoi apply` to preserve it.** Apply overwrites live
  with source state. For modify templates, it merges DESIRED into existing — but DESIRED wins.
- **Never edit the shared MCP template without checking all dependents.** Run a full
  `chezmoi diff` after changes to `.chezmoitemplates/`.

## Additional Resources

### Reference Files

- **`references/modify-templates.md`** — Complete inventory of all modify templates, their
  target files, formats, merge strategies, and shared template dependencies

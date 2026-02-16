---
name: chezmoi-helper
description: |
  Chezmoi dotfiles management - templates, scripts, multi-machine config, and CLI operations
  When user works with chezmoi, dotfiles, mentions chezmoi commands, .tmpl files, or dotfile management
---

# Chezmoi Helper Agent

## What's New

Recent chezmoi releases (latest: v2.69.3):

| Version | Key Changes |
|---------|-------------|
| **v2.69.x** | transcrypt/git-crypt encryption, Proton Pass support, TOML 1.1, `--pq` flag for age-keygen, `--include`/`--exclude` on unmanaged |
| **v2.68.x** | `--new` flag on add, `--re-encrypt` on re-add, new `edit-encrypted` command, sourceFile variable fix |
| **v2.67.x** | `re-add` manages exact_ entries, fromIni/toIni round-trip fix, non-UTF-8 template warnings |
| **v2.66.x** | `--override-data-file`/`--override-data` flags, `--less-interactive` mode, `exec` template function, grouped help output |

## Overview

Chezmoi manages dotfiles across multiple machines from a single source of truth. The source directory (default: `~/.local/share/chezmoi`) contains the declarative desired state. Run `chezmoi apply` to update the destination directory (`~`) to match.

**Core workflow:**
1. Add files: `chezmoi add ~/.gitconfig`
2. Edit source: `chezmoi edit ~/.gitconfig`
3. Preview changes: `chezmoi diff`
4. Apply changes: `chezmoi apply`
5. Commit and push: `chezmoi cd && git add . && git commit && git push`

**Source directory location:** `~/.local/share/chezmoi` (view with `chezmoi source-path`)

**Configuration file:** `~/.config/chezmoi/chezmoi.toml` (or .yaml/.json/.jsonc)

## Naming Conventions

Chezmoi maps source filenames to target filenames using prefix/suffix attributes:

### File Prefixes (applied in order)

| Source Prefix | Effect | Example |
|---------------|--------|---------|
| `create_` | Only create if target missing | `create_dot_bashrc` -> `.bashrc` |
| `modify_` | Modify script (stdin=existing, stdout=new) | `modify_dot_gitconfig` |
| `remove_` | Remove target | `remove_dot_old_config` |
| `encrypted_` | Decrypt on apply | `encrypted_private_dot_ssh/id_rsa` |
| `private_` | Set permissions 0o600/0o700 | `private_dot_ssh` |
| `readonly_` | Remove write bits | `readonly_dot_config` |
| `empty_` | Keep file even if empty | `empty_dot_placeholder` |
| `executable_` | Set executable bit | `executable_dot_local/bin/myscript` |
| `symlink_` | Create symlink (contents = target) | `symlink_dot_vimrc` |
| `dot_` | Replace with leading `.` | `dot_gitconfig` -> `.gitconfig` |
| `.tmpl` | Process as Go template | `dot_bashrc.tmpl` |

### Directory Prefixes

| Source Prefix | Effect |
|---------------|--------|
| `exact_` | Remove entries not in source |
| `private_` | Set 0o700 permissions |
| `readonly_` | Remove write bits |

### Script Prefixes

| Source Prefix | Execution |
|---------------|-----------|
| `run_` | Every `chezmoi apply` |
| `run_once_` | Once per unique content hash |
| `run_onchange_` | When content changes |
| `before_` | Before file operations |
| `after_` | After file operations |

### Combined Prefix Examples

Prefixes combine: `private_dot_config` -> `.config` (mode 0o700), `run_onchange_after_install.sh.tmpl` -> templated script that runs after apply when content changes.

## CLI Quick Reference

```bash
# Core workflow
chezmoi add ~/.gitconfig              # Add file to source state
chezmoi add --template ~/.bashrc      # Add as template
chezmoi add --encrypt ~/.ssh/id_rsa   # Add encrypted
chezmoi edit ~/.gitconfig             # Edit source state
chezmoi diff                          # Preview changes
chezmoi apply                         # Apply all changes
chezmoi apply --dry-run --verbose     # Preview without applying
chezmoi apply ~/.gitconfig            # Apply single file

# Inspection
chezmoi managed                       # List all managed files
chezmoi managed --include=files       # List only files
chezmoi unmanaged                     # List unmanaged files in ~
chezmoi data                          # Show template data
chezmoi cat ~/.gitconfig              # Show target state of file
chezmoi source-path ~/.gitconfig      # Show source path for target
chezmoi target-path ~/src/dot_git...  # Show target path for source
chezmoi doctor                        # Check for common issues

# Template debugging
chezmoi execute-template '{{ .chezmoi.os }}'
chezmoi execute-template < ~/.local/share/chezmoi/dot_bashrc.tmpl

# File management
chezmoi re-add                        # Update source from changed targets
chezmoi forget ~/.old_config          # Stop managing a file
chezmoi destroy ~/.old_config         # Remove from both source and target
chezmoi merge ~/.gitconfig            # Three-way merge conflicts
chezmoi merge-all                     # Merge all conflicts

# Source directory
chezmoi cd                            # Open shell in source dir
chezmoi git -- add .                  # Run git in source dir
chezmoi git -- commit -m "update"
chezmoi git -- push

# Setup on new machine
chezmoi init https://github.com/user/dotfiles.git
chezmoi init --apply user             # Clone and apply (shorthand for GitHub)

# Encryption
chezmoi age-keygen --output=key.txt   # Generate age key
chezmoi edit-encrypted ~/.secret      # Edit encrypted file transparently

# State management
chezmoi status                        # Show pending changes
chezmoi verify                        # Verify target matches source
chezmoi update                        # Pull and apply from remote
chezmoi state delete-bucket --bucket=scriptState  # Reset run_once_ state
```

## Template Basics

Chezmoi uses Go `text/template` syntax with sprig functions. Files ending in `.tmpl` or placed in `.chezmoitemplates/` are processed as templates.

### Common Variables

```
{{ .chezmoi.os }}              # "darwin", "linux", "windows"
{{ .chezmoi.arch }}            # "amd64", "arm64"
{{ .chezmoi.hostname }}        # Machine hostname (up to first dot)
{{ .chezmoi.username }}        # Current username
{{ .chezmoi.homeDir }}         # Home directory path
{{ .chezmoi.sourceDir }}       # Source directory path
{{ .chezmoi.kernel }}          # Kernel info (Linux only)
{{ .chezmoi.osRelease }}       # /etc/os-release data (Linux only)
```

### OS-Conditional Configuration

```
{{ if eq .chezmoi.os "darwin" -}}
# macOS-specific config
{{ else if eq .chezmoi.os "linux" -}}
# Linux-specific config
{{ end -}}
```

### Password Manager Integration (1Password)

```
{{ onepasswordRead "op://vault/item/field" }}
```

### Reusable Templates

Place shared templates in `.chezmoitemplates/` and include with:
```
{{ template "shared-config.tmpl" . }}
```

### Template Data

Define custom data in `.chezmoidata.yaml`, `.chezmoidata.toml`, or `.chezmoidata.json` at the root of the source directory. Access with `{{ .customKey }}`.

## User's Chezmoi Patterns

This repository demonstrates several chezmoi patterns:

- **OS-conditional ignoring:** `.chezmoiignore` uses templates to ignore Windows-only paths on non-Windows, and macOS-only paths on non-macOS
- **OS-conditional Brewfile:** `dot_Brewfile.tmpl` includes OS-specific Brewfile using `{{ include ".Brewfile_darwin" }}`
- **1Password integration:** `config.fish.tmpl` uses `{{ onepasswordRead "op://..." }}` with `{{ if lookPath "op" }}` guard
- **Modify scripts:** `modify_private_dot_claude.json.tmpl` reads existing JSON via stdin, merges template data, outputs modified JSON
- **Onchange scripts:** `run_onchange_after_launchagent.sh.tmpl` uses `{{ include ... | sha256sum }}` in a comment to trigger re-run when the included file changes
- **After scripts:** `run_after_sync-theme.sh.tmpl` and `run_after_generate-themes.sh.tmpl` run theme sync after every apply, guarded by OS check
- **Reusable templates:** `.chezmoitemplates/claude-mcp-servers.json.tmpl` shared across multiple config files

## Special Files and Directories

| Path | Purpose |
|------|---------|
| `.chezmoidata.yaml` (or .toml/.json) | Custom template data |
| `.chezmoiignore` | Patterns to ignore (supports templates) |
| `.chezmoitemplates/` | Reusable template fragments |
| `.chezmoiexternal.toml` | External file/archive sources |
| `.chezmoiroot` | Marks a subdirectory as the source root |
| `.chezmoiremove` | Patterns for targets to remove |
| `.chezmoiversion` | Minimum chezmoi version required |
| `.chezmoi.toml.tmpl` | Config file template (for `chezmoi init`) |

## Reference Files

- **`references/templates.md`** - Go template syntax, chezmoi template functions, conditionals, data sources, OS detection, password manager functions
- **`references/commands.md`** - Full CLI reference with flags and examples for all chezmoi commands
- **`references/advanced.md`** - External sources, encryption (age/gpg), scripts, hooks, multi-machine patterns, 1Password integration

## When to Ask for Help

Ask the user for clarification when:
- Target machine OS or architecture is ambiguous for template conditionals
- Encryption method (age vs gpg) is not specified
- Password manager choice or vault/item paths are unclear
- Script execution order requirements are complex
- External source URLs or refresh periods need confirmation
- Modify script logic for merging existing file content is non-trivial

# Chezmoi CLI Commands Reference

## Global Flags

These flags apply to all commands:

| Flag                      | Description                          |
| ------------------------- | ------------------------------------ |
| `--color auto\|on\|off`   | Colorize output                      |
| `-c, --config path`       | Config file path                     |
| `--config-format format`  | Force config format                  |
| `-D, --destination path`  | Destination directory (default: `~`) |
| `-n, --dry-run`           | Do not make changes                  |
| `--force`                 | Override safety checks               |
| `-k, --keep-going`        | Continue on errors                   |
| `--no-pager`              | Disable pager                        |
| `--no-tty`                | Do not use TTY                       |
| `-o, --output path`       | Write output to file                 |
| `-S, --source path`       | Source directory path                |
| `-v, --verbose`           | Verbose output                       |
| `-W, --working-tree path` | Working tree directory               |

## Common Flags (shared by many commands)

| Flag                  | Description                                 |
| --------------------- | ------------------------------------------- |
| `-x, --exclude types` | Exclude entry types                         |
| `-i, --include types` | Include entry types                         |
| `--init`              | Regenerate config from template first       |
| `-P, --parent-dirs`   | Include parent directories                  |
| `-r, --recursive`     | Recurse into subdirectories (default: true) |

### Entry Types for --include/--exclude

`all`, `always`, `dirs`, `encrypted`, `externals`, `files`, `remove`, `scripts`, `symlinks`, `templates`

## Core Workflow Commands

### add

Add targets to the source state. If already managed, replace source with current destination state.

```bash
chezmoi add ~/.bashrc                   # Add file
chezmoi add ~/.config/fish/             # Add directory
chezmoi add --template ~/.bashrc        # Add as template
chezmoi add --encrypt ~/.ssh/id_rsa     # Add encrypted
chezmoi add --autotemplate ~/.bashrc    # Auto-detect template variables
chezmoi add --create ~/.config/app.conf # Use create_ prefix (only create if missing)
chezmoi add --exact ~/.vim              # Use exact_ prefix (remove extra entries)
chezmoi add --new ~/.newfile            # Create new file if target doesn't exist
chezmoi add -p ~/.bashrc               # Prompt for confirmation
```

| Flag                               | Description                             |
| ---------------------------------- | --------------------------------------- |
| `-a, --autotemplate`               | Auto-generate template from config data |
| `--create`                         | Set `create_` attribute                 |
| `--encrypt`                        | Encrypt with configured method          |
| `--exact`                          | Set `exact_` attribute on directories   |
| `--follow`                         | Follow symlinks                         |
| `--new`                            | Create new file                         |
| `-p, --prompt`                     | Confirm each file interactively         |
| `-T, --template`                   | Set `.tmpl` attribute                   |
| `--template-symlinks`              | Make symlinks portable via templates    |
| `--secrets ignore\|warning\|error` | Secret detection behavior               |

### apply

Ensure targets match the target state, updating as needed. Prompts if target modified since last write.

```bash
chezmoi apply                           # Apply all
chezmoi apply ~/.bashrc                 # Apply single file
chezmoi apply --dry-run --verbose       # Preview without applying
chezmoi apply --exclude=scripts         # Skip scripts
chezmoi apply --include=files           # Only files
chezmoi apply --init                    # Regenerate config first
chezmoi apply --source-path             # Use source paths as arguments
```

### diff

Show differences between target state and destination state.

```bash
chezmoi diff                            # Diff all
chezmoi diff ~/.bashrc                  # Diff single file
chezmoi diff --reverse                  # Reverse direction
chezmoi diff --pager less               # Use specific pager
chezmoi diff --exclude=scripts          # Exclude scripts
```

| Flag                | Description                                         |
| ------------------- | --------------------------------------------------- |
| `--pager command`   | Override pager                                      |
| `--reverse`         | Show changes needed for destination to match target |
| `--script-contents` | Show script contents (default: true)                |

### edit

Edit the source state of targets. Opens editor with target filenames via hard links.

```bash
chezmoi edit ~/.bashrc                  # Edit source state
chezmoi edit --apply ~/.bashrc          # Edit and apply immediately
chezmoi edit --watch ~/.bashrc          # Auto-apply on save
chezmoi edit                            # Open source directory in editor
```

| Flag              | Description                    |
| ----------------- | ------------------------------ |
| `-a, --apply`     | Apply after editing            |
| `--hardlink bool` | Use hard links (default: true) |
| `--watch`         | Apply on file save             |

### edit-config

Edit the chezmoi configuration file.

```bash
chezmoi edit-config
```

### edit-config-template

Edit the chezmoi configuration file template (`.chezmoi.toml.tmpl`).

```bash
chezmoi edit-config-template
```

### edit-encrypted

Edit encrypted files transparently (decrypt, edit, re-encrypt).

```bash
chezmoi edit-encrypted ~/.ssh/id_rsa
```

### re-add

Update the source state to match the current destination state for files that have been modified outside chezmoi.

```bash
chezmoi re-add                          # Re-add all changed files
chezmoi re-add ~/.bashrc                # Re-add specific file
chezmoi re-add --re-encrypt             # Re-encrypt encrypted files
```

## Inspection Commands

### managed

List all entries managed by chezmoi.

```bash
chezmoi managed                         # List all managed entries
chezmoi managed --include=files         # Only files
chezmoi managed --include=dirs          # Only directories
chezmoi managed --exclude=encrypted     # Exclude encrypted
chezmoi managed --tree                  # Tree view
chezmoi managed --path-style=absolute   # Absolute paths
chezmoi managed --path-style=source-relative  # Source-relative paths
chezmoi managed -0                      # NUL-separated output
```

| Path Style        | Description                       |
| ----------------- | --------------------------------- |
| `relative`        | Relative to destination (default) |
| `absolute`        | Absolute destination paths        |
| `source-relative` | Relative to source directory      |
| `source-absolute` | Absolute source paths             |
| `all`             | All path styles                   |

### unmanaged

List files in the destination directory not managed by chezmoi.

```bash
chezmoi unmanaged                       # List unmanaged files in ~
chezmoi unmanaged ~/.config             # List unmanaged in directory
chezmoi unmanaged --include=files       # Only files (v2.69+)
chezmoi unmanaged --exclude=dirs        # Exclude directories (v2.69+)
```

### status

Show the status of managed entries (like `git status` for dotfiles).

```bash
chezmoi status                          # Show all pending changes
chezmoi status --include=files          # Only files
chezmoi status --path-style=absolute    # Absolute paths
```

Status codes: `A` (added), `D` (deleted), `M` (modified), `R` (running script).

### cat

Print the target state of a file.

```bash
chezmoi cat ~/.bashrc                   # Show what apply would write
```

### data

Print the available template data.

```bash
chezmoi data                            # JSON format
chezmoi data --format=yaml              # YAML format
```

### dump

Dump the target state as JSON or YAML.

```bash
chezmoi dump                            # Dump all
chezmoi dump ~/.bashrc                  # Dump specific file
chezmoi dump --format=yaml              # YAML format
```

### dump-config

Dump the current configuration.

```bash
chezmoi dump-config
chezmoi dump-config --format=yaml
```

### source-path

Print the source path for a target.

```bash
chezmoi source-path ~/.bashrc
```

### target-path

Print the target path for a source path.

```bash
chezmoi target-path ~/.local/share/chezmoi/dot_bashrc
```

### verify

Verify that all targets match the target state. Exit code 0 if everything matches, 1 if differences exist.

```bash
chezmoi verify
chezmoi verify ~/.bashrc
```

## Setup Commands

### init

Set up the source directory, generate config, optionally apply.

```bash
chezmoi init                            # Initialize empty
chezmoi init user                       # Clone from github.com/user/dotfiles
chezmoi init user/repo                  # Clone from github.com/user/repo
chezmoi init --apply user               # Clone and apply
chezmoi init --ssh user                 # Use SSH instead of HTTPS
chezmoi init --branch feature           # Checkout specific branch
chezmoi init --depth 1                  # Shallow clone
chezmoi init --one-shot user            # Apply then remove chezmoi
chezmoi init --purge --force            # Remove source + config dirs
```

| Flag                     | Description                   |
| ------------------------ | ----------------------------- |
| `-a, --apply`            | Apply after init              |
| `--branch name`          | Git branch to checkout        |
| `-d, --depth int`        | Git clone depth               |
| `--ssh`                  | Use SSH URLs                  |
| `--one-shot`             | Apply, then purge everything  |
| `-p, --purge`            | Remove source and config dirs |
| `--purge-binary`         | Remove chezmoi binary         |
| `--guess-repo-url=false` | Disable URL guessing          |
| `--prompt*`              | Pre-populate template prompts |

### update

Pull changes from remote and apply.

```bash
chezmoi update                          # Pull and apply
chezmoi update --apply=false            # Pull without applying
chezmoi update --init                   # Regenerate config first
```

## File Management Commands

### forget

Remove targets from the source state (stop managing them) without removing the actual files.

```bash
chezmoi forget ~/.old_config
```

### destroy

Remove targets from both source and destination.

```bash
chezmoi destroy ~/.old_config
```

### merge

Three-way merge when target has been modified outside chezmoi.

```bash
chezmoi merge ~/.bashrc                 # Merge single file
chezmoi merge-all                       # Merge all conflicts
```

### import

Import an archive into the source state.

```bash
chezmoi import --destination ~/.oh-my-zsh archive.tar.gz
chezmoi import --strip-components 1 archive.tar.gz
```

### archive

Generate an archive of the target state.

```bash
chezmoi archive                         # tar to stdout
chezmoi archive --format=zip            # zip format
chezmoi archive --output=dotfiles.tar.gz # Write to file
```

## Git Integration Commands

### cd

Open a shell in the source directory.

```bash
chezmoi cd
```

### git

Run git commands in the source directory.

```bash
chezmoi git -- status
chezmoi git -- add .
chezmoi git -- commit -m "update dotfiles"
chezmoi git -- push
chezmoi git -- pull
chezmoi git -- log --oneline -10
```

## Template Commands

### execute-template

Execute a template and print the result.

```bash
chezmoi execute-template '{{ .chezmoi.os }}'
chezmoi execute-template '{{ .chezmoi.hostname }}'
chezmoi execute-template < file.tmpl
chezmoi execute-template --init < .chezmoi.toml.tmpl  # Test init template
chezmoi execute-template --override-data-file data.yaml '{{ .key }}'
```

### chattr

Change file attributes in the source state.

```bash
chezmoi chattr +template ~/.bashrc      # Make template
chezmoi chattr -template ~/.bashrc      # Remove template attribute
chezmoi chattr +encrypted ~/.secret     # Set encrypted
chezmoi chattr +private ~/.ssh/config   # Set private
chezmoi chattr +executable ~/bin/script # Set executable
chezmoi chattr +exact ~/.config/dir     # Set exact
chezmoi chattr +create ~/.config/app    # Set create
```

## Encryption Commands

### age-keygen

Generate a new age key.

```bash
chezmoi age-keygen --output=key.txt
chezmoi age-keygen --output=key.txt --pq  # Post-quantum key (v2.69+)
```

### encrypt / decrypt

Encrypt or decrypt stdin.

```bash
chezmoi encrypt < secret.txt > encrypted.txt
chezmoi decrypt < encrypted.txt > secret.txt
```

## Diagnostics

### doctor

Check for potential problems with the chezmoi configuration.

```bash
chezmoi doctor
```

Reports on: chezmoi version, config file, source directory, destination directory, git, encryption tools, password managers, shell, editor, etc.

### state

Manage chezmoi's persistent state database.

```bash
chezmoi state dump                      # Dump all state
chezmoi state get --bucket=entryState --key=path  # Get specific entry
chezmoi state delete-bucket --bucket=scriptState   # Reset run_once_ state
chezmoi state delete-bucket --bucket=entryState    # Reset run_onchange_ state
chezmoi state reset                     # Reset all state
```

### completion

Generate shell completion scripts.

```bash
chezmoi completion bash > /etc/bash_completion.d/chezmoi
chezmoi completion zsh > ~/.zsh/completions/_chezmoi
chezmoi completion fish > ~/.config/fish/completions/chezmoi.fish
```

## Configuration Options

### Auto-commit and Auto-push

```toml
# ~/.config/chezmoi/chezmoi.toml
[git]
    autoCommit = true
    autoPush = true
    commitMessageTemplate = "chezmoi: update {{ .path }}"
```

### Diff and Merge Tools

```toml
[diff]
    command = "delta"
    pager = "delta"

[merge]
    command = "nvim"
    args = ["-d", "{{ .Destination }}", "{{ .Source }}", "{{ .Target }}"]
```

### Script Environment

```toml
[scriptEnv]
    MY_VAR = "value"
    ANOTHER = "value2"
```

### Editor

```toml
[edit]
    command = "code"
    args = ["--wait"]
```

### Interpreters

```toml
[interpreters.py]
    command = "python3"

[interpreters.ps1]
    command = "pwsh"
    args = ["-NoLogo"]
```

### Progress Bar

```toml
[progress]
    enabled = true
```

## Common Workflows

### New Machine Setup

```bash
# One-liner: install chezmoi, clone dotfiles, apply
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply user

# Or step by step:
chezmoi init user                       # Clone dotfiles repo
chezmoi diff                            # Preview what will change
chezmoi apply                           # Apply the changes
```

### Daily Dotfiles Workflow

```bash
# After editing config files directly:
chezmoi re-add                          # Sync changes back to source
chezmoi cd                              # Enter source directory
git add . && git commit -m "update"     # Commit
git push                                # Push to remote

# Or use auto-commit:
chezmoi edit --apply ~/.gitconfig       # Edit and auto-apply
# (auto-commit and auto-push if configured)
```

### Pull Changes on Another Machine

```bash
chezmoi update                          # git pull + apply
# Or manually:
chezmoi git -- pull
chezmoi diff                            # Review changes
chezmoi apply                           # Apply them
```

### Adding a New Config File

```bash
# Simple file
chezmoi add ~/.config/starship.toml

# File that varies by machine (make it a template)
chezmoi add --template ~/.bashrc

# Private file (SSH keys, credentials)
chezmoi add --encrypt ~/.ssh/id_ed25519

# Directory with exact contents (remove extra files)
chezmoi add --exact --recursive ~/.config/fish

# File that should exist but may be empty
chezmoi chattr +empty ~/.hushlogin
```

### Debugging a Broken Template

```bash
# Check template syntax
chezmoi execute-template < ~/.local/share/chezmoi/dot_bashrc.tmpl

# See what data is available
chezmoi data | less

# Preview the rendered output
chezmoi cat ~/.bashrc

# Compare rendered vs actual
chezmoi diff ~/.bashrc

# Apply with verbose output
chezmoi apply --verbose --dry-run ~/.bashrc
```

### Moving from One Password Manager to Another

```bash
# 1. Update templates to use new password manager functions
chezmoi edit ~/.config/fish/config.fish

# 2. Test the template renders correctly
chezmoi cat ~/.config/fish/config.fish

# 3. Preview and apply
chezmoi diff
chezmoi apply
```

### Handling Merge Conflicts

When a target file has been modified outside chezmoi:

```bash
# See what conflicts exist
chezmoi status

# Three-way merge for a specific file
chezmoi merge ~/.gitconfig

# Merge all conflicts
chezmoi merge-all

# Or force overwrite (use with caution)
chezmoi apply --force ~/.gitconfig
```

### Removing a Managed File

```bash
# Stop managing but keep the file
chezmoi forget ~/.old_config

# Remove from both source and destination
chezmoi destroy ~/.old_config

# Or add to .chezmoiremove for declarative removal
echo ".old_config" >> $(chezmoi source-path)/.chezmoiremove
```

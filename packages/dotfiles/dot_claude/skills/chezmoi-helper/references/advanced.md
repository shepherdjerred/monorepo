# Chezmoi Advanced Features Reference

## External Sources (.chezmoiexternal)

Manage files from external sources (archives, git repos, HTTP) without committing them to the source directory. Configure in `.chezmoiexternal.toml` (or .yaml/.json) at the source root.

### Archive External

Download and extract archives (tar.gz, tar.bz2, tar.xz, tar.zst, zip):

```toml
[".oh-my-zsh"]
    type = "archive"
    url = "https://github.com/ohmyzsh/ohmyzsh/archive/master.tar.gz"
    exact = true
    stripComponents = 1
    refreshPeriod = "168h"  # Re-download weekly
```

### Single File External

Download individual files:

```toml
[".vim/autoload/plug.vim"]
    type = "file"
    url = "https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim"
    refreshPeriod = "168h"
```

### Archive File Extraction

Extract a single file from an archive:

```toml
[".local/bin/gh"]
    type = "archive-file"
    url = "https://github.com/cli/cli/releases/download/v{{ .ghVersion }}/gh_{{ .ghVersion }}_{{ .chezmoi.os }}_{{ .chezmoi.arch }}.tar.gz"
    path = "gh_{{ .ghVersion }}_{{ .chezmoi.os }}_{{ .chezmoi.arch }}/bin/gh"
    executable = true
    refreshPeriod = "168h"
```

### Git Repository External

Clone or pull git repositories:

```toml
[".tmux/plugins/tpm"]
    type = "git-repo"
    url = "https://github.com/tmux-plugins/tpm.git"
    refreshPeriod = "168h"
```

### External Configuration Options

| Option | Description |
|--------|-------------|
| `type` | `archive`, `archive-file`, `file`, `git-repo` |
| `url` | URL (supports templates) |
| `refreshPeriod` | How often to re-download (e.g., `"168h"` = weekly, `"720h"` = monthly) |
| `stripComponents` | Strip leading path components from archive |
| `exact` | Set exact_ attribute on extracted directory |
| `include` | Glob patterns for files to include |
| `exclude` | Glob patterns for files to exclude |
| `executable` | Set executable bit on extracted file |
| `encrypted` | File is encrypted |
| `filter.command` | Command to filter/decompress before extraction |
| `filter.args` | Arguments for filter command |
| `checksum.sha256` | Expected SHA-256 hash for verification |

### Performance Note

Avoid externals for large files. Chezmoi validates exact contents on every `diff`, `apply`, and `verify`. Use `run_onchange_` scripts for large downloads instead.

### Subdirectory Externals

Place `.chezmoiexternal.toml` in subdirectories. Paths are relative to that subdirectory:

```
# In private_dot_config/.chezmoiexternal.toml
["."]
    type = "archive"
    url = "https://example.com/config.tar.gz"
```

### external_ Directory Attribute

Apply `external_` prefix to directories containing non-chezmoi-formatted filenames (like cloned repos) to prevent chezmoi from misinterpreting them:

```
# Source directory
external_dot_oh-my-zsh/
```

## Encryption

### Age Encryption

Age is the recommended encryption method. Chezmoi includes a builtin age implementation.

**Generate key:**
```bash
chezmoi age-keygen --output=$HOME/key.txt
# Post-quantum key (v2.69+):
chezmoi age-keygen --output=$HOME/key.txt --pq
```

**Configure:**
```toml
# ~/.config/chezmoi/chezmoi.toml
encryption = "age"
[age]
    identity = "/home/user/key.txt"
    recipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
```

**Multiple keys:**
```toml
encryption = "age"
[age]
    identities = ["/home/user/key1.txt", "/home/user/key2.txt"]
    recipients = ["age1...", "age1..."]
```

**Symmetric encryption (passphrase):**
```toml
encryption = "age"
[age]
    passphrase = true
```

**SSH key as identity:**
```toml
encryption = "age"
[age]
    identity = "~/.ssh/id_ed25519"
    recipient = "ssh-ed25519 AAAA..."
```

### GPG Encryption

```toml
encryption = "gpg"
[gpg]
    recipient = "user@example.com"
```

**Symmetric GPG:**
```toml
encryption = "gpg"
[gpg]
    symmetric = true
```

### Transcrypt and git-crypt (v2.69+)

Chezmoi v2.69+ supports transparent encryption via transcrypt and git-crypt, which encrypt files in the git repository.

### Using Encrypted Files

```bash
# Add encrypted file
chezmoi add --encrypt ~/.ssh/id_rsa

# Edit encrypted file (auto decrypt/re-encrypt)
chezmoi edit ~/.ssh/id_rsa

# Edit encrypted file with dedicated command
chezmoi edit-encrypted ~/.ssh/id_rsa

# Change attribute to encrypted
chezmoi chattr +encrypted ~/.ssh/id_rsa

# Re-encrypt after key change
chezmoi re-add --re-encrypt
```

Encrypted files are stored in the source directory with the `encrypted_` prefix in ASCII-armored format.

## Scripts

### Script Types

| Type | Behavior | Use Case |
|------|----------|----------|
| `run_` | Runs every `chezmoi apply` | Theme sync, environment setup |
| `run_once_` | Runs once per unique content hash | Package installation, initial setup |
| `run_onchange_` | Runs when content changes | Config reload, service restart |

### Execution Timing

| Attribute | Timing |
|-----------|--------|
| `before_` | Before file operations |
| `after_` | After file operations |
| _(none)_ | During file operations (alphabetical order) |

### Script Naming Pattern

```
run_[once_|onchange_][before_|after_]<name>[.tmpl]
```

Examples:
```
run_once_before_install-packages.sh          # Run once before apply
run_onchange_after_reload-config.sh.tmpl     # Run after apply when changed
run_after_sync-theme.sh.tmpl                 # Run every apply, after files
```

### Environment Variables

Chezmoi automatically sets these in script environments:

| Variable | Value |
|----------|-------|
| `CHEZMOI` | `1` |
| `CHEZMOI_OS` | Operating system |
| `CHEZMOI_ARCH` | Architecture |
| `CHEZMOI_ARGS` | chezmoi command arguments |
| `CHEZMOI_COMMAND` | Current chezmoi command |
| `CHEZMOI_CACHE_DIR` | Cache directory |
| `CHEZMOI_CONFIG_FILE` | Config file path |
| `CHEZMOI_HOME_DIR` | Home directory |
| `CHEZMOI_SOURCE_DIR` | Source directory |
| `CHEZMOI_SOURCE_PATH` | Script source path |
| `CHEZMOI_WORKING_TREE` | Working tree path |

Custom variables via config:
```toml
[scriptEnv]
    MY_VAR = "value"
```

### Templated Scripts

Scripts ending in `.tmpl` are processed as templates before execution. A script that resolves to empty/whitespace-only content is skipped:

```bash
#!/bin/bash
{{ if eq .chezmoi.os "darwin" -}}
brew bundle --file="{{ .chezmoi.sourceDir }}/dot_Brewfile"
{{ end -}}
```

### Onchange Trigger Pattern

Include a hash of a dependency file in a comment to trigger re-execution when that file changes:

```bash
#!/bin/bash
# {{ include "path/to/watched-file" | sha256sum }}
# This script re-runs whenever watched-file changes
launchctl bootout gui/$(id -u) "$PLIST" 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$PLIST"
```

### Script Idempotency

All scripts should be idempotent. Even `run_once_` scripts may re-execute if state is reset. Use guards:

```bash
#!/bin/bash
# Only install if not present
command -v ripgrep &>/dev/null || cargo install ripgrep
```

### Resetting Script State

```bash
# Reset run_once_ tracking (re-run all run_once_ scripts)
chezmoi state delete-bucket --bucket=scriptState

# Reset run_onchange_ tracking (re-run all run_onchange_ scripts)
chezmoi state delete-bucket --bucket=entryState
```

### Dry Run Behavior

In `--dry-run` mode, scripts are NOT executed. Use `--verbose` to see script contents that would run.

## Modify Scripts

Modify scripts receive the existing target file contents on stdin and write the new contents to stdout. Name them with `modify_` prefix.

### Python Modify Script

```python
#!/usr/bin/env python3
import sys, json

# Read existing file
data = json.load(sys.stdin)

# Modify
data["settings"]["theme"] = "dark"

# Write back
json.dump(data, sys.stdout, indent=2)
```

### Shell Modify Script

```bash
#!/bin/bash
# Read existing content, append a line
cat
echo "# Added by chezmoi"
```

### Templated Modify Script

Modify scripts can be templates (`.tmpl` suffix). The existing file content is available via stdin, not template variables:

```python
#!/usr/bin/env python3
import sys, json
data = json.load(sys.stdin)
data["mcpServers"] = {{ template "mcp-servers.json.tmpl" . }}
json.dump(data, sys.stdout, indent=2)
```

## Multi-Machine Management

### OS Detection Patterns

```
{{ if eq .chezmoi.os "darwin" -}}
# macOS
{{ else if eq .chezmoi.os "linux" -}}
  {{ if eq .chezmoi.osRelease.id "ubuntu" -}}
  # Ubuntu
  {{ else if eq .chezmoi.osRelease.id "fedora" -}}
  # Fedora
  {{ else if eq .chezmoi.osRelease.id "arch" -}}
  # Arch Linux
  {{ end -}}
{{ else if eq .chezmoi.os "windows" -}}
# Windows
{{ end -}}
```

### Architecture Detection

```
{{ if eq .chezmoi.arch "amd64" -}}
ARCH=x86_64
{{ else if eq .chezmoi.arch "arm64" -}}
ARCH=aarch64
{{ end -}}
```

### Hostname-Based Configuration

```
{{ if eq .chezmoi.hostname "work-laptop" -}}
# Work configuration
{{ else if eq .chezmoi.hostname "home-desktop" -}}
# Home configuration
{{ end -}}
```

### Machine-Type Classification via Data

Define machine types in `.chezmoidata.yaml`:

```yaml
machineType: "personal"  # or "work", "server"
```

Or prompt during `chezmoi init` via `.chezmoi.toml.tmpl`:

```toml
[data]
    machineType = {{ promptChoice "Machine type" (list "personal" "work" "server") | quote }}
```

Use in templates:
```
{{ if eq .machineType "work" -}}
export HTTP_PROXY="http://proxy.corp.com:8080"
{{ end -}}
```

### Conditional File Ignoring

Use `.chezmoiignore` with templates to skip entire file trees per OS:

```
{{ if ne .chezmoi.os "darwin" }}
Library/
.Brewfile_darwin
{{ end }}

{{ if ne .chezmoi.os "windows" }}
AppData/
{{ end }}

{{ if ne .machineType "work" }}
.config/corporate/
{{ end }}
```

## 1Password Integration

### Reading Secrets

```
{{ onepasswordRead "op://vault/item/field" }}
```

The `op://` URI format: `op://<vault>/<item>/<field>`

### Reading Full Items

```
{{ (onepassword "item-uuid").fields }}
{{ (onepassword "item-name" "vault-name").details.password }}
```

### Conditional on CLI Availability

Guard 1Password calls behind `lookPath` to avoid errors when `op` CLI is not installed:

```
{{ if lookPath "op" -}}
export SECRET='{{ onepasswordRead "op://vault/item/field" }}'
{{ else -}}
# op CLI not available
{{ end -}}
```

### Document Retrieval

```
{{ onepasswordDocument "document-uuid" }}
{{ onepasswordDocument "document-uuid" "vault-name" }}
```

## Hooks (v2.51+)

Hooks execute commands before or after chezmoi operations.

```toml
# ~/.config/chezmoi/chezmoi.toml
[hooks.read-source-state.pre]
    command = "echo"
    args = ["reading source state"]

[hooks.apply.post]
    command = "/path/to/script.sh"

[hooks.diff.pre]
    command = "echo"
    args = ["about to diff"]
```

Hook types: `read-source-state`, `apply`, `diff`.

## Config File Template (.chezmoi.toml.tmpl)

Create `.chezmoi.toml.tmpl` in the source root to prompt users during `chezmoi init`:

```toml
[data]
    email = {{ promptString "Email address" | quote }}
    machineType = {{ promptChoice "Machine type" (list "personal" "work" "server") | quote }}

{{ if stdinIsATTY -}}
    enableSecrets = {{ promptBool "Enable 1Password integration" }}
{{ else -}}
    enableSecrets = false
{{ end -}}
```

### Prompt Functions

| Function | Description |
|----------|-------------|
| `promptString "prompt"` | Prompt for string, return default if non-interactive |
| `promptString "prompt" "default"` | Prompt with default value |
| `promptBool "prompt"` | Prompt for yes/no |
| `promptBool "prompt" true` | Prompt with default |
| `promptChoice "prompt" choices` | Prompt with choices |
| `promptInt "prompt"` | Prompt for integer |
| `stdinIsATTY` | Check if running interactively |

### One-Shot Setup

Install dotfiles on a new machine in one command:

```bash
chezmoi init --one-shot user
# Equivalent to:
# chezmoi init user
# chezmoi apply
# chezmoi purge --force
# rm $(which chezmoi)
```

### Branch-Based Setup

```bash
chezmoi init --branch work user        # Use work branch
chezmoi init --apply --branch work user # Clone work branch and apply
```

## Symlink Mode

Convert all regular files to symlinks pointing to the source directory:

```toml
# ~/.config/chezmoi/chezmoi.toml
mode = "symlink"
```

Excluded from symlink mode: encrypted files, executables, private files, templates. These remain as regular copies.

## Remove Patterns (.chezmoiremove)

List target patterns to remove. Processed during `chezmoi apply`:

```
.old_bashrc
.config/obsolete-tool/
```

Use with caution. Test with `chezmoi apply --dry-run --verbose` first.

## Minimum Version (.chezmoiversion)

Specify minimum chezmoi version required:

```
2.69.0
```

If the running chezmoi is older, it refuses to operate.

## Source Root (.chezmoiroot)

Place `.chezmoiroot` in a subdirectory to mark it as the actual source root. Useful for keeping non-chezmoi files at the repo root:

```
# Repo structure:
# README.md
# LICENSE
# home/           <- actual chezmoi source
# home/.chezmoiroot
```

Content of `.chezmoiroot`:
```
home
```

## Troubleshooting

### Common Issues

**Template syntax error:**
```bash
chezmoi execute-template < problematic-file.tmpl
# Shows error with line number
```

**File not being managed:**
```bash
chezmoi managed | grep filename
chezmoi doctor  # Check for issues
```

**Script not running:**
```bash
chezmoi state dump | grep script-name
chezmoi state delete-bucket --bucket=scriptState  # Reset run_once_
```

**Encryption issues:**
```bash
chezmoi doctor  # Checks age/gpg availability
chezmoi decrypt < encrypted-file  # Test decryption
```

### Debug Mode

```bash
chezmoi apply --verbose --dry-run      # See what would happen
chezmoi diff --verbose                 # Detailed diff output
chezmoi doctor                         # Full diagnostic
```

## Data Override Flags (v2.66+)

Override template data at runtime without modifying data files:

```bash
# Override from a YAML/TOML/JSON file
chezmoi apply --override-data-file overrides.yaml

# Override inline
chezmoi apply --override-data 'machineType=work'
chezmoi diff --override-data 'email=alt@example.com'
```

Useful for testing templates with different data values before committing changes to `.chezmoidata.*`.

## Less-Interactive Mode (v2.66+)

Reduce prompts during apply. Only prompt when there are actual conflicts:

```toml
# ~/.config/chezmoi/chezmoi.toml
[apply]
    lessInteractive = true
```

Or per-invocation:

```bash
chezmoi apply --less-interactive
```

## Auto-Commit and Auto-Push

Configure chezmoi to automatically commit and push changes to git:

```toml
# ~/.config/chezmoi/chezmoi.toml
[git]
    autoCommit = true
    autoPush = true
    commitMessageTemplate = "chezmoi: update"
```

With auto-commit enabled, `chezmoi add`, `chezmoi edit`, `chezmoi chattr`, `chezmoi forget`, and `chezmoi remove` all auto-commit. With auto-push, these commits are pushed to the remote.

## Interpreters

Configure interpreters for scripts on different platforms:

```toml
# ~/.config/chezmoi/chezmoi.toml
[interpreters.py]
    command = "python3"

[interpreters.ps1]
    command = "pwsh"
    args = ["-NoLogo"]
```

This allows cross-platform scripts: `.ps1` scripts use PowerShell, `.py` scripts use Python.

## Password Manager Details

### Bitwarden

```toml
# Config for Bitwarden session
[bitwarden]
    command = "bw"
```

Template usage:
```
{{ (bitwarden "item" "item-id").login.password }}
{{ (bitwardenFields "item" "item-id").custom_field.value }}
```

### Bitwarden via rbw

```
{{ rbw "item-name" }}
{{ (rbwFields "item-name").notes }}
```

### pass (Password Store)

```
{{ pass "email/work" }}
{{ (passFields "ssh/server").password }}
{{ passRaw "binary-secret" }}
```

### Doppler

```toml
[doppler]
    project = "my-project"
    config = "production"
```

```
{{ doppler "SECRET_NAME" }}
{{ (dopplerProjectJson).SECRET_NAME.computed }}
```

### AWS Secrets Manager

```
{{ awsSecretsManager "my-secret-name" }}
{{ awsSecretsManagerRaw "my-binary-secret" }}
```

### KeePassXC

```
{{ keepassxc "entry-name" }}
{{ keepassxcAttribute "entry-name" "custom-attr" }}
{{ keepassxcAttachment "entry-name" "attachment-name" }}
```

## Exec Template Function (v2.66+)

Run commands within templates and use the output:

```
{{ exec "hostname" (list "-f") }}
{{ exec "git" (list "rev-parse" "--short" "HEAD") }}
```

Unlike `output`, `exec` checks exit codes and fails on non-zero.

## Complete Multi-Machine Example

This example shows a full multi-machine setup for managing dotfiles across a macOS laptop, Linux desktop, and Linux server.

### Source Directory Layout

```
~/.local/share/chezmoi/
  .chezmoi.toml.tmpl              # Init prompts
  .chezmoidata.yaml               # Shared data
  .chezmoiignore                  # OS-conditional ignoring
  .chezmoitemplates/
    ssh-host.tmpl                 # Reusable SSH host block
  dot_gitconfig.tmpl              # OS-conditional git config
  dot_Brewfile.tmpl               # OS-conditional Brewfile
  .Brewfile_darwin                # macOS Brew packages
  .Brewfile_linux                 # Linux Brew packages
  private_dot_ssh/
    config.tmpl                   # SSH config with host blocks
  private_dot_config/
    private_fish/
      config.fish.tmpl            # Shell with conditional secrets
  run_once_before_install.sh.tmpl # Package installation
  run_after_configure.sh.tmpl     # Post-apply configuration
  encrypted_private_dot_ssh/
    id_ed25519                    # Encrypted SSH key
```

### Init Template (.chezmoi.toml.tmpl)

```toml
{{ $email := promptString "Email" -}}
{{ $machineType := promptChoice "Machine type" (list "personal" "work" "server") -}}

[data]
    email = {{ $email | quote }}
    machineType = {{ $machineType | quote }}
{{ if eq $machineType "work" }}
[data.work]
    proxy = {{ promptString "HTTP proxy (empty for none)" "" | quote }}
{{ end }}

encryption = "age"
[age]
    identity = {{ joinPath .chezmoi.homeDir "key.txt" | quote }}
    recipient = "age1..."
```

### Package Install Script (run_once_before_install.sh.tmpl)

```bash
#!/bin/bash
{{ if eq .chezmoi.os "darwin" -}}
# Install Homebrew if missing
if ! command -v brew &>/dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
brew bundle --file="{{ .chezmoi.sourceDir }}/dot_Brewfile" --no-lock
{{ else if eq .chezmoi.os "linux" -}}
{{ if or (eq .chezmoi.osRelease.id "ubuntu") (eq .chezmoi.osRelease.id "debian") -}}
sudo apt-get update
sudo apt-get install -y git curl fish
{{ else if eq .chezmoi.osRelease.id "fedora" -}}
sudo dnf install -y git curl fish
{{ else if eq .chezmoi.osRelease.id "arch" -}}
sudo pacman -Syu --noconfirm git curl fish
{{ end -}}
{{ end -}}
```

This pattern keeps the installation idempotent by using package managers that handle already-installed packages gracefully.

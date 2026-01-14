# Clauderon Container Image Compatibility Guide

This guide explains what container images need to work with Clauderon. Requirements are derived from Clauderon's codebase behavior, not assumptions or preferences.

## TL;DR - Quick Requirements

Your image MUST have:

1. **`claude` OR `codex`** executable in PATH
2. **`bash`** shell (not just `/bin/sh`)
3. **Writable `/workspace`** directory
4. **`curl`** binary
5. **Standard Unix utilities**: `mkdir`, `chmod`, `cat`, `date`

Strongly recommended:
- **`git`** CLI (for git operations from within sessions)

Everything else (dev tools, shell preferences, package managers) is your choice.

## What Clauderon Does

Understanding what Clauderon does helps explain why these requirements exist:

- Creates a Docker container or Kubernetes pod
- Runs `claude` (or `codex`) as the main command, wrapped in a shell script
- Sets `HOME=/workspace` and mounts your session's git worktree there
- Mounts cache volumes for Rust builds (`/workspace/.cargo/`, `/workspace/.cache/sccache/`)
- Mounts configuration files to `/etc/clauderon/` (proxy CA cert, Codex/Talos configs)
- Installs Claude Code hooks that report events back to the host via HTTP
- Sets environment variables for proxy, git config, and credential placeholders
- Uses `--user $(id -u):$(id -g)` so files have correct ownership

## Core Requirements (REQUIRED)

These are hard requirements - without them, Clauderon sessions won't work.

### 1. `claude` or `codex` executable

**Why**: Clauderon runs this as the container's main command.

**Source**: `src/backend/docker.rs:61`, `src/backend/k8s.rs`

**What to do**: Install the Claude Code CLI or Codex CLI and ensure it's in PATH (typically `/usr/local/bin/claude` or `/usr/local/bin/codex`).

### 2. `bash` shell

**Why**: The hooks system requires bash specifically, not just `/bin/sh`.

**Details**:
- Hooks run via `bash -c '/workspace/.clauderon/hooks/send_status.sh <event>'`
- The hook script uses bash-isms like `set -euo pipefail` (pipefail is not in POSIX sh)
- Hook installation uses bash for heredoc file writing

**Source**: `src/hooks/installer.rs:12` (hook invocation), line 64 (shebang), line 75 (pipefail)

**Important**: Images with only `/bin/sh` (like Alpine Linux without bash) won't work. If using Alpine, you must `apk add bash`.

### 3. Writable `/workspace` directory

**Why**: Clauderon sets `HOME=/workspace`, and Claude/Codex need to write configuration, history, and cache files.

**Source**: Environment variables in all backends

**What Clauderon writes**:
- `/workspace/.claude/` - Claude Code config and session history
- `/workspace/.codex/` - Codex session data
- `/workspace/.cargo/`, `/workspace/.cache/sccache/` - Rust build caches
- `/workspace/.clauderon/hooks/` - Hook scripts

### 4. `curl` binary

**Why**: The hooks system uses curl to POST events back to the Clauderon daemon on the host.

**Source**: `src/hooks/installer.rs:98` (send_status.sh script uses curl)

**Usage**: `curl -s -X POST -H "Content-Type: application/json" -d "$MESSAGE" "http://host.docker.internal:${CLAUDERON_HTTP_PORT}/api/hooks"`

### 5. Standard Unix utilities

**Why**: Hook installation and script execution need these.

**Required utilities**:
- `mkdir` - Create directories (hook installation)
- `chmod` - Make scripts executable (hook installation)
- `cat` - Write files via heredoc (hook script)
- `date` - Timestamp generation with `-u` flag (hook script)

**Source**: `src/hooks/installer.rs` (mkdir line 133, chmod line 179), hook script (cat, date)

**Note**: These are present in all standard base images (Debian, Ubuntu, Alpine, etc.). Only the most minimal images might lack them.

## Strongly Recommended (but not required)

### `git` CLI

**Why**: For git operations from within sessions (commit, push, branch, etc.).

**Note**: Clauderon creates git worktrees on the HOST, but you'll want git inside the container for actual development work.

**If missing**: Sessions will start fine, but git commands won't work inside the container.

## What Image Does NOT Need

These are common assumptions that are actually wrong. Clauderon handles these for you:

### ❌ User/UID Configuration

**Don't**: Create specific users or set UIDs in your Dockerfile.

**Why**: Clauderon uses `--user $(id -u):$(id -g)` to run the container as your host user, ensuring correct file ownership.

### ❌ Network Configuration

**Don't**: Configure `host.docker.internal` resolution or add host entries.

**Why**: Clauderon adds `--add-host host.docker.internal:host-gateway` automatically.

### ❌ Proxy Setup

**Don't**: Set `HTTP_PROXY`, `HTTPS_PROXY`, or `NO_PROXY` in your image.

**Why**: Clauderon sets these environment variables dynamically based on proxy configuration.

### ❌ Volume/Cache Directories

**Don't**: Pre-create `/workspace/.cargo/` or other cache directories.

**Why**: Clauderon mounts these as named volumes. Docker creates them automatically with appropriate permissions.

## Special Case: Rust Development

Clauderon has Rust-specific optimizations built-in, even if you don't use Rust.

### What Clauderon does for Rust (always)

- Sets `CARGO_HOME=/workspace/.cargo`
- Sets `RUSTC_WRAPPER=sccache`
- Sets `SCCACHE_DIR=/workspace/.cache/sccache`
- Mounts named volumes: `clauderon-cargo-registry`, `clauderon-cargo-git`, `clauderon-sccache`
- Checks if `sccache` exists (warns if missing, but continues)

### If you're building Rust projects

Install these in your image:
- Rust toolchain (rustup, cargo, rustc)
- `sccache` for faster compilation
- C/C++ compiler (gcc/clang) for native dependencies

### If you're NOT building Rust

- Ignore this entirely
- Cache volumes will still be mounted (harmlessly)
- sccache warnings can be safely ignored

## Minimal Dockerfile Example

Here's a minimal Dockerfile that meets all requirements:

```dockerfile
FROM debian:bookworm-slim

# Install core requirements
RUN apt-get update && apt-get install -y \
    bash \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
# (Replace with your preferred installation method)
RUN curl -fsSL https://install.claude.ai/cli.sh | sh

# Set working directory
# Clauderon will mount the session worktree here
WORKDIR /workspace

# Default to bash
# Clauderon will override this with the claude/codex command
CMD ["/bin/bash"]
```

**Note**: You don't need to create users, set HOME, or configure networking - Clauderon handles all that.

For more complete examples, see [`examples/`](../examples/).

## Troubleshooting

### Hooks fail with "/bin/bash: not found"

**Problem**: Your image only has `/bin/sh` (common with Alpine Linux).

**Solution**: Install bash. For Alpine: `RUN apk add bash`

### "claude: command not found"

**Problem**: Claude CLI not installed or not in PATH.

**Solution**:
1. Verify installation: `docker run --rm your-image:latest which claude`
2. Ensure claude is in `/usr/local/bin/` or another directory in PATH
3. Check that the binary is executable: `chmod +x /usr/local/bin/claude`

### Permission denied writing to /workspace

**Problem**: Container user doesn't have write access.

**Solution**: This shouldn't happen - Clauderon uses `--user $(id -u):$(id -g)`. If it does:
1. Verify your image doesn't set a specific USER in the Dockerfile
2. Check that `/workspace` isn't owned by a specific user in the image
3. Ensure the parent directory has appropriate permissions

### Git operations fail

**Problem**: Git not installed or parent `.git` directory not accessible.

**Solution**:
1. Install git: `apt-get install git` or `apk add git`
2. Verify Clauderon mounted the parent `.git` directory correctly
3. Check git config: `git config --list`

### Proxy certificate errors (HTTPS requests fail)

**Problem**: Tools don't respect the custom CA certificate.

**Solution**: Clauderon sets these environment variables:
- `SSL_CERT_FILE=/etc/clauderon/proxy-ca.pem`
- `NODE_EXTRA_CA_CERTS=/etc/clauderon/proxy-ca.pem` (Node.js)
- `REQUESTS_CA_BUNDLE=/etc/clauderon/proxy-ca.pem` (Python)

Most tools respect these automatically. If a tool doesn't, configure it manually to trust `$SSL_CERT_FILE`.

### Cache volumes owned by root

**Problem**: Docker creates named volumes as root:root, causing permission warnings.

**Solution**: This is a Docker limitation. Options:
1. **Accept the warnings** (recommended) - Clauderon will work fine, you'll just see warnings
2. Add `sudo` to your image and use it for cache writes (not recommended)
3. Use an init container to fix permissions (Kubernetes only)

### "sccache: command not found" warnings

**Impact**: Non-fatal. Rust compilation proceeds without caching (slower builds).

**Solution**:
- If building Rust: Install sccache: `cargo install sccache`
- If not building Rust: Ignore the warning

## Testing Your Image

### Quick validation

```bash
# Test that required binaries exist
docker run --rm your-image:latest bash -c "which claude && which bash && which curl && which git"

# Test Claude CLI
docker run --rm your-image:latest claude --version
```

### Full integration test

```bash
# Start Clauderon daemon
clauderon daemon --http-port 3030

# Create a session with your custom image
clauderon create \
    --image your-image:latest \
    --name test-session \
    --repository /path/to/your/repo

# Verify session started
clauderon list

# Attach to the session
docker attach clauderon-test-session
```

### Verification checklist

- [ ] Session creates without errors
- [ ] Can attach to session and get bash prompt
- [ ] Claude Code responds to prompts
- [ ] Git operations work (`git status`, `git log`)
- [ ] Can create files and directories in `/workspace`
- [ ] Environment variables are set (`echo $HOME`, `echo $CARGO_HOME`)
- [ ] Hooks are working (check Clauderon logs for hook events)
- [ ] Proxy works if enabled (test HTTPS requests)

## Advanced: Environment Variables Reference

Clauderon sets many environment variables. Your image doesn't need to set these - they're provided at runtime.

### Core

- `HOME=/workspace` - Home directory
- `TERM=xterm-256color` - Terminal type
- `LANG=en_US.UTF-8` - Locale (if your image sets it)

### Rust (always set)

- `CARGO_HOME=/workspace/.cargo`
- `RUSTC_WRAPPER=sccache`
- `SCCACHE_DIR=/workspace/.cache/sccache`

### Git (from host config)

- `GIT_AUTHOR_NAME`, `GIT_COMMITTER_NAME`
- `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_EMAIL`

### Codex (Codex agent only)

- `CODEX_HOME=/workspace/.codex`

### Proxy (if enabled)

- `HTTP_PROXY=http://host.docker.internal:{port}`
- `HTTPS_PROXY=http://host.docker.internal:{port}`
- `NO_PROXY=localhost,127.0.0.1,host.docker.internal`
- `SSL_CERT_FILE=/etc/clauderon/proxy-ca.pem`
- `NODE_EXTRA_CA_CERTS=/etc/clauderon/proxy-ca.pem`
- `REQUESTS_CA_BUNDLE=/etc/clauderon/proxy-ca.pem`

### Authentication (placeholder values, replaced by proxy)

- `GH_TOKEN=clauderon-proxy`
- `GITHUB_TOKEN=clauderon-proxy`
- `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-clauderon-proxy-placeholder`
- `OPENAI_API_KEY=sk-openai-clauderon-proxy-placeholder` (Codex)
- `CODEX_API_KEY=sk-openai-clauderon-proxy-placeholder` (Codex)

### Session metadata

- `CLAUDERON_SESSION_ID={uuid}` - Session ID for hook communication
- `CLAUDERON_HTTP_PORT={port}` - HTTP port for hook communication

### Talos (if Talos enabled)

- `TALOSCONFIG=/etc/clauderon/talos/config`

## Advanced: Volume Mounts Reference

Clauderon mounts these volumes automatically. Don't pre-create them in your image.

### Session mounts (per-session)

- `/workspace` - Your session's git worktree (read-write)
- `/workspace/.claude.json` - Claude Code configuration (read-write)
- Parent `.git` directory - Mounted at same absolute path as host (read-write)

### Shared cache mounts (across all sessions)

- `/workspace/.cargo/registry` - Rust crate downloads (named volume: `clauderon-cargo-registry`)
- `/workspace/.cargo/git` - Rust git dependencies (named volume: `clauderon-cargo-git`)
- `/workspace/.cache/sccache` - Compilation cache (named volume: `clauderon-sccache`)

### Configuration mounts (read-only, if enabled)

- `/etc/clauderon/proxy-ca.pem` - Proxy CA certificate
- `/etc/clauderon/codex/` - Codex configuration directory
- `/etc/clauderon/codex/auth.json` - Codex authentication
- `/etc/clauderon/codex/config.toml` - Codex config
- `/etc/clauderon/talos/` - Talos configuration directory
- `/etc/clauderon/talos/config` - Talos config file
- `/etc/claude-code/managed-settings.json` - Claude Code managed settings (proxy mode only)

### Permissions note

Named volumes may be created by Docker as `root:root`. Your image should handle both root-owned and user-owned volumes gracefully. Most images do this by default.

## Reference Implementation

The default Clauderon image is [`ghcr.io/shepherdjerred/dotfiles`](https://github.com/shepherdjerred/dotfiles/blob/main/Dockerfile).

It includes:
- All required dependencies (claude, bash, curl, git)
- Rust toolchain with sccache
- Development tools (Node.js, Python, Go via mise)
- Modern shell (Fish)
- Size optimizations (multi-stage build, debug symbol stripping)

This is a full-featured development image. You don't need all these features - just the core requirements listed in the TL;DR.

## Contributing

Found an issue with this guide or have suggestions? Please open an issue on the [Clauderon repository](https://github.com/shepherdjerred/monorepo).

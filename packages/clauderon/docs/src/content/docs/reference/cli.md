---
title: CLI Reference
description: Complete command-line interface reference
---

![clauderon Help](~/assets/screenshots/cli/clauderon-help.svg)

## Global Options

```
--help, -h       Print help
--version, -V    Print version
```

## Commands

### clauderon daemon

Start the background daemon (required for all operations).

```bash
clauderon daemon [OPTIONS]
```

**Options:**
```
--http-port <PORT>           HTTP server port (default: 3030, 0 to disable)
--no-proxy                   Disable credential proxy
--dev                        Development mode (serve frontend from filesystem)
```

**Feature Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--enable-webauthn-auth` | `false` | WebAuthn passwordless authentication for web UI |
| `--enable-ai-metadata` | `true` | AI-generated session titles from prompts |
| `--enable-auto-reconcile` | `true` | Sync database with backends on startup |
| `--enable-usage-tracking` | `false` | Track Claude API usage per session |
| `--enable-kubernetes-backend` | `false` | Enable Kubernetes backend (experimental) |
| `--enable-proxy-port-reuse` | `false` | Reuse proxy ports across sessions (experimental) |

See [Feature Flags Reference](/reference/feature-flags/) for detailed documentation.

**Example:**
```bash
# Start daemon with default settings
clauderon daemon

# Start with AI-generated session titles
clauderon daemon --enable-ai-metadata

# Start with Kubernetes backend enabled
clauderon daemon --enable-kubernetes-backend
```

---

### clauderon create

Create a new session.

```bash
clauderon create --repo <PATH> --prompt <TEXT> [OPTIONS]
```

![clauderon create Help](~/assets/screenshots/cli/clauderon-create-help.svg)

**Required:**
```
--repo <PATH>                Git repository path
--prompt <TEXT>              Initial prompt for the AI agent
```

**Options:**
```
--backend <BACKEND>          Backend: zellij (default), docker, kubernetes, sprites, apple
--agent <AGENT>              Agent: claude (default), codex, gemini
--access-mode <MODE>         Access mode: read-write (default), read-only
--no-plan-mode               Skip plan mode, go straight to implementation
--print                      Non-interactive mode (print output, exit when done)
--dangerous-skip-checks      Bypass dirty repo checks
```

**Docker-specific:**
```
--image <IMAGE>              Custom container image
--pull-policy <POLICY>       Pull policy: always, if-not-present (default), never
--cpu-limit <LIMIT>          CPU limit (e.g., "2.0" or "500m")
--memory-limit <LIMIT>       Memory limit (e.g., "2g" or "512m")
```

**Examples:**
```bash
# Basic session with default backend (Zellij)
clauderon create --repo ~/project --prompt "Fix the login bug"

# Docker with custom image
clauderon create --backend docker --image rust:1.85 \
  --repo ~/project --prompt "Build the project"

# Read-only exploration
clauderon create --access-mode read-only \
  --repo ~/project --prompt "Explain the architecture"

# Non-interactive for scripts
clauderon create --print \
  --repo ~/project --prompt "Generate documentation"

# Skip plan mode for quick tasks
clauderon create --no-plan-mode \
  --repo ~/project --prompt "Add a console.log statement"

# Docker with resource limits
clauderon create --backend docker \
  --cpu-limit 4 --memory-limit 8g \
  --repo ~/project --prompt "Heavy computation task"
```

---

### clauderon tui

Launch the terminal user interface.

```bash
clauderon tui
```

**Keyboard shortcuts:**
| Key | Action |
|-----|--------|
| `n` | Create new session |
| `Enter` | Attach to session |
| `a` | Archive session |
| `u` | Unarchive session |
| `d` | Delete session |
| `j` / `k` | Navigate down/up |
| `g` / `G` | Go to first/last |
| `r` | Refresh list |
| `q` | Quit |

---

### clauderon list

List all sessions.

```bash
clauderon list [OPTIONS]
```

![clauderon list Output](~/assets/screenshots/cli/clauderon-list.svg)

**Options:**
```
--archived                   Include archived sessions
```

**Output columns:**
- Name
- Backend
- Agent
- Status
- Access Mode
- Created

---

### clauderon attach

Attach to a session's terminal.

```bash
clauderon attach <NAME>
```

**Arguments:**
- `<NAME>` - Session name

Attaches to the running session's terminal. For Zellij sessions, this opens the Zellij pane. For Docker sessions, this attaches to the container's TTY.

---

### clauderon archive

Archive a session (hide from default list but preserve).

```bash
clauderon archive <NAME>
```

**Arguments:**
- `<NAME>` - Session name

Archived sessions are hidden from `clauderon list` but can be seen with `clauderon list --archived`. Use this to keep completed sessions without cluttering your active list.

---

### clauderon unarchive

Restore an archived session.

```bash
clauderon unarchive <NAME>
```

**Arguments:**
- `<NAME>` - Session name

---

### clauderon delete

Delete a session permanently.

```bash
clauderon delete [OPTIONS] <NAME>
```

**Arguments:**
- `<NAME>` - Session name

**Options:**
```
--force, -f                  Force delete without confirmation
```

This removes the session from the database, deletes the git worktree, and cleans up backend resources (container, Zellij session, etc.).

---

### clauderon refresh

Refresh a Docker session (pull latest image, recreate container).

```bash
clauderon refresh <NAME>
```

**Arguments:**
- `<NAME>` - Session name

This command:
1. Stops the existing container
2. Pulls the latest version of the image
3. Creates a new container with the same configuration
4. Starts the new container

Useful for updating to newer Claude Code versions.

---

### clauderon set-access-mode

Change a session's proxy access mode.

```bash
clauderon set-access-mode <NAME> <MODE>
```

**Arguments:**
- `<NAME>` - Session name
- `<MODE>` - Access mode: `read-only` or `read-write`

**Modes:**
- `read-only` - Only allows GET, HEAD, OPTIONS requests
- `read-write` - Allows all HTTP methods (default)

**Example:**
```bash
# Restrict a session to read-only
clauderon set-access-mode my-session read-only

# Re-enable write access
clauderon set-access-mode my-session read-write
```

---

### clauderon reconcile

Synchronize database with actual backend state.

```bash
clauderon reconcile
```

Useful after:
- System crashes
- Manual backend changes (manually deleting containers, etc.)
- Database corruption

This command scans all backends and updates the database to match reality.

---

### clauderon clean-cache

Manage Docker cache volumes.

```bash
clauderon clean-cache [OPTIONS]
```

**Options:**
```
--force                      Actually remove volumes (default: dry run)
```

clauderon creates shared Docker volumes for caching:
- `clauderon-cargo-registry` - Cargo package cache
- `clauderon-cargo-git` - Git dependencies
- `clauderon-sccache` - Compilation cache

Without `--force`, shows what would be cleaned. With `--force`, removes the volumes.

---

### clauderon config

Configuration management subcommands.

```bash
clauderon config <SUBCOMMAND>
```

#### clauderon config show

Show current configuration values.

```bash
clauderon config show
```

#### clauderon config paths

List all file paths used by clauderon.

```bash
clauderon config paths
```

#### clauderon config env

List all environment variables and their values.

```bash
clauderon config env
```

#### clauderon config credentials

Show credential status (which credentials are configured).

```bash
clauderon config credentials
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RUST_LOG` | Log level filter | `clauderon=info` |
| `CLAUDERON_BIND_ADDR` | HTTP bind address | `127.0.0.1` |
| `CLAUDERON_ORIGIN` | WebAuthn origin URL | Auto-detected |
| `CLAUDERON_DEV` | Enable dev mode | `0` |

### Feature Flags (Environment)

Feature flags can also be set via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH` | `false` | WebAuthn passwordless auth |
| `CLAUDERON_FEATURE_ENABLE_AI_METADATA` | `true` | AI-generated session titles |
| `CLAUDERON_FEATURE_ENABLE_AUTO_RECONCILE` | `true` | Auto-reconcile on startup |
| `CLAUDERON_FEATURE_ENABLE_USAGE_TRACKING` | `false` | Claude usage tracking |
| `CLAUDERON_FEATURE_ENABLE_KUBERNETES_BACKEND` | `false` | Kubernetes backend |
| `CLAUDERON_FEATURE_ENABLE_PROXY_PORT_REUSE` | `false` | Proxy port reuse |

Values: `1`, `true`, `yes`, `on` to enable; `0`, `false`, `no`, `off` to disable.

See [Feature Flags Reference](/reference/feature-flags/) for detailed documentation.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Session not found |
| 4 | Backend error |

## See Also

- [Feature Flags Reference](/reference/feature-flags/) - Detailed feature flag documentation
- [Configuration Reference](/reference/configuration/) - Configuration file options
- [Environment Variables](/reference/environment-variables/) - Complete environment variable reference
- [File Locations](/reference/file-locations/) - Where clauderon stores data

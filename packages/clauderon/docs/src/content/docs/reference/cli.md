---
title: CLI Commands
description: Complete reference for clauderon command-line interface
---

## Global Options

These options are available for all commands:

```
--config <PATH>    Path to config file (default: ~/.config/clauderon/config.toml)
--verbose, -v      Enable verbose output
--quiet, -q        Suppress non-essential output
--help, -h         Print help
--version, -V      Print version
```

## Commands

### `clauderon` (default)

Launch the terminal user interface.

```bash
clauderon
```

Opens the interactive TUI for managing sessions.

---

### `clauderon new`

Create a new session.

```bash
clauderon new [OPTIONS] <NAME>
```

**Arguments:**
- `<NAME>` - Session name (required)

**Options:**
```
--backend <BACKEND>      Backend type: docker, zellij (default: docker)
--workdir <PATH>         Working directory to mount/use
--repo <URL>             Git repository to clone
--image <IMAGE>          Docker image (docker backend only)
--branch <BRANCH>        Git branch to checkout (with --repo)
--env <KEY=VALUE>        Additional environment variables
```

**Examples:**
```bash
# Create a Docker session
clauderon new --backend docker --workdir /home/user/project my-session

# Create from a git repo
clauderon new --repo https://github.com/user/repo --branch main project-work

# Create with custom image
clauderon new --backend docker --image rust:1.85 rust-dev
```

---

### `clauderon list`

List all sessions.

```bash
clauderon list [OPTIONS]
```

**Options:**
```
--json           Output as JSON
--running        Only show running sessions
--stopped        Only show stopped sessions
```

**Output columns:**
- Name
- Backend
- Status
- Created
- Working Directory

---

### `clauderon attach`

Attach to an existing session.

```bash
clauderon attach <NAME>
```

**Arguments:**
- `<NAME>` - Session name

If the session is stopped, it will be started first.

---

### `clauderon delete`

Delete a session.

```bash
clauderon delete [OPTIONS] <NAME>
```

**Arguments:**
- `<NAME>` - Session name

**Options:**
```
--force, -f      Force delete running sessions
--all            Delete all sessions
```

---

### `clauderon stop`

Stop a running session.

```bash
clauderon stop <NAME>
```

**Arguments:**
- `<NAME>` - Session name

---

### `clauderon start`

Start a stopped session.

```bash
clauderon start <NAME>
```

**Arguments:**
- `<NAME>` - Session name

---

### `clauderon proxy`

Manage the credential proxy.

```bash
clauderon proxy <SUBCOMMAND>
```

**Subcommands:**

#### `clauderon proxy start`

Start the proxy server.

```bash
clauderon proxy start [OPTIONS]
```

**Options:**
```
--port <PORT>          Listen port (default: 8080)
--bind <ADDRESS>       Bind address (default: 127.0.0.1)
--foreground, -f       Run in foreground
```

#### `clauderon proxy stop`

Stop the proxy server.

```bash
clauderon proxy stop
```

#### `clauderon proxy status`

Show proxy status.

```bash
clauderon proxy status
```

#### `clauderon proxy regenerate-ca`

Regenerate the CA certificate.

```bash
clauderon proxy regenerate-ca [OPTIONS]
```

**Options:**
```
--force    Overwrite existing CA
```

---

### `clauderon config`

Manage configuration.

```bash
clauderon config <SUBCOMMAND>
```

**Subcommands:**

#### `clauderon config show`

Show current configuration.

```bash
clauderon config show [--json]
```

#### `clauderon config edit`

Open configuration in editor.

```bash
clauderon config edit
```

#### `clauderon config init`

Create default configuration file.

```bash
clauderon config init [--force]
```

---

### `clauderon daemon`

Run clauderon as a background daemon.

```bash
clauderon daemon [OPTIONS]
```

**Options:**
```
--foreground, -f     Run in foreground
--pidfile <PATH>     PID file location
```

The daemon manages the proxy and session lifecycle.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MUX_CONFIG` | Config file path | `~/.config/clauderon/config.toml` |
| `MUX_DATA_DIR` | Data directory | `~/.local/share/clauderon` |
| `MUX_LOG_LEVEL` | Log level (error, warn, info, debug, trace) | `info` |
| `MUX_PROXY_PORT` | Proxy listen port | `8080` |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Session not found |
| 4 | Backend error |
| 5 | Proxy error |

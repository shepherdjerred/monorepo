---
title: CLI Commands
description: Complete reference for mux command-line interface
---

## Global Options

These options are available for all commands:

```
--config <PATH>    Path to config file (default: ~/.config/mux/config.toml)
--verbose, -v      Enable verbose output
--quiet, -q        Suppress non-essential output
--help, -h         Print help
--version, -V      Print version
```

## Commands

### `mux` (default)

Launch the terminal user interface.

```bash
mux
```

Opens the interactive TUI for managing sessions.

---

### `mux new`

Create a new session.

```bash
mux new [OPTIONS] <NAME>
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
mux new --backend docker --workdir /home/user/project my-session

# Create from a git repo
mux new --repo https://github.com/user/repo --branch main project-work

# Create with custom image
mux new --backend docker --image rust:1.85 rust-dev
```

---

### `mux list`

List all sessions.

```bash
mux list [OPTIONS]
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

### `mux attach`

Attach to an existing session.

```bash
mux attach <NAME>
```

**Arguments:**
- `<NAME>` - Session name

If the session is stopped, it will be started first.

---

### `mux delete`

Delete a session.

```bash
mux delete [OPTIONS] <NAME>
```

**Arguments:**
- `<NAME>` - Session name

**Options:**
```
--force, -f      Force delete running sessions
--all            Delete all sessions
```

---

### `mux stop`

Stop a running session.

```bash
mux stop <NAME>
```

**Arguments:**
- `<NAME>` - Session name

---

### `mux start`

Start a stopped session.

```bash
mux start <NAME>
```

**Arguments:**
- `<NAME>` - Session name

---

### `mux proxy`

Manage the credential proxy.

```bash
mux proxy <SUBCOMMAND>
```

**Subcommands:**

#### `mux proxy start`

Start the proxy server.

```bash
mux proxy start [OPTIONS]
```

**Options:**
```
--port <PORT>          Listen port (default: 8080)
--bind <ADDRESS>       Bind address (default: 127.0.0.1)
--foreground, -f       Run in foreground
```

#### `mux proxy stop`

Stop the proxy server.

```bash
mux proxy stop
```

#### `mux proxy status`

Show proxy status.

```bash
mux proxy status
```

#### `mux proxy regenerate-ca`

Regenerate the CA certificate.

```bash
mux proxy regenerate-ca [OPTIONS]
```

**Options:**
```
--force    Overwrite existing CA
```

---

### `mux config`

Manage configuration.

```bash
mux config <SUBCOMMAND>
```

**Subcommands:**

#### `mux config show`

Show current configuration.

```bash
mux config show [--json]
```

#### `mux config edit`

Open configuration in editor.

```bash
mux config edit
```

#### `mux config init`

Create default configuration file.

```bash
mux config init [--force]
```

---

### `mux daemon`

Run mux as a background daemon.

```bash
mux daemon [OPTIONS]
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
| `MUX_CONFIG` | Config file path | `~/.config/mux/config.toml` |
| `MUX_DATA_DIR` | Data directory | `~/.local/share/mux` |
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

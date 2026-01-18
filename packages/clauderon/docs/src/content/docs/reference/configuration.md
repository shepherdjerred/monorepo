---
title: Configuration
description: Complete configuration reference for clauderon
---

clauderon uses a TOML configuration file located at `~/.config/clauderon/config.toml`.

## Configuration File Location

The configuration file is searched in this order:

1. `$MUX_CONFIG` environment variable
2. `~/.config/clauderon/config.toml`
3. `/etc/clauderon/config.toml`

Create a default configuration:

```bash
clauderon config init
```

## Full Configuration Reference

```toml
# ~/.config/clauderon/config.toml

#
# General Settings
#
[general]
# Default backend for new sessions
default_backend = "docker"  # docker, zellij

# Data directory for session storage
data_dir = "~/.local/share/clauderon"

# Log level: error, warn, info, debug, trace
log_level = "info"

# Log file (optional, logs to stderr if not set)
log_file = "~/.config/clauderon/clauderon.log"

#
# Proxy Configuration
#
[proxy]
# Proxy listen port
port = 8080

# Bind address
bind = "127.0.0.1"

# Auto-generate TLS certificates
generate_certs = true

# CA certificate directory
ca_dir = "~/.config/clauderon/ca"

# CA certificate lifetime in days
ca_lifetime = 365

# Request timeout in seconds
timeout = 30

# Maximum concurrent connections
max_connections = 100

[proxy.logging]
# Log all requests
log_requests = false

# Log file for requests
log_file = "~/.config/clauderon/proxy.log"

# Log response bodies (careful with large responses)
log_responses = false

[proxy.filters]
# Block requests to these domains (supports wildcards)
blocked_domains = []

# Block requests containing these patterns
blocked_patterns = []

# Allow-list mode (only allow specified domains)
allowlist_only = false
allowed_domains = []

#
# Credentials
#
# Each credential section defines what to inject for matching domains

[credentials.anthropic]
# Which header to inject
header = "x-api-key"

# Or use Authorization header with type
# auth_type = "bearer"  # bearer, basic

# The credential value (supports env var expansion)
value = "${ANTHROPIC_API_KEY}"

# Domains to match (supports wildcards)
domains = ["api.anthropic.com"]

[credentials.github]
header = "Authorization"
auth_type = "bearer"
value = "${GITHUB_TOKEN}"
domains = ["api.github.com"]

[credentials.github_git]
# HTTP Basic Auth for git operations
auth_type = "basic"
username = "x-access-token"
password = "${GITHUB_TOKEN}"
domains = ["github.com"]

#
# Docker Backend
#
[docker]
# Base image for containers
image = "ubuntu:22.04"

# Default shell
shell = "/bin/bash"

# Network mode: host, bridge, none
network = "host"

# Additional volumes to mount (host:container:mode)
volumes = []

# Additional environment variables
env = []

# Run containers as current user
run_as_user = true

# Enable sccache for Rust
[docker.rust]
sccache = false
cache_dir = "~/.cache/sccache"

# Resource limits
[docker.limits]
memory = ""      # e.g., "4g"
cpus = ""        # e.g., "2"
memory_swap = "" # e.g., "4g"

#
# Zellij Backend
#
[zellij]
# Shell to use
shell = "/bin/bash"

# Default layout
layout = "default"

# Additional environment variables
env = []

#
# Git Configuration
#
[git]
# Inject git config into sessions
inject_config = true

# User name for commits
user_name = "${GIT_USER_NAME}"

# User email for commits
user_email = "${GIT_USER_EMAIL}"

# SSH key to mount (Docker only)
ssh_key = "~/.ssh/id_ed25519"

#
# TUI Configuration
#
[tui]
# Color theme: dark, light, auto
theme = "auto"

# Show session status in header
show_status = true

# Refresh interval in milliseconds
refresh_interval = 1000

# Key bindings (vim-style by default)
[tui.keys]
quit = "q"
new_session = "n"
delete_session = "d"
attach = "Enter"
up = "k"
down = "j"

#
# Hooks
#
# Execute commands on session events

[hooks]
# Run after session creation
on_create = []

# Run before session deletion
on_delete = []

# Run when session starts
on_start = []

# Run when session stops
on_stop = []

#
# Advanced
#
[advanced]
# Enable experimental features
experimental = false

# Database path (SQLite)
database = "~/.local/share/clauderon/sessions.db"

# PID file for daemon
pidfile = "~/.local/share/clauderon/clauderon.pid"

# Socket path for IPC
socket = "~/.local/share/clauderon/clauderon.sock"
```

## Environment Variable Expansion

Configuration values support environment variable expansion:

- `${VAR}` - Required variable (error if not set)
- `${VAR:-default}` - Variable with default value
- `$VAR` - Simple expansion (legacy support)

## Credential Priority

When multiple credential rules match a request:

1. More specific domain patterns take priority
2. Later definitions override earlier ones
3. Exact matches override wildcards

## Example Configurations

### Minimal Configuration

```toml
[proxy]
port = 8080

[credentials.anthropic]
header = "x-api-key"
value = "${ANTHROPIC_API_KEY}"
domains = ["api.anthropic.com"]
```

### Full Development Setup

```toml
[general]
default_backend = "docker"
log_level = "debug"

[docker]
image = "ubuntu:22.04"
volumes = [
  "~/.ssh:/root/.ssh:ro",
  "~/.gitconfig:/root/.gitconfig:ro",
]

[docker.rust]
sccache = true

[git]
inject_config = true
user_name = "Your Name"
user_email = "your@email.com"

[credentials.anthropic]
header = "x-api-key"
value = "${ANTHROPIC_API_KEY}"
domains = ["api.anthropic.com"]

[credentials.github]
auth_type = "bearer"
value = "${GITHUB_TOKEN}"
domains = ["api.github.com", "github.com"]
```

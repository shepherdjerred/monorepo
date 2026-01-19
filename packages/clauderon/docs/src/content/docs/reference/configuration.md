---
title: Configuration Reference
description: Complete configuration file reference
---

## File Locations

clauderon uses the `~/.clauderon/` directory for all configuration and data:

```
~/.clauderon/
├── config.toml              # Main configuration
├── proxy.toml               # Proxy configuration
├── db.sqlite                # Session database
├── proxy-ca.pem             # CA certificate (public)
├── proxy-ca-key.pem         # CA private key (host only)
├── claude.json              # Claude Code settings
├── managed-settings.json    # Bypass permissions
├── audit.jsonl              # Proxy audit log
├── secrets/                 # Credential files
│   ├── github_token
│   ├── anthropic_oauth_token
│   └── ...
├── worktrees/               # Git worktrees
├── uploads/                 # Uploaded images
├── logs/                    # Log files
├── codex/                   # Codex auth
└── talos/                   # Talos kubeconfig
```

## Main Configuration (config.toml)

```toml
# ~/.clauderon/config.toml

#
# General Settings
#
[general]
# Default backend for new sessions
default_backend = "zellij"  # zellij, docker, kubernetes, sprites, apple

# Default agent
default_agent = "claude"    # claude, codex, gemini

#
# Feature Flags
#
[features]
webauthn_auth = false        # Passwordless authentication
ai_metadata = false          # AI-generated session titles
auto_reconcile = false       # Auto-reconcile on startup
usage_tracking = false       # Claude usage tracking
kubernetes_backend = false   # Enable Kubernetes backend

#
# Docker Backend
#
[docker]
default_image = "ghcr.io/anthropics/claude-code:latest"
pull_policy = "if-not-present"  # always, if-not-present, never

[docker.limits]
cpu = ""        # e.g., "2.0"
memory = ""     # e.g., "4g"

#
# Kubernetes Backend
#
[kubernetes]
namespace = "default"
storage_class = ""           # Use cluster default if empty
image_pull_secrets = []

#
# Sprites Backend
#
[sprites]
api_key = ""                 # Or use SPRITES_API_KEY env var

#
# Hooks
#
[hooks]
on_create = ""               # Command to run on session create
on_delete = ""               # Command to run on session delete
on_start = ""                # Command to run on session start
on_stop = ""                 # Command to run on session stop
```

## Proxy Configuration (proxy.toml)

```toml
# ~/.clauderon/proxy.toml

#
# Secrets Directory
#
secrets_dir = "~/.clauderon/secrets"

#
# Audit Logging
#
audit_enabled = true
audit_log_path = "~/.clauderon/audit.jsonl"

#
# Talos Gateway
#
talos_gateway_port = 18082
kubectl_proxy_port = 18081

#
# Codex Auth
#
codex_auth_json_path = ""    # Path to host Codex auth.json

#
# 1Password Integration
#
[onepassword]
enabled = false
op_path = "op"               # Path to 1Password CLI

# Credential references (op://vault/item/field format)
[onepassword.credentials]
github_token = ""
anthropic_oauth_token = ""
openai_api_key = ""
pagerduty_token = ""
sentry_auth_token = ""
grafana_api_key = ""
npm_token = ""
```

## Credential Files

Store credentials as plain text files in `~/.clauderon/secrets/`:

```bash
mkdir -p ~/.clauderon/secrets
echo "your-github-token" > ~/.clauderon/secrets/github_token
echo "your-anthropic-token" > ~/.clauderon/secrets/anthropic_oauth_token
chmod 600 ~/.clauderon/secrets/*
```

### Supported Credential Files

| File Name | Service | Injected As |
|-----------|---------|-------------|
| `github_token` | GitHub API & git | `Authorization: Bearer` |
| `anthropic_oauth_token` | Anthropic API | `Authorization: Bearer` |
| `openai_api_key` | OpenAI/Codex | `Authorization: Bearer` |
| `pagerduty_token` | PagerDuty API | `Authorization: Token` |
| `sentry_auth_token` | Sentry API | `Authorization: Bearer` |
| `grafana_api_key` | Grafana API | `Authorization: Bearer` |
| `npm_token` | npm registry | `Authorization: Bearer` |
| `docker_token` | Docker Hub | `Authorization: Bearer` |
| `k8s_token` | Kubernetes API | `Authorization: Bearer` |
| `talos_token` | Talos API | mTLS |

## Credential Priority

When multiple sources define the same credential:

1. **Environment variables** (highest priority)
2. **1Password references** (if configured)
3. **Secret files** (lowest priority)

## Example Configurations

### Minimal Setup

```toml
# ~/.clauderon/config.toml
[general]
default_backend = "zellij"
```

No config file is required - clauderon uses sensible defaults.

### Docker Development

```toml
# ~/.clauderon/config.toml
[general]
default_backend = "docker"

[docker]
default_image = "ubuntu:22.04"

[docker.limits]
cpu = "4"
memory = "8g"
```

### With 1Password

```toml
# ~/.clauderon/proxy.toml
[onepassword]
enabled = true

[onepassword.credentials]
github_token = "op://Private/GitHub/token"
anthropic_oauth_token = "op://Private/Claude/oauth-token"
```

See [1Password Guide](/guides/onepassword/) for detailed setup.

### Kubernetes Cluster

```toml
# ~/.clauderon/config.toml
[general]
default_backend = "kubernetes"

[features]
kubernetes_backend = true

[kubernetes]
namespace = "clauderon"
storage_class = "fast-ssd"
```

### With Hooks

```toml
# ~/.clauderon/config.toml
[hooks]
# Send notification when session starts
on_start = "notify-send 'clauderon' 'Session started: $SESSION_NAME'"

# Clean up custom resources
on_delete = "/usr/local/bin/cleanup-session.sh $SESSION_NAME"
```

See [Hooks Guide](/guides/hooks/) for details.

### Full Production Setup

```toml
# ~/.clauderon/config.toml
[general]
default_backend = "docker"
default_agent = "claude"

[features]
ai_metadata = true
auto_reconcile = true
usage_tracking = true

[docker]
default_image = "ghcr.io/anthropics/claude-code:latest"
pull_policy = "if-not-present"

[docker.limits]
cpu = "4"
memory = "8g"

[hooks]
on_create = "logger -t clauderon 'Session created: $SESSION_NAME'"
on_delete = "logger -t clauderon 'Session deleted: $SESSION_NAME'"
```

```toml
# ~/.clauderon/proxy.toml
[onepassword]
enabled = true

[onepassword.credentials]
github_token = "op://Work/GitHub/token"
anthropic_oauth_token = "op://Work/Claude/oauth-token"

audit_enabled = true
```

## Configuration Validation

Check your configuration:

```bash
# Show current configuration
clauderon config show

# List all file paths
clauderon config paths

# Show credential status
clauderon config credentials
```

## See Also

- [File Locations](/reference/file-locations/) - Detailed file structure
- [Environment Variables](/reference/environment-variables/) - All environment variables
- [1Password Guide](/guides/onepassword/) - Setting up 1Password
- [Hooks Guide](/guides/hooks/) - Configuring hooks

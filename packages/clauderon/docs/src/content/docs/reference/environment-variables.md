---
title: Environment Variables
description: Complete environment variable reference
---

clauderon uses environment variables for configuration, feature flags, and credential management.

## Daemon Configuration

### Core Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `RUST_LOG` | Log level filter | `clauderon=info` |
| `CLAUDERON_BIND_ADDR` | HTTP bind address | `127.0.0.1` |
| `CLAUDERON_DEV` | Enable development mode | `0` |

### WebAuthn

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDERON_ORIGIN` | WebAuthn origin URL | Auto-detected |

## Feature Flags

Enable features via environment variables (set to `1` or `true`):

| Variable | Description |
|----------|-------------|
| `CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH` | Passwordless authentication |
| `CLAUDERON_FEATURE_ENABLE_AI_METADATA` | AI-generated session titles |
| `CLAUDERON_FEATURE_ENABLE_AUTO_RECONCILE` | Auto-reconcile on startup |
| `CLAUDERON_FEATURE_ENABLE_USAGE_TRACKING` | Claude usage tracking |
| `CLAUDERON_FEATURE_ENABLE_KUBERNETES_BACKEND` | Kubernetes backend |
| `CLAUDERON_FEATURE_ENABLE_PROXY_PORT_REUSE` | Proxy port reuse |

### Example

```bash
export CLAUDERON_FEATURE_ENABLE_AI_METADATA=1
export CLAUDERON_FEATURE_ENABLE_AUTO_RECONCILE=true
clauderon daemon
```

## Credentials

Store credentials as environment variables (highest priority):

| Variable | Service | Used For |
|----------|---------|----------|
| `GITHUB_TOKEN` | GitHub | API access, git operations |
| `CLAUDE_CODE_OAUTH_TOKEN` | Anthropic | Claude Code agent |
| `OPENAI_API_KEY` | OpenAI | Codex agent |
| `CODEX_API_KEY` | OpenAI | Codex agent (alternative) |
| `GOOGLE_API_KEY` | Google | Gemini agent |
| `PAGERDUTY_TOKEN` | PagerDuty | Incident management |
| `SENTRY_AUTH_TOKEN` | Sentry | Error tracking |
| `GRAFANA_API_KEY` | Grafana | Monitoring |
| `NPM_TOKEN` | npm | Package registry |
| `DOCKER_TOKEN` | Docker Hub | Container registry |
| `SPRITES_API_KEY` | sprites.dev | Sprites backend |
| `K8S_TOKEN` | Kubernetes | Cluster access |
| `TALOS_TOKEN` | Talos | Talos cluster access |

### Example

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
export CLAUDE_CODE_OAUTH_TOKEN="your-oauth-token"
clauderon daemon
```

## Session Environment

These variables are set inside sessions:

### Proxy Configuration

| Variable | Value | Purpose |
|----------|-------|---------|
| `HTTP_PROXY` | `http://<host>:<port>` | HTTP proxy address |
| `HTTPS_PROXY` | `http://<host>:<port>` | HTTPS proxy address |
| `NO_PROXY` | `localhost,127.0.0.1` | Proxy bypass list |

### TLS Configuration

| Variable | Value | Purpose |
|----------|-------|---------|
| `SSL_CERT_FILE` | `/etc/clauderon/proxy-ca.pem` | CA certificate |
| `NODE_EXTRA_CA_CERTS` | `/etc/clauderon/proxy-ca.pem` | Node.js CA |
| `REQUESTS_CA_BUNDLE` | `/etc/clauderon/proxy-ca.pem` | Python requests CA |
| `CURL_CA_BUNDLE` | `/etc/clauderon/proxy-ca.pem` | curl CA |

### Session Metadata

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDERON_SESSION_ID` | Session UUID | Session identifier |
| `CLAUDERON_SESSION_NAME` | Session name | Human-readable name |
| `CLAUDERON_BACKEND` | Backend type | zellij, docker, etc. |
| `CLAUDERON_AGENT` | Agent type | claude, codex, gemini |
| `CLAUDERON_ACCESS_MODE` | Access mode | read-only, read-write |

## 1Password Integration

| Variable | Description |
|----------|-------------|
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password service account token |

Required for headless 1Password access.

## Priority

Credential resolution priority (highest to lowest):

1. Environment variables
2. 1Password references
3. Secret files (`~/.clauderon/secrets/`)

## Docker-Specific

When using Docker backend:

| Variable | Value |
|----------|-------|
| `DOCKER_HOST` | Uses system default |

## Kubernetes-Specific

When using Kubernetes backend:

| Variable | Description |
|----------|-------------|
| `KUBECONFIG` | Path to kubeconfig file |

## Debugging

### Verbose Logging

```bash
RUST_LOG=clauderon=debug clauderon daemon
```

### Trace Logging

```bash
RUST_LOG=clauderon=trace clauderon daemon
```

### Module-Specific Logging

```bash
RUST_LOG=clauderon::proxy=debug,clauderon::session=trace clauderon daemon
```

## Shell Configuration

### Bash/Zsh

Add to `~/.bashrc` or `~/.zshrc`:

```bash
export GITHUB_TOKEN="ghp_xxxx"
export CLAUDE_CODE_OAUTH_TOKEN="your-token"
export CLAUDERON_FEATURE_ENABLE_AI_METADATA=1
```

### Fish

Add to `~/.config/fish/config.fish`:

```fish
set -gx GITHUB_TOKEN "ghp_xxxx"
set -gx CLAUDE_CODE_OAUTH_TOKEN "your-token"
set -gx CLAUDERON_FEATURE_ENABLE_AI_METADATA 1
```

### systemd Service

Create `/etc/systemd/system/clauderon.service`:

```ini
[Unit]
Description=clauderon daemon
After=network.target

[Service]
Type=simple
User=youruser
Environment="RUST_LOG=clauderon=info"
Environment="CLAUDERON_FEATURE_ENABLE_AI_METADATA=1"
ExecStart=/usr/local/bin/clauderon daemon
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## See Also

- [Configuration Reference](/reference/configuration/) - File-based configuration
- [CLI Reference](/reference/cli/) - Command-line options
- [1Password Guide](/guides/onepassword/) - 1Password integration

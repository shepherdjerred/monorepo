---
title: Configuration Reference
description: Complete configuration file reference
---

## File Locations

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
├── worktrees/               # Git worktrees
├── uploads/                 # Uploaded images
├── logs/                    # Log files
├── codex/                   # Codex auth
└── talos/                   # Talos kubeconfig
```

## Main Configuration (config.toml)

```toml
# ~/.clauderon/config.toml

[feature_flags]
enable_webauthn_auth = false
enable_ai_metadata = true
enable_auto_reconcile = true
enable_proxy_port_reuse = false
enable_usage_tracking = false
enable_experimental_models = false
enable_readonly_mode = false

[server]
bind_addr = "127.0.0.1"
# origin = "https://example.com"  # For non-localhost WebAuthn
# disable_auth = false
# org_id = ""
```

## Proxy Configuration (proxy.toml)

```toml
# ~/.clauderon/proxy.toml
secrets_dir = "~/.clauderon/secrets"
audit_enabled = true
audit_log_path = "~/.clauderon/audit.jsonl"
talos_gateway_port = 18082
kubectl_proxy_port = 18081
codex_auth_json_path = ""

[onepassword]
enabled = false
op_path = "op"

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

```bash
mkdir -p ~/.clauderon/secrets
echo "your-github-token" > ~/.clauderon/secrets/github_token
echo "your-anthropic-token" > ~/.clauderon/secrets/anthropic_oauth_token
chmod 600 ~/.clauderon/secrets/*
```

| File Name               | Service          | Injected As             |
| ----------------------- | ---------------- | ----------------------- |
| `github_token`          | GitHub API & git | `Authorization: Bearer` |
| `anthropic_oauth_token` | Anthropic API    | `Authorization: Bearer` |
| `openai_api_key`        | OpenAI/Codex     | `Authorization: Bearer` |
| `pagerduty_token`       | PagerDuty API    | `Authorization: Token`  |
| `sentry_auth_token`     | Sentry API       | `Authorization: Bearer` |
| `grafana_api_key`       | Grafana API      | `Authorization: Bearer` |
| `npm_token`             | npm registry     | `Authorization: Bearer` |
| `docker_token`          | Docker Hub       | `Authorization: Bearer` |
| `talos_token`           | Talos API        | mTLS                    |

## Credential Priority

1. **Environment variables** (highest)
2. **1Password references**
3. **Secret files** (lowest)

## Example: 1Password

```toml
# ~/.clauderon/proxy.toml
[onepassword]
enabled = true

[onepassword.credentials]
github_token = "op://Private/GitHub/token"
anthropic_oauth_token = "op://Private/Claude/oauth-token"
```

## Example: Full Production

```toml
# ~/.clauderon/config.toml
[feature_flags]
enable_webauthn_auth = true
enable_ai_metadata = true
enable_auto_reconcile = true
enable_usage_tracking = true
enable_experimental_models = true

[server]
bind_addr = "0.0.0.0"
origin = "https://clauderon.example.com"
```

## Validation

```bash
clauderon config show         # current configuration
clauderon config paths        # file paths
clauderon config credentials  # credential status
```

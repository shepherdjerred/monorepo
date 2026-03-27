---
title: Environment Variables
description: Complete environment variable reference
---

## Daemon Configuration

| Variable              | Description         | Default          |
| --------------------- | ------------------- | ---------------- |
| `RUST_LOG`            | Log level filter    | `clauderon=info` |
| `CLAUDERON_BIND_ADDR` | HTTP bind address   | `127.0.0.1`      |
| `CLAUDERON_DEV`       | Development mode    | `0`              |
| `CLAUDERON_ORIGIN`    | WebAuthn origin URL | Auto-detected    |

## Feature Flags

Set to `1`, `true`, `yes`, or `on` to enable:

| Variable                                       | Description                   |
| ---------------------------------------------- | ----------------------------- |
| `CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH`       | Passwordless authentication   |
| `CLAUDERON_FEATURE_ENABLE_AI_METADATA`         | AI-generated session titles   |
| `CLAUDERON_FEATURE_ENABLE_AUTO_RECONCILE`      | Auto-reconcile on startup     |
| `CLAUDERON_FEATURE_ENABLE_USAGE_TRACKING`      | Claude usage tracking         |
| `CLAUDERON_FEATURE_ENABLE_PROXY_PORT_REUSE`    | Proxy port reuse              |
| `CLAUDERON_FEATURE_ENABLE_EXPERIMENTAL_MODELS` | Codex, Gemini models          |
| `CLAUDERON_FEATURE_ENABLE_READONLY_MODE`       | Read-only mode (experimental) |

## Credentials

Environment variables have highest priority over 1Password and secret files.

| Variable                  | Service    |
| ------------------------- | ---------- |
| `GH_TOKEN`                | GitHub     |
| `CLAUDE_CODE_OAUTH_TOKEN` | Anthropic  |
| `OPENAI_API_KEY`          | OpenAI     |
| `CODEX_API_KEY`           | OpenAI alt |
| `GOOGLE_API_KEY`          | Google     |
| `PAGERDUTY_TOKEN`         | PagerDuty  |
| `SENTRY_AUTH_TOKEN`       | Sentry     |
| `GRAFANA_API_KEY`         | Grafana    |
| `NPM_TOKEN`               | npm        |
| `DOCKER_TOKEN`            | Docker Hub |
| `TALOS_TOKEN`             | Talos      |

## Session Environment (set inside containers)

### Proxy

| Variable      | Value                  |
| ------------- | ---------------------- |
| `HTTP_PROXY`  | `http://<host>:<port>` |
| `HTTPS_PROXY` | `http://<host>:<port>` |
| `NO_PROXY`    | `localhost,127.0.0.1`  |

### TLS

| Variable              | Value                         |
| --------------------- | ----------------------------- |
| `SSL_CERT_FILE`       | `/etc/clauderon/proxy-ca.pem` |
| `NODE_EXTRA_CA_CERTS` | `/etc/clauderon/proxy-ca.pem` |
| `REQUESTS_CA_BUNDLE`  | `/etc/clauderon/proxy-ca.pem` |
| `CURL_CA_BUNDLE`      | `/etc/clauderon/proxy-ca.pem` |

### Session Metadata

| Variable                 | Value        |
| ------------------------ | ------------ |
| `CLAUDERON_SESSION_ID`   | Session UUID |
| `CLAUDERON_SESSION_NAME` | Session name |
| `CLAUDERON_BACKEND`      | Backend type |
| `CLAUDERON_AGENT`        | Agent type   |
| `CLAUDERON_ACCESS_MODE`  | Access mode  |

## 1Password

| Variable                   | Description                     |
| -------------------------- | ------------------------------- |
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password service account token |

## Debugging

```bash
RUST_LOG=clauderon=debug clauderon daemon                           # verbose
RUST_LOG=clauderon=trace clauderon daemon                           # trace
RUST_LOG=clauderon::proxy=debug,clauderon::session=trace clauderon daemon  # per-module
```

## Shell Configuration

**Bash/Zsh** (`~/.bashrc` or `~/.zshrc`):

```bash
export GH_TOKEN="ghp_xxxx"
export CLAUDERON_FEATURE_ENABLE_AI_METADATA=1
```

**Fish** (`~/.config/fish/config.fish`):

```fish
set -gx GH_TOKEN "ghp_xxxx"
set -gx CLAUDERON_FEATURE_ENABLE_AI_METADATA 1
```

**systemd** (`/etc/systemd/system/clauderon.service`):

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

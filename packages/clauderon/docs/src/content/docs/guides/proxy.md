---
title: Credential Proxy
description: How clauderon secures credentials with HTTP proxy interception
---

The credential proxy intercepts HTTP/HTTPS requests and injects credentials at request time. AI agents never see actual tokens.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│ clauderon Proxy │────▶│   API Server    │
│ (placeholder    │     │ (injects real   │     │ (receives real  │
│  credentials)   │     │  credentials)   │     │  credentials)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## How It Works

1. Agents run with placeholder credentials
2. All HTTP/HTTPS traffic routes through the proxy
3. Proxy replaces placeholders with real tokens
4. Access control blocks write operations in read-only mode
5. All requests are audit-logged

## TLS Interception

For HTTPS, clauderon generates a CA that signs certificates on-the-fly per domain.

```
~/.clauderon/proxy-ca.pem      # Public certificate (mounted in containers)
~/.clauderon/proxy-ca-key.pem  # Private key (host only, never mounted)
```

## Supported Credentials

| Credential      | Environment Variable      | Secret File             |
| --------------- | ------------------------- | ----------------------- |
| GitHub          | `GH_TOKEN`                | `github_token`          |
| Anthropic OAuth | `CLAUDE_CODE_OAUTH_TOKEN` | `anthropic_oauth_token` |
| OpenAI/Codex    | `OPENAI_API_KEY`          | `openai_api_key`        |
| PagerDuty       | `PAGERDUTY_TOKEN`         | `pagerduty_token`       |
| Sentry          | `SENTRY_AUTH_TOKEN`       | `sentry_auth_token`     |
| Grafana         | `GRAFANA_API_KEY`         | `grafana_api_key`       |
| npm             | `NPM_TOKEN`              | `npm_token`             |
| Docker Hub      | `DOCKER_TOKEN`            | `docker_token`          |
| Talos           | `TALOS_TOKEN`             | `talos_token`           |

## Credential Priority

1. **Environment variables** (highest)
2. **1Password references**
3. **Secret files** in `~/.clauderon/secrets/` (lowest)

## 1Password Integration

```toml
# ~/.clauderon/proxy.toml
[onepassword]
enabled = true
op_path = "op"

[onepassword.credentials]
github_token = "op://Private/GitHub/token"
anthropic_oauth_token = "op://Private/Claude/oauth-token"
openai_api_key = "op://Work/OpenAI/api-key"
```

See [1Password Guide](/guides/onepassword/) for details.

## Access Modes

```bash
# Restrict to read-only (allows GET, HEAD, OPTIONS only)
clauderon set-access-mode <session-name> read-only

# Re-enable writes (default)
clauderon set-access-mode <session-name> read-write

# Create session in read-only mode
clauderon create --access-mode read-only --repo ~/project --prompt "Review the code"
```

See [Access Modes Guide](/guides/access-modes/) for details.

## Audit Logging

All proxied requests are logged to `~/.clauderon/audit.jsonl`:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "session_id": "abc123",
  "service": "github",
  "method": "GET",
  "path": "/repos/owner/repo",
  "auth_injected": true,
  "response_code": 200,
  "duration_ms": 150
}
```

```bash
# View recent requests
tail -f ~/.clauderon/audit.jsonl | jq

# Find all write operations
jq 'select(.method != "GET")' ~/.clauderon/audit.jsonl

# Find failed requests
jq 'select(.response_code >= 400)' ~/.clauderon/audit.jsonl
```

## Proxy Configuration

```toml
# ~/.clauderon/proxy.toml
secrets_dir = "~/.clauderon/secrets"
audit_enabled = true
audit_log_path = "~/.clauderon/audit.jsonl"

[onepassword]
enabled = false
op_path = "op"

[onepassword.credentials]
github_token = ""
anthropic_oauth_token = ""
```

## Security Notes

- Credentials never exposed to agent processes
- Secret files require 0600 permissions
- CA private key never mounted in containers
- Proxy binds to localhost only
- Sessions cannot bypass the proxy

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Certificate errors | `rm ~/.clauderon/proxy-ca*.pem && clauderon daemon` |
| Credentials not injecting | Check `clauderon config credentials` and `tail -f ~/.clauderon/audit.jsonl \| jq` |
| Proxy unreachable | Verify daemon: `curl http://localhost:3030/health` |

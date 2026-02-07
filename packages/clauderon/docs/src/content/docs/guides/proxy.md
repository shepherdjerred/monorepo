---
title: Credential Proxy
description: How clauderon secures credentials with HTTP proxy interception
---

The credential proxy is the core security component of clauderon. It intercepts HTTP/HTTPS requests and injects credentials at request time, ensuring AI agents never see your actual tokens.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│ clauderon Proxy │────▶│   API Server    │
│ (placeholder    │     │ (injects real   │     │ (receives real  │
│  credentials)   │     │  credentials)   │     │  credentials)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## How It Works

1. **Agent Configuration**: AI agents run with placeholder credentials
2. **Request Interception**: All HTTP/HTTPS traffic routes through the proxy
3. **Credential Injection**: The proxy replaces placeholders with real tokens
4. **Access Control**: Read-only mode blocks write operations
5. **Audit Logging**: All requests are logged for security review
6. **Response Forwarding**: Responses are passed back to the agent

## TLS Interception

For HTTPS traffic, clauderon generates a Certificate Authority (CA) that:

- Signs certificates on-the-fly for each requested domain
- Is trusted by the session environment
- Enables credential injection for encrypted traffic

### CA Certificate Location

```
~/.clauderon/proxy-ca.pem      # Public certificate (mounted in containers)
~/.clauderon/proxy-ca-key.pem  # Private key (host only, never mounted)
```

Sessions automatically trust this CA via environment configuration.

## Supported Credential Types

| Credential | Environment Variable | Secret File |
|------------|---------------------|-------------|
| GitHub | `GITHUB_TOKEN` | `github_token` |
| Anthropic OAuth | `CLAUDE_CODE_OAUTH_TOKEN` | `anthropic_oauth_token` |
| OpenAI/Codex | `OPENAI_API_KEY` | `openai_api_key` |
| PagerDuty | `PAGERDUTY_TOKEN` | `pagerduty_token` |
| Sentry | `SENTRY_AUTH_TOKEN` | `sentry_auth_token` |
| Grafana | `GRAFANA_API_KEY` | `grafana_api_key` |
| npm | `NPM_TOKEN` | `npm_token` |
| Docker Hub | `DOCKER_TOKEN` | `docker_token` |
| Kubernetes | `K8S_TOKEN` | `k8s_token` |
| Talos | `TALOS_TOKEN` | `talos_token` |

## Credential Priority

When multiple sources define the same credential:

1. **Environment variables** (highest priority)
2. **1Password references** (if configured)
3. **Secret files** in `~/.clauderon/secrets/` (lowest priority)

## 1Password Integration

Store credentials securely in 1Password and have clauderon retrieve them automatically.

Configure in `~/.clauderon/proxy.toml`:

```toml
[onepassword]
enabled = true
op_path = "op"  # Path to 1Password CLI

[onepassword.credentials]
github_token = "op://Private/GitHub/token"
anthropic_oauth_token = "op://Private/Claude/oauth-token"
openai_api_key = "op://Work/OpenAI/api-key"
```

See [1Password Guide](/guides/onepassword/) for detailed setup.

## Access Modes

Control what HTTP methods are allowed per session:

### Read-Only Mode

- Allows: GET, HEAD, OPTIONS
- Blocks: POST, PUT, DELETE, PATCH
- Use case: Safe exploration, code review

### Read-Write Mode (Default)

- Allows: All HTTP methods
- Required for: commits, PRs, deployments

### Changing Mode

```bash
# Restrict to read-only
clauderon set-access-mode <session-name> read-only

# Re-enable writes
clauderon set-access-mode <session-name> read-write
```

Or create a session in read-only mode:

```bash
clauderon create --access-mode read-only \
  --repo ~/project --prompt "Review the code"
```

See [Access Modes Guide](/guides/access-modes/) for detailed usage.

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

Configure in `~/.clauderon/proxy.toml`:

```toml
audit_enabled = true
audit_log_path = "~/.clauderon/audit.jsonl"
```

### Analyzing Audit Logs

```bash
# View recent requests
tail -f ~/.clauderon/audit.jsonl | jq

# Find all write operations
jq 'select(.method != "GET")' ~/.clauderon/audit.jsonl

# Find failed requests
jq 'select(.response_code >= 400)' ~/.clauderon/audit.jsonl
```

## Proxy Configuration

Configure the proxy in `~/.clauderon/proxy.toml`:

```toml
# Secrets directory
secrets_dir = "~/.clauderon/secrets"

# Audit logging
audit_enabled = true
audit_log_path = "~/.clauderon/audit.jsonl"

# Talos gateway (for Kubernetes cluster access)
talos_gateway_port = 18082
kubectl_proxy_port = 18081

# 1Password integration
[onepassword]
enabled = false
op_path = "op"

[onepassword.credentials]
github_token = ""
anthropic_oauth_token = ""
```

## Security Considerations

### Credential Isolation

- Credentials are never exposed to the agent process
- The proxy runs in the daemon process with restricted permissions
- Secret files have strict permissions (0600)

### TLS Security

- Each domain gets dynamically-signed certificates
- CA private keys are stored with strict permissions (0600)
- CA private key is never mounted in containers

### Network Security

- Proxy binds to localhost by default
- Sessions cannot bypass the proxy (no direct internet access)
- All traffic is logged and auditable

## Troubleshooting

### Certificate Errors

If you see certificate verification errors:

```bash
# Regenerate the CA (will require daemon restart)
rm ~/.clauderon/proxy-ca.pem ~/.clauderon/proxy-ca-key.pem
clauderon daemon
```

### Credentials Not Injecting

Check the audit log:

```bash
tail -f ~/.clauderon/audit.jsonl | jq
```

Verify credential files exist:

```bash
clauderon config credentials
```

### Proxy Not Reachable

Check the daemon is running:

```bash
curl http://localhost:3030/health
```

Verify proxy is listening:

```bash
curl -x http://localhost:3030 https://api.github.com
```

## See Also

- [Access Modes Guide](/guides/access-modes/) - Read-only vs read-write
- [1Password Guide](/guides/onepassword/) - Secure credential storage
- [Configuration Reference](/reference/configuration/) - All proxy settings
- [Troubleshooting](/guides/troubleshooting/) - Common issues

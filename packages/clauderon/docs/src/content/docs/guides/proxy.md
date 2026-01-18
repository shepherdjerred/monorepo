---
title: Credential Proxy
description: How clauderon secures credentials with HTTP proxy interception
---

The credential proxy is the core security component of clauderon. It intercepts HTTP/HTTPS requests and injects credentials at request time.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│   clauderon Proxy     │────▶│   API Server    │
│ (placeholder    │     │ (injects real   │     │ (receives real  │
│  credentials)   │     │  credentials)   │     │  credentials)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## How It Works

1. **Agent Configuration**: AI agents run with placeholder credentials
2. **Request Interception**: All HTTP/HTTPS traffic routes through the proxy
3. **Credential Injection**: The proxy replaces placeholders with real tokens
4. **Request Filtering**: Malicious patterns are blocked
5. **Response Forwarding**: Responses are passed back to the agent

## TLS Interception

For HTTPS traffic, clauderon generates a Certificate Authority (CA) that:

- Signs certificates for each requested domain
- Is trusted by the session environment
- Enables credential injection for encrypted traffic

### CA Certificate Location

The CA certificate is stored at:

```
~/.config/clauderon/ca/ca.crt
```

Sessions automatically trust this CA via environment configuration.

## Configuration

Configure the proxy in `~/.config/clauderon/config.toml`:

```toml
[proxy]
# Proxy listen port
port = 8080

# Bind address (localhost for security)
bind = "127.0.0.1"

# Auto-generate TLS certificates
generate_certs = true

# CA certificate lifetime (days)
ca_lifetime = 365

# Request timeout (seconds)
timeout = 30

[proxy.logging]
# Log all requests (for debugging)
log_requests = false

# Log file location
log_file = "~/.config/clauderon/proxy.log"
```

## Credential Configuration

Define which credentials to inject:

```toml
[credentials.anthropic]
# Header to inject
header = "x-api-key"

# Or Authorization header
# auth_type = "bearer"

# The actual credential (use env var reference)
value = "${ANTHROPIC_API_KEY}"

# Domain pattern to match
domains = ["api.anthropic.com"]

[credentials.github]
header = "Authorization"
auth_type = "bearer"
value = "${GITHUB_TOKEN}"
domains = ["api.github.com", "github.com"]

# HTTP Basic Auth for git operations
[credentials.github_basic]
auth_type = "basic"
username = "x-access-token"
password = "${GITHUB_TOKEN}"
domains = ["github.com"]
```

## Request Filtering

Block potentially dangerous requests:

```toml
[proxy.filters]
# Block requests to these domains
blocked_domains = [
  "*.evil.com",
  "malware.example.org"
]

# Block requests matching these patterns
blocked_patterns = [
  "rm -rf /",
  "DROP TABLE",
]

# Allow-list mode (only specified domains allowed)
# allowlist_only = true
# allowed_domains = ["api.anthropic.com", "api.github.com"]
```

## Security Considerations

### Credential Isolation

- Credentials are never exposed to the agent process
- The proxy runs in a separate process with restricted permissions
- Credentials are loaded at proxy startup, not stored in memory long-term

### TLS Security

- Each session gets unique TLS certificates
- CA private keys are stored with strict permissions (0600)
- Certificates have limited validity periods

### Network Security

- Proxy binds to localhost by default
- Sessions cannot bypass the proxy
- Outbound traffic is logged and filterable

## Troubleshooting

### Certificate Errors

If you see certificate verification errors:

```bash
# Regenerate the CA
rm -rf ~/.config/clauderon/ca
clauderon proxy --regenerate-ca
```

### Credentials Not Injecting

Check the proxy logs:

```bash
tail -f ~/.config/clauderon/proxy.log
```

Verify domain patterns match:

```bash
# Test with curl through the proxy
curl -x http://localhost:8080 https://api.anthropic.com/v1/messages
```

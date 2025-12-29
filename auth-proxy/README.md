# Auth Proxy for Claude Code

Zero-trust credential management for Claude Code containers. The container has
**no credentials** - the proxy intercepts requests and injects auth headers.

## Why?

Prompt injection or malicious MCP servers could exfiltrate credentials from
inside the container. By keeping credentials on the host and injecting them
via proxy, the container has nothing sensitive to steal.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        HOST                              │
│                                                          │
│  ~/.config/secrets/    ┌──────────────────────────┐     │
│  ├── github_token      │     Auth Proxy (:8080)   │     │
│  ├── anthropic_key ───▶│                          │     │
│  ├── pagerduty_token   │  Intercepts HTTPS        │     │
│  └── k8s_token         │  Injects auth headers    │     │
│                        └────────────┬─────────────┘     │
│                                     │                    │
│  ┌──────────────────────────────────┴────────────────┐  │
│  │              Container (Claude Code)              │  │
│  │                                                   │  │
│  │  curl api.github.com/user                         │  │
│  │       └──▶ proxy adds Authorization header        │  │
│  │                                                   │  │
│  │  ✅ Can call GitHub, Claude, PagerDuty, etc.     │  │
│  │  ❌ Has no tokens/keys to exfiltrate              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install mitmproxy

```bash
pip install mitmproxy
# or
brew install mitmproxy
```

### 2. Set credentials on host

```bash
export GITHUB_TOKEN="ghp_xxxx"
export ANTHROPIC_API_KEY="sk-ant-xxxx"
export PAGERDUTY_TOKEN="xxxx"
export SENTRY_AUTH_TOKEN="xxxx"
export K8S_TOKEN="eyJhbGc..."
```

### 3. Start the proxy

```bash
./run-proxy.sh
```

### 4. Run container with proxy

```bash
docker run -it \
  -e HTTP_PROXY=http://host.docker.internal:8080 \
  -e HTTPS_PROXY=http://host.docker.internal:8080 \
  -e NODE_EXTRA_CA_CERTS=/etc/ssl/certs/mitmproxy-ca.pem \
  -v ~/.mitmproxy/mitmproxy-ca-cert.pem:/etc/ssl/certs/mitmproxy-ca.pem:ro \
  your-claude-code-image
```

## Supported Services

| Service    | Host Pattern          | Header            | Env Var              |
|------------|----------------------|-------------------|----------------------|
| GitHub     | api.github.com       | Authorization     | GITHUB_TOKEN         |
| Claude     | api.anthropic.com    | x-api-key         | ANTHROPIC_API_KEY    |
| PagerDuty  | api.pagerduty.com    | Authorization     | PAGERDUTY_TOKEN      |
| Sentry     | sentry.io            | Authorization     | SENTRY_AUTH_TOKEN    |
| Kubernetes | */api/v1, :6443      | Authorization     | K8S_TOKEN            |
| Talos      | :50000               | Authorization     | TALOS_TOKEN          |

### Multi-cluster Kubernetes

```bash
export K8S_TOKEN_PROD="token-for-prod"
export K8S_TOKEN_STAGING="token-for-staging"
```

The proxy matches cluster name in the hostname.

## HTTPS Interception

The proxy needs to decrypt HTTPS to inject headers. This requires:

1. **Trust the mitmproxy CA** in the container
2. **Set SSL env vars** so tools use the CA

```bash
# In container
export NODE_EXTRA_CA_CERTS=/path/to/mitmproxy-ca-cert.pem
export REQUESTS_CA_BUNDLE=/path/to/mitmproxy-ca-cert.pem
export SSL_CERT_FILE=/path/to/mitmproxy-ca-cert.pem
```

## Limitations

### gRPC/mTLS Services

Some services (Kubernetes with client certs, Talos with mTLS) don't work with
a simple HTTP proxy. For these:

1. **Use bearer tokens** instead of mTLS where possible
2. **Run a gRPC gateway** that terminates mTLS
3. **Use kubectl/talosctl proxy** mode

### Tools that ignore HTTP_PROXY

Some CLI tools don't respect proxy env vars. Workarounds:

- Use `proxychains` to force proxying
- Configure tool-specific proxy settings
- Use a transparent proxy with iptables

## Security Notes

- The proxy runs on the host with access to all credentials
- Container network is unrestricted (can reach proxy)
- Consider also rate-limiting/auditing requests in the proxy
- For production, add mutual TLS between container and proxy

## Adding New Services

Edit `proxy.py`:

```python
RULES.append((
    "api.newservice.com",  # Host pattern
    "Authorization",        # Header name
    "NEWSERVICE_TOKEN"      # Env var
))
```

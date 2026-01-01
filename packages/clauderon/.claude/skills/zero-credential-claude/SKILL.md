---
name: zero-credential-claude
description: Explains how Claude Code works in containers with zero credentials via the mux proxy. Use when testing Claude in containers, debugging authentication issues, or understanding the zero-trust proxy architecture.
---

# Zero-Credential Claude Code in Containers

## Overview

The multiplexer enables Claude Code to run in Docker containers with **zero real credentials**. The host proxy intercepts HTTPS requests and injects authentication, so containers never see actual API keys or tokens.

## Architecture

```
Container (placeholder creds) → HTTPS Proxy (TLS intercept) → api.anthropic.com
                                       ↓
                              Inject: Authorization: Bearer {real_oauth_token}
```

## How It Works

### 1. OAuth Token Loading

The daemon loads the real OAuth token from `CLAUDE_CODE_OAUTH_TOKEN` environment variable on the host:

```rust
// src/proxy/config.rs
anthropic_oauth_token: std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok(),
```

### 2. Container Setup

Containers receive placeholder credentials that make Claude Code think it's authenticated:

```rust
// src/backends/docker.rs
"-e", "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-mux-proxy-placeholder"
```

A `claude.json` file is mounted to skip onboarding:

```json
{"hasCompletedOnboarding": true}
```

### 3. Proxy Credential Injection

The HTTP proxy intercepts requests to `api.anthropic.com` and:

1. Removes any existing auth headers (placeholder credentials)
2. Injects OAuth token with Bearer auth

```rust
// src/proxy/http_proxy.rs - Anthropic uses Bearer auth for OAuth
req.headers_mut().remove("authorization");
("authorization", format!("Bearer {}", token))
```

### 4. Execution Modes

The Docker backend supports two execution modes:

#### Interactive Mode (default)

Containers run Claude Code interactively, allowing you to attach and have a conversation:

```bash
claude --dangerously-skip-permissions 'initial prompt here'
```

After the session is created, attach to interact with Claude:

```bash
mux session attach <session-name>
# Or directly with docker:
docker attach mux-<session-name>
```

#### Non-Interactive (Print) Mode

For CI/CD pipelines or scripted usage, use print mode. The container outputs the response and exits:

```bash
claude --dangerously-skip-permissions --print --verbose 'prompt here'
```

To enable print mode programmatically:

```rust
// src/backends/docker.rs
let backend = DockerBackend::with_proxy(proxy_config)
    .with_print_mode(true);
```

Print mode is useful for:
- CI/CD pipelines where interactive input isn't possible
- Automated testing
- One-shot queries that don't need follow-up

## Testing Claude in Containers

### Prerequisites

1. Set your OAuth token on the host:
   ```bash
   export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-your-real-token
   ```

2. Start the mux daemon:
   ```bash
   cargo run --bin mux daemon
   ```

### Create a Test Session

```bash
cargo run --bin mux session create --name test-session --prompt "Say hello"
```

### Manual Container Test

To manually test without creating a full session:

```bash
# Start the daemon first
cargo run --bin mux daemon &

# Run a container with the proxy setup
docker run -it --rm \
  -e CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-mux-proxy-placeholder \
  -e HTTPS_PROXY=http://host.docker.internal:18080 \
  -e HTTP_PROXY=http://host.docker.internal:18080 \
  -v ~/.clauderon/proxy-ca.pem:/etc/ssl/certs/mux-proxy-ca.pem:ro \
  -v ~/.clauderon/claude.json:/root/.claude.json \
  your-claude-image \
  claude --print "Hello, Claude!"
```

### Verify Proxy is Injecting Credentials

Check the audit log at `~/.clauderon/audit.jsonl`:

```bash
tail -f ~/.clauderon/audit.jsonl | jq
```

Look for entries with `"auth_injected": true` for `api.anthropic.com` requests.

### Debug Container Issues

1. **Check daemon logs** for proxy activity
2. **Verify CA cert** is trusted in container: `curl -v https://api.anthropic.com`
3. **Check environment** in container: `env | grep -E '(PROXY|CLAUDE)'`

## Common Issues

### "OAuth authentication is currently not supported"

The proxy is using `x-api-key` header instead of `Authorization: Bearer`. Ensure:
- Token starts with `sk-ant-oat01-`
- Proxy rules are updated to use Bearer auth

### Onboarding Prompt Appears

The `claude.json` file is missing or not mounted. Verify:
```bash
cat ~/.clauderon/claude.json
# Should contain: {"hasCompletedOnboarding": true}
```

### "Do you want to use this API key?" Prompt

Using `ANTHROPIC_API_KEY` instead of `CLAUDE_CODE_OAUTH_TOKEN`. The latter triggers OAuth flow detection and skips this prompt.

### Read-Only Filesystem Error

The `claude.json` mount must NOT be read-only (`:ro`). Claude Code writes to this file.

## Key Files

| File | Purpose |
|------|---------|
| `src/proxy/rules.rs` | Defines which hosts get auth injection |
| `src/proxy/http_proxy.rs` | TLS interception and header injection |
| `src/proxy/config.rs` | Credential loading from environment |
| `src/backends/docker.rs` | Container creation with proxy setup |
| `~/.clauderon/proxy-ca.pem` | CA certificate for TLS interception |
| `~/.clauderon/audit.jsonl` | Audit log of proxied requests |

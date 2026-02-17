---
title: Feature Flags
description: Experimental and optional features controlled by feature flags
---

Feature flags control experimental and optional functionality in clauderon. Flags are loaded at daemon startup and require a daemon restart to change.

## Configuration Priority

Feature flags can be set in multiple places. Priority order (highest to lowest):

1. **CLI flags** - `clauderon daemon --enable-kubernetes-backend`
2. **Environment variables** - `CLAUDERON_FEATURE_ENABLE_KUBERNETES_BACKEND=1`
3. **Config file** - `~/.clauderon/config.toml`
4. **Defaults**

## Available Flags

| Flag                        | Default | Description                                 |
| --------------------------- | ------- | ------------------------------------------- |
| `enable_webauthn_auth`      | `false` | WebAuthn passwordless authentication        |
| `enable_ai_metadata`        | `true`  | AI-generated session titles                 |
| `enable_auto_reconcile`     | `true`  | Auto-sync database with backends on startup |
| `enable_proxy_port_reuse`   | `false` | Reuse proxy ports across sessions           |
| `enable_usage_tracking`     | `false` | Track Claude API usage per session          |
| `enable_kubernetes_backend` | `false` | Enable Kubernetes backend                   |

## Flag Details

### enable_webauthn_auth

**Default:** `false`

Enables WebAuthn (passkey) authentication for the web UI. When enabled, users can register hardware security keys or platform authenticators for passwordless login.

```bash
# CLI
clauderon daemon --enable-webauthn-auth

# Environment
export CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH=1

# Config file (~/.clauderon/config.toml)
[feature_flags]
enable_webauthn_auth = true
```

**Requirements:**

- HTTPS or localhost (WebAuthn security requirement)
- `CLAUDERON_ORIGIN` set for non-localhost deployments

---

### enable_ai_metadata

**Default:** `true`

Uses Claude to generate descriptive session titles from the initial prompt. For example, a prompt like "Fix the login bug in auth.ts" might generate a title like "Auth Login Bug Fix".

```bash
# Disable AI metadata
clauderon daemon --enable-ai-metadata=false

# Environment
export CLAUDERON_FEATURE_ENABLE_AI_METADATA=0
```

**Requirements:**

- Valid Anthropic API credentials

---

### enable_auto_reconcile

**Default:** `true`

Automatically reconciles the database with actual backend state on daemon startup. This detects:

- Orphaned worktrees (database entry exists but worktree deleted)
- Missing backends (database says running but container/pod gone)
- Stale sessions stuck in transitional states

```bash
# Disable auto-reconcile
clauderon daemon --enable-auto-reconcile=false
```

---

### enable_proxy_port_reuse

**Default:** `false` (experimental)

Enables reusing proxy ports across sessions instead of allocating a fresh port per session. Reduces port exhaustion on systems with many sessions but may cause conflicts if ports aren't properly released.

```bash
clauderon daemon --enable-proxy-port-reuse
```

---

### enable_usage_tracking

**Default:** `false`

Tracks Claude API usage (tokens, costs) per session. Usage data is stored in the database and can be viewed in the web UI.

```bash
clauderon daemon --enable-usage-tracking
```

---

### enable_kubernetes_backend

**Default:** `false` (experimental)

Enables the Kubernetes backend, allowing sessions to run as pods in a Kubernetes cluster.

```bash
clauderon daemon --enable-kubernetes-backend
```

**Requirements:**

- Kubernetes cluster (1.24+)
- kubectl configured with cluster access
- Namespace for clauderon pods (default: `clauderon`)
- Storage class for persistent volumes

**Usage:**

```bash
# Start daemon with K8s backend enabled
clauderon daemon --enable-kubernetes-backend

# Create a session using K8s
clauderon create --backend kubernetes --repo ~/project --prompt "Deploy app"
```

See [Kubernetes Backend Guide](/guides/kubernetes/) for full setup instructions.

## Config File Format

Feature flags in `~/.clauderon/config.toml`:

```toml
[feature_flags]
enable_webauthn_auth = false
enable_ai_metadata = true
enable_auto_reconcile = true
enable_proxy_port_reuse = false
enable_usage_tracking = false
enable_kubernetes_backend = false
```

## Environment Variable Format

All feature flag environment variables follow the pattern:

```
CLAUDERON_FEATURE_<FLAG_NAME_UPPERCASE>=<value>
```

Accepted values for boolean flags:

- **True:** `true`, `1`, `yes`, `on`
- **False:** `false`, `0`, `no`, `off`

## Checking Current Flags

View the current feature flag state in daemon logs:

```bash
# Start daemon and check logs
clauderon daemon

# In logs you'll see:
# Feature flags loaded:
#   enable_webauthn_auth: false
#   enable_ai_metadata: true
#   ...
```

## See Also

- [CLI Reference](/reference/cli/) - All daemon command options
- [Configuration Reference](/reference/configuration/) - Config file format
- [Kubernetes Backend](/guides/kubernetes/) - K8s setup guide

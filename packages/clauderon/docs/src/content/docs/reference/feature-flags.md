---
title: Feature Flags
description: Experimental and optional features controlled by feature flags
---

Loaded at daemon startup. Require restart to change.

## Priority

1. **CLI flags** -- `clauderon daemon --enable-webauthn-auth`
2. **Environment variables** -- `CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH=1`
3. **Config file** -- `~/.clauderon/config.toml`
4. **Defaults**

## Available Flags

| Flag                         | Default | Description                                          |
| ---------------------------- | ------- | ---------------------------------------------------- |
| `enable_webauthn_auth`       | `false` | WebAuthn passwordless authentication                 |
| `enable_ai_metadata`         | `true`  | AI-generated session titles from prompts             |
| `enable_auto_reconcile`      | `true`  | Auto-sync database with backends on startup          |
| `enable_proxy_port_reuse`    | `false` | Reuse proxy ports across sessions (experimental)     |
| `enable_usage_tracking`      | `false` | Track Claude API usage per session                   |
| `enable_experimental_models` | `false` | Enable Codex/Gemini models                           |
| `enable_readonly_mode`       | `false` | Read-only proxy mode (experimental, known issues #424, #205) |

## Configuration Examples

```bash
# CLI
clauderon daemon --enable-webauthn-auth --enable-usage-tracking

# Environment
export CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH=1
export CLAUDERON_FEATURE_ENABLE_AI_METADATA=0
clauderon daemon
```

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
```

## Flag Requirements

| Flag                    | Requirements                                      |
| ----------------------- | ------------------------------------------------- |
| `enable_webauthn_auth`  | HTTPS or localhost; `CLAUDERON_ORIGIN` for remote  |
| `enable_ai_metadata`    | Valid Anthropic API credentials                    |
| `enable_auto_reconcile` | Detects orphaned worktrees, missing backends, stale sessions |

## Environment Variable Format

Pattern: `CLAUDERON_FEATURE_<FLAG_NAME_UPPERCASE>=<value>`

Boolean values: `true`/`1`/`yes`/`on` or `false`/`0`/`no`/`off`

Feature flag state logged at daemon startup.

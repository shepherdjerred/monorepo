---
title: Configuration Audit
description: Where each setting can be configured across interfaces
---

clauderon settings can be configured via multiple interfaces. This audit documents
which interfaces support each setting and highlights inconsistencies.

## Configuration Priority

When a setting is available in multiple places, priority order is:

1. **CLI arguments** - Highest priority
2. **Environment variables**
3. **1Password** (credentials only)
4. **Config files** (`~/.clauderon/*.toml`)
5. **Secret files** (`~/.clauderon/secrets/`)
6. **Defaults** - Lowest priority

## Feature Flags

All 6 feature flags support CLI, env var, and config file. None support runtime API modification.

| Flag                        | CLI | Env Var | Config | API | TUI | Web UI |
| --------------------------- | --- | ------- | ------ | --- | --- | ------ |
| `enable_webauthn_auth`      | ✓   | ✓       | ✓      | GET | —   | GET    |
| `enable_ai_metadata`        | ✓   | ✓       | ✓      | GET | —   | GET    |
| `enable_auto_reconcile`     | ✓   | ✓       | ✓      | GET | —   | GET    |
| `enable_proxy_port_reuse`   | ✓   | ✓       | ✓      | GET | —   | GET    |
| `enable_usage_tracking`     | ✓   | ✓       | ✓      | GET | —   | GET    |
| `enable_kubernetes_backend` | ✓   | ✓       | ✓      | GET | —   | GET    |

**Gap:** Feature flags cannot be modified at runtime via API/UI.

## Credentials

### Standard Credentials

| Credential              | Env Var | Secret File | 1Password | API | Web UI | TUI |
| ----------------------- | ------- | ----------- | --------- | --- | ------ | --- |
| `github_token`          | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `anthropic_oauth_token` | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `openai_api_key`        | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `pagerduty_token`       | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `sentry_auth_token`     | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `grafana_api_key`       | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `npm_token`             | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `docker_token`          | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `k8s_token`             | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |
| `talos_token`           | ✓       | ✓           | ✓         | ✓\* | ✓\*    | —   |

\*Blocked if set via env var (becomes read-only)

**Gap:** TUI has no credential status display or editing.

### Codex Tokens

| Token                 | Env Var | auth.json | Secret File | 1Password | API | Web UI |
| --------------------- | ------- | --------- | ----------- | --------- | --- | ------ |
| `codex_access_token`  | ✓       | ✓         | —           | —         | —   | —      |
| `codex_refresh_token` | ✓       | ✓         | —           | —         | —   | —      |
| `codex_id_token`      | ✓       | ✓         | —           | —         | —   | —      |
| `codex_account_id`    | ✓       | ✓         | —           | —         | —   | —      |

**Gap:** Codex tokens don't support 1Password, secret files, or API/UI updates.

## Codex vs Claude Parity

Claude credentials receive less complete treatment than Codex.

| Feature                    | Codex                               | Claude                   |
| -------------------------- | ----------------------------------- | ------------------------ |
| Auto-detect host auth file | ✓ `~/.codex/auth.json`              | —                        |
| Source path in UI          | ✓ `"auth.json:path"`                | — (shows generic "file") |
| Config path override       | ✓ `codex_auth_json_path`            | —                        |
| Env var path override      | ✓ `CODEX_AUTH_JSON_PATH`            | —                        |
| Dedicated CLI function     | ✓ `print_codex_credential_status()` | — (uses generic)         |
| Service branding           | ✓ "ChatGPT"                         | — "Anthropic"            |
| Account/Org display        | ✓ Shows account ID                  | —                        |
| Dedicated proxy module     | ✓ `src/proxy/codex.rs`              | —                        |
| Token persistence          | ✓ Writes to auth.json               | —                        |

**Bug:** Claude may show "NOT detected" in Web UI even when working.

## Server Settings

| Setting           | Env Var                 | Config | CLI             | API |
| ----------------- | ----------------------- | ------ | --------------- | --- |
| `bind_address`    | ✓ `CLAUDERON_BIND_ADDR` | —      | —               | —   |
| `http_port`       | —                       | —      | ✓ `--http-port` | —   |
| `dev_mode`        | ✓ `CLAUDERON_DEV`       | —      | ✓ `--dev`       | —   |
| `no_proxy`        | —                       | —      | ✓ `--no-proxy`  | —   |
| `webauthn_origin` | ✓ `CLAUDERON_ORIGIN`    | —      | —               | —   |
| `log_level`       | ✓ `RUST_LOG`            | —      | —               | —   |

**Gap:** `bind_address` is env-only, `http_port` is CLI-only.

## Proxy Settings

| Setting                | Env Var | Config         | CLI | API |
| ---------------------- | ------- | -------------- | --- | --- |
| `secrets_dir`          | —       | ✓ `proxy.toml` | —   | —   |
| `talos_gateway_port`   | —       | ✓ `proxy.toml` | —   | —   |
| `kubectl_proxy_port`   | —       | ✓ `proxy.toml` | —   | —   |
| `audit_enabled`        | —       | ✓ `proxy.toml` | —   | —   |
| `onepassword.enabled`  | —       | ✓ `proxy.toml` | —   | —   |
| `codex_auth_json_path` | ✓       | ✓ `proxy.toml` | —   | —   |

**Gap:** Most proxy settings are file-only with no env var override.

## Backend Configs

| Config                        | Env Var | CLI | API |
| ----------------------------- | ------- | --- | --- |
| `docker-config.toml`          | —       | —\* | —   |
| `k8s-config.toml`             | —       | —   | —   |
| `sprites-config.toml`         | —       | —   | —   |
| `apple-container-config.toml` | —       | —   | —   |

\*CLI has per-session overrides (`--image`, `--cpu-limit`) but not global config.

**Gap:** Backend configs are file-only.

## TUI Gaps

The TUI is missing credential functionality that exists in CLI and Web UI:

| Feature                    | CLI            | Web UI         | TUI |
| -------------------------- | -------------- | -------------- | --- |
| Credential status display  | ✓              | ✓              | —   |
| Source attribution         | ✓              | ✓              | —   |
| Detected/missing indicator | ✓              | ✓              | —   |
| Credential editing         | —              | ✓              | —   |
| Settings screen            | ✓ `config` cmd | ✓ StatusDialog | —   |

## Summary of Gaps

| Category        | Issue                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| Codex vs Claude | Claude missing: host detection, source attribution, branding, org display |
| Server settings | `bind_address` env-only, `http_port` CLI-only                             |
| Proxy settings  | File-only, no env var overrides                                           |
| Backend configs | File-only, no env/CLI/API                                                 |
| Feature flags   | No runtime modification                                                   |
| Codex tokens    | No 1Password/secret file/API unlike other credentials                     |
| TUI             | No credential status screen                                               |

## See Also

- [Configuration Reference](/reference/configuration/) - Config file formats
- [Environment Variables](/reference/environment-variables/) - All env vars
- [Feature Flags](/reference/feature-flags/) - Flag details

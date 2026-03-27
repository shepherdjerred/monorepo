---
title: Configuration Audit
description: Where each setting can be configured across interfaces
---

## Configuration Priority

1. **CLI arguments** (highest)
2. **Environment variables**
3. **1Password** (credentials only)
4. **Config files** (`~/.clauderon/*.toml`)
5. **Secret files** (`~/.clauderon/secrets/`)
6. **Defaults** (lowest)

## Feature Flags

All 6 flags support CLI, env var, and config file. None support runtime API modification.

| Flag                      | CLI | Env | Config | API |
| ------------------------- | --- | --- | ------ | --- |
| `enable_webauthn_auth`    | ✓   | ✓   | ✓      | GET |
| `enable_ai_metadata`      | ✓   | ✓   | ✓      | GET |
| `enable_auto_reconcile`   | ✓   | ✓   | ✓      | GET |
| `enable_proxy_port_reuse` | ✓   | ✓   | ✓      | GET |
| `enable_usage_tracking`   | ✓   | ✓   | ✓      | GET |

## Credentials

| Credential              | Env | File | 1Password | API/Web | TUI |
| ----------------------- | --- | ---- | --------- | ------- | --- |
| `github_token`          | ✓   | ✓    | ✓         | ✓\*     | --  |
| `anthropic_oauth_token` | ✓   | ✓    | ✓         | ✓\*     | --  |
| `openai_api_key`        | ✓   | ✓    | ✓         | ✓\*     | --  |
| `pagerduty_token`       | ✓   | ✓    | ✓         | ✓\*     | --  |
| `sentry_auth_token`     | ✓   | ✓    | ✓         | ✓\*     | --  |
| `grafana_api_key`       | ✓   | ✓    | ✓         | ✓\*     | --  |
| `npm_token`             | ✓   | ✓    | ✓         | ✓\*     | --  |
| `docker_token`          | ✓   | ✓    | ✓         | ✓\*     | --  |

\*Blocked if set via env var (becomes read-only)

### Codex Tokens

| Token                 | Env | auth.json | File | 1Password | API |
| --------------------- | --- | --------- | ---- | --------- | --- |
| `codex_access_token`  | ✓   | ✓         | --   | --        | --  |
| `codex_refresh_token` | ✓   | ✓         | --   | --        | --  |

**Gap:** Codex tokens don't support 1Password, secret files, or API/UI updates.

## Codex vs Claude Parity

| Feature                    | Codex                    | Claude       |
| -------------------------- | ------------------------ | ------------ |
| Auto-detect host auth file | ✓ `~/.codex/auth.json`   | --           |
| Source path in UI          | ✓ `"auth.json:path"`     | -- (generic) |
| Config path override       | ✓ `codex_auth_json_path` | --           |
| Dedicated proxy module     | ✓ `src/proxy/codex.rs`   | --           |
| Token persistence          | ✓ Writes to auth.json    | --           |

**Bug:** Claude may show "NOT detected" in Web UI even when working.

## Server Settings

| Setting        | Env                     | Config | CLI             |
| -------------- | ----------------------- | ------ | --------------- |
| `bind_address` | ✓ `CLAUDERON_BIND_ADDR` | --     | --              |
| `http_port`    | --                      | --     | ✓ `--http-port` |
| `dev_mode`     | ✓ `CLAUDERON_DEV`       | --     | ✓ `--dev`       |
| `no_proxy`     | --                      | --     | ✓ `--no-proxy`  |
| `log_level`    | ✓ `RUST_LOG`            | --     | --              |

## Proxy Settings

All proxy settings are file-only (`proxy.toml`), no env var overrides: `secrets_dir`, `talos_gateway_port`, `kubectl_proxy_port`, `audit_enabled`, `onepassword.enabled`, `codex_auth_json_path` (exception: has env var).

## Summary of Gaps

| Category        | Issue                                              |
| --------------- | -------------------------------------------------- |
| Codex vs Claude | Claude missing: host detection, source attribution |
| Server settings | `bind_address` env-only, `http_port` CLI-only      |
| Proxy settings  | File-only, no env var overrides                    |
| Backend configs | File-only, no env/CLI/API                          |
| Feature flags   | No runtime modification                            |
| Codex tokens    | No 1Password/secret file/API                       |
| TUI             | No credential status screen                        |

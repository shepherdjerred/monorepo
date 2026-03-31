---
title: Configuration Audit
description: Where each setting can be configured across interfaces
---

## Configuration Priority

1. **CLI arguments** (highest)
2. **Environment variables**
3. **Config files** (`~/.clauderon/*.toml`)
4. **Defaults** (lowest)

## Feature Flags

All flags support CLI, env var, and config file. None support runtime API modification.

| Flag                         | CLI | Env | Config | API |
| ---------------------------- | --- | --- | ------ | --- |
| `enable_webauthn_auth`       | ✓   | ✓   | ✓      | GET |
| `enable_ai_metadata`         | ✓   | ✓   | ✓      | GET |
| `enable_auto_reconcile`      | ✓   | ✓   | ✓      | GET |
| `enable_usage_tracking`      | ✓   | ✓   | ✓      | GET |
| `enable_experimental_models` | ✓   | ✓   | ✓      | GET |

## Server Settings

| Setting        | Env                     | Config | CLI             |
| -------------- | ----------------------- | ------ | --------------- |
| `bind_address` | ✓ `CLAUDERON_BIND_ADDR` | --     | --              |
| `http_port`    | --                      | --     | ✓ `--http-port` |
| `dev_mode`     | ✓ `CLAUDERON_DEV`       | --     | ✓ `--dev`       |
| `log_level`    | ✓ `RUST_LOG`            | --     | --              |

## Summary of Gaps

| Category        | Issue                                         |
| --------------- | --------------------------------------------- |
| Server settings | `bind_address` env-only, `http_port` CLI-only |
| Backend configs | File-only, no env/CLI/API                     |
| Feature flags   | No runtime modification                       |

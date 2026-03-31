---
title: Configuration Reference
description: Complete configuration file reference
---

## File Locations

```
~/.clauderon/
├── config.toml              # Main configuration
├── db.sqlite                # Session database
├── claude.json              # Claude Code settings
├── managed-settings.json    # Bypass permissions
├── worktrees/               # Git worktrees
├── uploads/                 # Uploaded images
├── logs/                    # Log files
└── codex/                   # Codex auth
```

## Main Configuration (config.toml)

```toml
# ~/.clauderon/config.toml

[feature_flags]
enable_webauthn_auth = false
enable_ai_metadata = true
enable_auto_reconcile = true
enable_usage_tracking = false
enable_experimental_models = false

[server]
bind_addr = "127.0.0.1"
# origin = "https://example.com"  # For non-localhost WebAuthn
# disable_auth = false
# org_id = ""
```

## Example: Full Production

```toml
# ~/.clauderon/config.toml
[feature_flags]
enable_webauthn_auth = true
enable_ai_metadata = true
enable_auto_reconcile = true
enable_usage_tracking = true
enable_experimental_models = true

[server]
bind_addr = "0.0.0.0"
origin = "https://clauderon.example.com"
```

## Validation

```bash
clauderon config show         # current configuration
clauderon config paths        # file paths
```

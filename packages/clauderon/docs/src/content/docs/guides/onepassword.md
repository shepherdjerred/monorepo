---
title: 1Password Integration
description: Secure credential management with 1Password
---

## Setup

### 1. Install 1Password CLI

```bash
brew install 1password-cli          # macOS

# Linux (amd64)
curl -sS https://downloads.1password.com/linux/tar/amd64/op.tar.gz | tar -xz
sudo mv op /usr/local/bin/
```

### 2. Sign In

```bash
op signin
op vault list   # Verify access
```

### 3. Configure clauderon

Store credentials in 1Password, then reference them in `~/.clauderon/proxy.toml`:

```toml
[onepassword]
enabled = true
op_path = "op"

[onepassword.credentials]
github_token = "op://Private/GitHub/token"
anthropic_oauth_token = "op://Private/Claude/oauth-token"
openai_api_key = "op://Work/OpenAI/api-key"
```

Reference format: `op://Vault/Item/Field`

### Finding References

```bash
op vault list
op item list --vault Private
op item get "GitHub" --vault Private
op read "op://Private/GitHub/token"
```

## Supported Credentials

| Credential      | Config Key              | Example Reference                 |
| --------------- | ----------------------- | --------------------------------- |
| GitHub          | `github_token`          | `op://Private/GitHub/token`       |
| Anthropic OAuth | `anthropic_oauth_token` | `op://Private/Claude/oauth-token` |
| OpenAI          | `openai_api_key`        | `op://Work/OpenAI/api-key`        |
| PagerDuty       | `pagerduty_token`       | `op://Work/PagerDuty/api-key`     |
| Sentry          | `sentry_auth_token`     | `op://Work/Sentry/auth-token`     |
| Grafana         | `grafana_api_key`       | `op://Work/Grafana/api-key`       |
| npm             | `npm_token`             | `op://Private/npm/token`          |
| Docker Hub      | `docker_token`          | `op://Private/Docker/token`       |

## Credential Priority

1. **Environment variables** (highest)
2. **1Password references**
3. **Secret files** in `~/.clauderon/secrets/` (lowest)

## Service Account (Headless)

For servers without interactive login:

1. Create service account in 1Password Settings > Service Accounts
2. Grant vault access and copy token

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token"
# Or at daemon startup:
OP_SERVICE_ACCOUNT_TOKEN=$(cat /secure/path/op-token) clauderon daemon
```

## Verify

```bash
clauderon config credentials
```

## Full Example

```toml
# ~/.clauderon/proxy.toml
[onepassword]
enabled = true
op_path = "op"

[onepassword.credentials]
github_token = "op://Private/GitHub Personal/token"
anthropic_oauth_token = "op://Private/Claude Code/oauth-token"
openai_api_key = "op://Work/OpenAI/api-key"
pagerduty_token = "op://Work/PagerDuty/api-key"
sentry_auth_token = "op://Work/Sentry/auth-token"
grafana_api_key = "op://Work/Grafana/api-key"
npm_token = "op://DevOps/npm/token"
docker_token = "op://DevOps/Docker Hub/token"
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `op: command not found` | Install: `brew install 1password-cli` |
| Not signed in | `op signin` (or set `OP_SERVICE_ACCOUNT_TOKEN` for service accounts) |
| Vault/item not found | Verify names: `op vault list`, `op item get "Name" --vault "Vault"` |
| Field not found | List fields: `op item get "Name" --vault "Vault" --format json \| jq '.fields'` |

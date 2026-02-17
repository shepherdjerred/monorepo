---
title: 1Password Integration
description: Secure credential management with 1Password
---

clauderon integrates with 1Password for secure credential storage, eliminating the need for plain-text secret files.

## Requirements

- 1Password account
- 1Password CLI (`op`) installed and configured
- Credentials stored in 1Password vaults

## Setup

### 1. Install 1Password CLI

```bash
# macOS
brew install 1password-cli

# Linux (amd64)
curl -sS https://downloads.1password.com/linux/tar/amd64/op.tar.gz | tar -xz
sudo mv op /usr/local/bin/

# Verify installation
op --version
```

### 2. Sign In

```bash
# Interactive sign-in
op signin

# Verify access
op vault list
```

### 3. Store Credentials

Store your credentials in 1Password:

1. Open 1Password
2. Create items for each credential:
   - GitHub: Store personal access token
   - Claude: Store OAuth token
   - OpenAI: Store API key
3. Note the reference path: `op://Vault/Item/Field`

### 4. Configure clauderon

Edit `~/.clauderon/proxy.toml`:

```toml
[onepassword]
enabled = true
op_path = "op"  # Path to 1Password CLI (optional if in PATH)

[onepassword.credentials]
github_token = "op://Private/GitHub/token"
anthropic_oauth_token = "op://Private/Claude/oauth-token"
openai_api_key = "op://Work/OpenAI/api-key"
```

## Reference Format

1Password references follow the format:

```
op://Vault/Item/Field
```

- **Vault**: The vault name (e.g., "Private", "Work")
- **Item**: The item name (e.g., "GitHub", "Claude")
- **Field**: The field name (e.g., "token", "password", "api-key")

### Finding References

Use the CLI to list items:

```bash
# List vaults
op vault list

# List items in a vault
op item list --vault Private

# Get item details
op item get "GitHub" --vault Private

# Get specific field
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
| Sprites         | `sprites_api_key`       | `op://Work/Sprites/api-key`       |

## Credential Priority

When multiple sources define the same credential:

1. **Environment variables** (highest priority)
2. **1Password references** (if configured)
3. **Secret files** in `~/.clauderon/secrets/` (lowest priority)

This allows you to:

- Override 1Password credentials with environment variables for testing
- Fall back to file-based credentials if 1Password is unavailable

## Service Account (Headless)

For servers without interactive login:

### 1. Create Service Account

In 1Password:

1. Go to Settings > Service Accounts
2. Create a new service account
3. Grant access to required vaults
4. Copy the token

### 2. Configure

```bash
# Set service account token
export OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token"
```

Or store in a secure location and reference in your daemon startup:

```bash
OP_SERVICE_ACCOUNT_TOKEN=$(cat /secure/path/op-token) clauderon daemon
```

## Session-Specific Credentials

Credentials can be overridden per session using environment variables:

```bash
GITHUB_TOKEN="test-token" clauderon create \
  --repo ~/project \
  --prompt "Use test credentials"
```

## Verify Configuration

Check credential status:

```bash
clauderon config credentials
```

This shows which credentials are configured and their source (1Password, file, or missing).

## Security Best Practices

### Vault Organization

- Use separate vaults for personal and work credentials
- Limit service account access to necessary vaults only

### Token Rotation

Regularly rotate tokens:

1. Generate new token in the service
2. Update 1Password item
3. Credentials automatically update on next proxy request

### Audit

Review 1Password's audit log for credential access.

## Troubleshooting

### op: command not found

Ensure 1Password CLI is installed and in PATH:

```bash
which op
```

Install if needed (see Setup section).

### Not signed in

Sign in to 1Password:

```bash
op signin
```

For service accounts, ensure `OP_SERVICE_ACCOUNT_TOKEN` is set.

### Vault not found

Verify vault name matches exactly:

```bash
op vault list
```

### Item not found

Verify item name and vault:

```bash
op item get "ItemName" --vault "VaultName"
```

### Field not found

List available fields:

```bash
op item get "ItemName" --vault "VaultName" --format json | jq '.fields'
```

### Permission denied

Ensure your user/service account has access to the vault.

## Example Configuration

Complete example with all credentials:

```toml
# ~/.clauderon/proxy.toml

[onepassword]
enabled = true
op_path = "op"

[onepassword.credentials]
# Development credentials (Private vault)
github_token = "op://Private/GitHub Personal/token"
anthropic_oauth_token = "op://Private/Claude Code/oauth-token"

# Work credentials (Work vault)
openai_api_key = "op://Work/OpenAI/api-key"
pagerduty_token = "op://Work/PagerDuty/api-key"
sentry_auth_token = "op://Work/Sentry/auth-token"
grafana_api_key = "op://Work/Grafana/api-key"

# Registry credentials (DevOps vault)
npm_token = "op://DevOps/npm/token"
docker_token = "op://DevOps/Docker Hub/token"
```

## See Also

- [Credential Proxy](/guides/proxy/) - How credential injection works
- [Configuration Reference](/reference/configuration/) - All configuration options
- [1Password CLI Documentation](https://developer.1password.com/docs/cli/)

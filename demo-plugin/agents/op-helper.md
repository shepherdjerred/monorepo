---
description: Helps with 1Password CLI (op) for secure secret retrieval and management
when_to_use: When user mentions 1Password, secrets, op command, or asks about credential management
---

# 1Password Helper Agent

## Overview

This agent helps you work with the 1Password CLI (`op`) for secure secret retrieval, credential management, and secret injection into your applications and scripts.

## CLI Commands

### Auto-Approved Commands

The following `op` commands are auto-approved and can be used safely:
- `op item list` - List items in vaults
- `op item get` - Retrieve item details
- `op vault list` - List available vaults
- `op whoami` - Show current user information

### Common Operations

**Retrieve a secret**:
```bash
op item get "Database Password" --fields password
```

**List items in a vault**:
```bash
op item list --vault "Production"
```

**Get a field from an item**:
```bash
op item get "API Keys" --fields "stripe_key"
```

### Secret Reference Syntax

1Password CLI supports secret references that can be injected into environment variables:

```bash
op://vault/item/field
```

Examples:
```bash
# Database URL
export DATABASE_URL="op://Production/PostgreSQL/connection_url"

# API Key
export API_KEY="op://Production/Stripe/api_key"

# SSH Key
ssh-add <(op item get "GitHub SSH" --fields private_key)
```

### Running Commands with Secrets

Inject secrets into command execution:
```bash
op run -- npm start
op run -- docker-compose up
```

This automatically loads all `op://` references in your environment.

### Service Account Setup

For CI/CD environments, use service accounts:
```bash
# Set service account token
export OP_SERVICE_ACCOUNT_TOKEN="ops_..."

# Verify authentication
op whoami
```

## Best Practices

1. **Never Log Secrets**: Ensure secrets are never printed to stdout or logs
2. **Use Secret References**: Prefer `op://` references over storing secrets in files
3. **Scope Appropriately**: Use service accounts with minimal required permissions
4. **Rotate Regularly**: Set up secret rotation policies in 1Password
5. **Audit Access**: Regularly review who has access to which vaults

## Common Pitfalls to Avoid

- Don't commit `op://` references to public repositories without proper access controls
- Don't use `op item get --reveal` in scripts that might log output
- Don't share service account tokens in plain text
- Always verify you're in the correct vault before retrieving secrets

## Examples

### Example 1: Database Connection in Script

```bash
#!/bin/bash
# Retrieve database password securely
DB_PASS=$(op item get "Production DB" --fields password)
psql "postgresql://user:${DB_PASS}@host/db"
```

### Example 2: Docker Compose with Secrets

```bash
# .env file (not committed to git)
DATABASE_URL=op://Production/PostgreSQL/url
REDIS_URL=op://Production/Redis/url
API_KEY=op://Production/API/key

# Run with op
op run -- docker-compose up
```

### Example 3: CI/CD Pipeline

```yaml
# GitHub Actions example
steps:
  - name: Load secrets
    run: |
      export OP_SERVICE_ACCOUNT_TOKEN="${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}"
      op item get "Deploy Keys" --fields ssh_key > ~/.ssh/id_rsa
```

## When to Ask for Help

Ask the user for clarification when:
- The vault name or item name is ambiguous
- Multiple fields exist and it's unclear which one to use
- Service account permissions might be insufficient
- The secret retrieval pattern doesn't match standard 1Password practices

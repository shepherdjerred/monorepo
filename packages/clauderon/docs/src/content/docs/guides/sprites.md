---
title: Sprites Backend
description: Running sessions on sprites.dev managed cloud containers
---

The Sprites backend runs AI agent sessions on sprites.dev, a managed container platform for development environments.

## Requirements

- sprites.dev account
- API key configured
- Internet connectivity

## Getting Started

### 1. Create Account

Sign up at [sprites.dev](https://sprites.dev) and generate an API key.

### 2. Configure API Key

Store your API key:

```bash
echo "your-sprites-api-key" > ~/.clauderon/secrets/sprites_api_key
chmod 600 ~/.clauderon/secrets/sprites_api_key
```

Or use environment variable:

```bash
export SPRITES_API_KEY="your-sprites-api-key"
```

Or use 1Password:

```toml
# ~/.clauderon/proxy.toml
[onepassword.credentials]
sprites_api_key = "op://Work/Sprites/api-key"
```

### 3. Create a Session

```bash
clauderon create --backend sprites \
  --repo ~/project \
  --prompt "Work on the feature"
```

## Configuration

Configure Sprites settings in `~/.clauderon/config.toml`:

```toml
[sprites]
# API key (or use secret file/env var)
api_key = ""
```

## How It Works

When you create a Sprites session, clauderon:

1. Creates a git worktree locally
2. Syncs the worktree to a Sprites container
3. Configures proxy settings for credential injection
4. Starts the agent with your prompt

## Features

### Zero-Ops Containers

- Managed infrastructure
- Automatic scaling
- No Docker or Kubernetes required locally

### Sync and Attach

Changes sync bidirectionally:

- Local changes sync to container
- Container changes sync back

### Pre-configured Images

Sprites provides optimized images for common development scenarios.

## Use Cases

### Remote Development

Work on code without local resources:

```bash
clauderon create --backend sprites \
  --repo ~/large-project \
  --prompt "Analyze dependencies"
```

### Team Collaboration

Share sessions with team members via sprites.dev dashboard.

### CI/CD Integration

Run sessions as part of your pipeline:

```yaml
# Example GitHub Action
- name: Run AI Analysis
  run: |
    clauderon create --backend sprites \
      --repo . \
      --prompt "Review PR changes" \
      --print
```

## Resource Limits

Configure container resources:

```bash
clauderon create --backend sprites \
  --cpu-limit 4 \
  --memory-limit 8g \
  --repo ~/project \
  --prompt "Heavy task"
```

## Monitoring

### Session Status

```bash
clauderon list
```

### Container Logs

View logs via the sprites.dev dashboard or:

```bash
clauderon attach <session-name>
```

## Networking

Sprites containers:
- Have internet access
- Route through clauderon proxy for credential injection
- Support custom network configurations via sprites.dev

## Pricing

Sprites usage is billed based on:
- Container runtime
- Storage used
- Network transfer

Check sprites.dev for current pricing.

## Limitations

- Requires internet connectivity
- Network latency vs local backends
- Usage costs apply
- Dependent on sprites.dev availability

## Troubleshooting

### Connection Failed

Check API key is valid:

```bash
clauderon config credentials
```

Verify internet connectivity.

### Slow Performance

Consider:
- Using a closer region
- Reducing sync frequency
- Using Docker for latency-sensitive work

### Session Not Starting

Check sprites.dev status page for service issues.

Verify your account has available capacity.

## See Also

- [Backends Comparison](/getting-started/backends/) - Compare all backends
- [Docker Backend](/guides/docker/) - For local container sessions
- [Troubleshooting](/guides/troubleshooting/) - Common issues and solutions

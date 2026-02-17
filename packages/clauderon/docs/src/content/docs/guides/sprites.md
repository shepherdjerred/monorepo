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

## Advanced Features

### Hibernation & Wake

Sprites containers support hibernation to reduce costs during idle periods. Hibernated containers:

- **Preserve all state** - Filesystem, environment, and configuration
- **Reduce costs** - Storage-only pricing (no compute charges)
- **Resume quickly** - Wake time typically 5-10 seconds
- **Automatic wake** - On attach or API access

**Hibernating manually:**

Sprites containers may hibernate automatically after an idle timeout. To manually wake a hibernated session:

```bash
# Wake via CLI
clauderon wake <session-name>

# Or via API
curl -X POST http://localhost:3030/api/sessions/{id}/wake
```

**Hibernation configuration:**

Configure hibernation timeout in session creation:

```bash
clauderon create --backend sprites \
  --hibernation-timeout 30m \
  --repo ~/project \
  --prompt "Long-running task"
```

Timeout options:

- `5m`, `15m`, `30m` - Short hibernation (for cost savings)
- `1h`, `2h`, `6h` - Medium hibernation
- `never` - Disable automatic hibernation

**Checking hibernation status:**

```bash
# View session status
clauderon status <session-name>
# Shows "Hibernated" if container is suspended
```

In Web UI or TUI, hibernated sessions display with a special status indicator.

### Remote Clone Strategy

Unlike other backends, Sprites uses **remote clones** rather than local git worktrees:

**How it works:**

1. Repository is cloned directly on sprites.dev servers
2. No local disk usage for the clone
3. Changes committed in container are pushed to remote
4. Local worktree syncing is optional

**Advantages:**

- No local disk space consumed
- Faster session creation for large repositories
- Better for environments with limited local storage

**Trade-offs:**

- Network latency for git operations
- Initial clone time proportional to repository size
- May use more network bandwidth

**Best for:**

- Large monorepos (>1GB)
- Machines with limited disk space
- Remote-first development workflows

**Not ideal for:**

- Latency-sensitive git operations
- Offline development
- Frequent git operations (rebasing, cherry-picking)

### Build Caching

Sprites supports build caching to speed up iterations:

**Supported cache types:**

- **Cargo registry/git** - For Rust projects
- **npm/yarn/bun cache** - For Node.js projects
- **pip cache** - For Python projects
- **Docker layer caching** - For Dockerfile builds
- **Custom cache directories** - Via configuration

**Enabling build caching:**

```bash
clauderon create --backend sprites \
  --build-cache cargo,npm \
  --repo ~/project \
  --prompt "Build and test"
```

**Cache persistence:**

- Caches persist across session recreates
- Shared across sessions in same project (configurable)
- Automatically cleaned after 30 days of inactivity

**Cache configuration in Web UI:**

When creating a session via Web UI:

1. Expand "Advanced Options"
2. Check "Enable build caching"
3. Select cache types: Cargo, NPM, Pip, Docker
4. Optionally set cache sharing scope (project-wide or session-specific)

**Performance impact:**

| Cache Type    | First Build | Cached Build | Savings |
| ------------- | ----------- | ------------ | ------- |
| Cargo         | 5-10min     | 30-60s       | 80-90%  |
| NPM           | 2-5min      | 10-30s       | 70-85%  |
| Docker layers | 3-8min      | 30-90s       | 60-80%  |

### Checkpoint Support

**Status:** ⚠️ Not yet implemented (sprites.dev API TODO)

When the checkpoint API becomes available, Sprites will support:

**Session snapshots:**

- Instant session state capture
- Point-in-time restoration
- Branch-point creation for experimentation

**Planned usage:**

```bash
# Create checkpoint
clauderon checkpoint create <session-name> "Before refactor"

# List checkpoints
clauderon checkpoint list <session-name>

# Restore from checkpoint
clauderon checkpoint restore <session-name> <checkpoint-id>
```

**Future capabilities:**

- Automatic checkpoints before risky operations
- Checkpoint-based branching (create session from checkpoint)
- Checkpoint sharing across team members

**Current workaround:**

Until checkpoints are implemented, use git commits for snapshots:

```bash
# In session, commit work before risky changes
git add .
git commit -m "Checkpoint before refactor"

# If things go wrong, reset to commit
git reset --hard HEAD~1
```

### Model Override and Plan Mode

**Model selection:**

Sprites backend supports all available models. Specify during session creation:

```bash
clauderon create --backend sprites \
  --model claude-opus-4-5 \
  --repo ~/project \
  --prompt "Complex refactor"
```

See [Model Selection Guide](/guides/model-selection/) for choosing the right model.

**Plan mode:**

Plan mode works seamlessly with Sprites:

```bash
clauderon create --backend sprites \
  --plan-mode \
  --repo ~/project \
  --prompt "Implement authentication system"
```

The agent creates an implementation plan before executing. Network latency has minimal impact since planning is primarily AI computation.

### Custom Container Images

Sprites supports custom container images via sprites.dev dashboard:

1. Build and push image to sprites.dev registry
2. Configure session to use custom image
3. Session starts with your custom environment

**Example use cases:**

- Specific language versions (Python 3.11, Node 20)
- Pre-installed tools (databases, build tools)
- Custom development environments
- Company-specific base images

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

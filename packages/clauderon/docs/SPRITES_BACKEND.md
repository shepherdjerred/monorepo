# Sprites.dev Backend

This document describes the Sprites.dev backend integration for clauderon, which enables cloud-based execution environments with hardware isolation and persistent storage.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Setup](#setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Cost Considerations](#cost-considerations)
- [Comparison with Other Backends](#comparison-with-other-backends)
- [Troubleshooting](#troubleshooting)

## Overview

### What is Sprites.dev?

Sprites.dev provides managed Linux VMs running in hardware-isolated Firecracker containers with:

- **Persistent ext4 filesystems** - Changes persist across restarts
- **Individual HTTPS URLs** - Each sprite has its own URL (https://{name}.sprites.app)
- **Sub-1-second cold starts** - Fast startup times (~100-300ms with checkpoint/restore)
- **Automatic hibernation** - Sprites hibernate when idle, reducing costs
- **Layer 3 network controls** - Configure network policies per sprite
- **Hardware isolation** - Each sprite runs in its own Firecracker microVM

### Why Use Sprites Backend?

**Advantages:**
- **Zero local infrastructure** - No Docker, Kubernetes, or local containers required
- **Better for remote teams** - Access from anywhere via HTTPS URLs
- **Hardware isolation** - True VM-level isolation, not just containerization
- **Automatic persistence** - Filesystems persist by default without volume management
- **Fast cold starts** - Quick startup even after hibernation

**Trade-offs:**
- **Higher cost** - Pay-per-use pricing vs free local containers
- **Repository cloning** - Cannot mount local directories, must clone from git remotes
- **Network dependency** - Requires internet connectivity
- **API rate limits** - Subject to sprites.dev API rate limiting

## Architecture

### How It Works

1. **Session Creation:**
   - clauderon creates a sprite via REST API
   - Waits for sprite to reach "running" status
   - Detects git remote URLs from local worktrees
   - Clones repositories into sprite from git remotes
   - Installs Claude Code (if not present in base image)
   - Starts AI agent in tmux session for persistence

2. **Session Execution:**
   - Agent runs inside sprite's tmux session
   - Output available via `sprite console` command or API exec
   - Sprites auto-hibernate when idle (saves costs)
   - Wake up automatically on access

3. **Session Deletion:**
   - Optionally checkpoints sprite (faster future cold starts)
   - Deletes sprite (if `auto_destroy=true`)
   - Or keeps sprite for reuse (if `auto_destroy=false`)

### Repository Access Pattern

Unlike Docker/Kubernetes which mount local directories, Sprites clones repositories from git remotes:

```
Local Machine              Sprites Container
┌──────────────┐          ┌──────────────────┐
│ Git Worktree │          │ Cloned Repo      │
│ (origin URL) │─────────▶│ from Remote      │
└──────────────┘          └──────────────────┘
```

**Requirements:**
- All repositories must have configured git remotes
- Remotes must be accessible from sprites.dev infrastructure
- SSH keys or HTTPS credentials must be configured in sprite

## Setup

### 1. Get Sprites Token

Visit [sprites.dev/dashboard/tokens](https://sprites.dev/dashboard/tokens) and create an API token.

### 2. Set Environment Variable

```bash
export SPRITES_TOKEN="sp_your_token_here"
```

Or add to your shell profile (~/.bashrc, ~/.zshrc, etc.):

```bash
echo 'export SPRITES_TOKEN="sp_your_token_here"' >> ~/.bashrc
```

### 3. (Optional) Install Sprites CLI

For `sprite console` attach functionality:

```bash
# Install sprites CLI tool
curl -fsSL https://sprites.dev/install.sh | sh
```

### 4. (Optional) Configure Sprites Backend

Create ~/.clauderon/sprites-config.toml:

```toml
# See docs/sprites-config.toml.example for full configuration options

[resources]
cpu = 2
memory = 4

[lifecycle]
auto_destroy = false  # Keep sprites for reuse
auto_checkpoint = false

[network]
default_policy = "allow-all"

[image]
base_image = "ubuntu:22.04"
install_claude = true
```

## Configuration

### Authentication

The Sprites backend requires authentication via API token. Token can be provided via:

1. **Environment variable (recommended):**
   ```bash
   export SPRITES_TOKEN="sp_your_token_here"
   ```

2. **Configuration file:**
   ```toml
   # ~/.clauderon/sprites-config.toml
   token = "sp_your_token_here"
   ```

Environment variable takes precedence over config file.

### Resource Limits

Control CPU and memory allocation:

```toml
[resources]
cpu = 4      # 1-8 cores
memory = 8   # 1-16 GB
```

**Cost impact:**
- CPU: $0.07 per CPU-hour
- Memory: $0.04375 per GB-hour

### Lifecycle Management

```toml
[lifecycle]
# Delete sprite when session is deleted
auto_destroy = true

# Checkpoint sprite before hibernation (faster cold starts)
auto_checkpoint = true
```

**Recommendations:**
- `auto_destroy=true` for one-off tasks (avoids storage costs)
- `auto_destroy=false` for recurring work (avoids clone/setup time)
- `auto_checkpoint=true` for frequently accessed sprites (300ms vs 1s cold start)

### Network Policies

```toml
[network]
default_policy = "allow-list"

allowed_domains = [
    "api.anthropic.com",
    "github.com",
    "*.githubusercontent.com",
    "crates.io",
]
```

**Policies:**
- `allow-all` - No restrictions (default)
- `block-all` - Complete network isolation (offline development)
- `allow-list` - Whitelist specific domains (security hardening)

### Image Configuration

```toml
[image]
# Base image (must be available on sprites.dev)
base_image = "ubuntu:22.04"

# Auto-install Claude Code
install_claude = true

# Additional packages
packages = ["git", "curl", "build-essential"]
```

**Base images:**
- `ubuntu:22.04` - Ubuntu 22.04 LTS (default, recommended)
- `ubuntu:24.04` - Ubuntu 24.04 LTS
- `debian:12` - Debian 12 Bookworm
- Custom images (must be configured on sprites.dev)

## Usage

### Creating a Session

**Via Web UI:**
1. Open clauderon web UI
2. Click "New Session"
3. Select "Sprites" as backend
4. Fill in repository and prompt
5. Click "Create"

**Via TUI:**
1. Run `clauderon tui`
2. Press `n` for new session
3. Navigate to "Backend" and select "Sprites"
4. Fill in other fields
5. Press Enter on "Create"

### Attaching to a Session

**Via sprites CLI:**
```bash
# Install sprites CLI first (see Setup)
sprite console clauderon-<session-name>
```

**Via clauderon:**
```bash
# Get attach command
clauderon attach <session-name>
# Outputs: sprite console clauderon-<session-name>
```

### Multi-Repository Support

Sprites backend fully supports multi-repository sessions:

```bash
# Create session with multiple repositories
# Each repo will be cloned into the sprite:
# - Primary repo: /home/sprite/workspace
# - Secondary repos: /home/sprite/repos/{mount_name}
```

All repositories must have configured git remotes accessible from sprites.dev.

### Monitoring and Logs

**View sprite status:**
```bash
sprite list
```

**View sprite logs:**
```bash
sprite console clauderon-<session-name>
# Then inside sprite:
tmux attach -t clauderon
```

## Cost Considerations

### Pricing Model

Sprites.dev uses pay-per-use pricing:

- **CPU:** $0.07 per CPU-hour
- **Memory:** $0.04375 per GB-hour
- **Storage:** $0.00068 per GB-hour

### Example Cost Calculations

**Short development session (4 hours active):**
```
Configuration: 2 CPUs, 4GB RAM, 10GB storage
- CPU: 4h × 2 × $0.07 = $0.56
- Memory: 4h × 4 × $0.04375 = $0.70
- Storage: 4h × 10 × $0.00068 = $0.03
Total: $1.29
```

**Full work day (8 hours active):**
```
Configuration: 4 CPUs, 8GB RAM, 20GB storage
- CPU: 8h × 4 × $0.07 = $2.24
- Memory: 8h × 8 × $0.04375 = $2.80
- Storage: 8h × 20 × $0.00068 = $0.11
Total: $5.15
```

**Persistent sprite (1 week, idle with auto_destroy=false):**
```
Configuration: 10GB storage only (idle sprites don't incur CPU/memory costs)
- Storage: 168h × 10 × $0.00068 = $1.14/week
Total: $1.14/week (plus active time when resumed)
```

### Cost Optimization Tips

1. **Use auto_destroy=true for one-off tasks** - Avoid persistent storage costs
2. **Use auto_destroy=false for recurring work** - Avoid repetitive clone/setup costs
3. **Right-size resources** - Don't over-allocate CPU/memory
4. **Clean up old sprites** - Delete sprites you're no longer using
5. **Use auto_checkpoint sparingly** - Only for frequently accessed sprites

## Comparison with Other Backends

| Feature | Sprites | Docker | Kubernetes | Zellij |
|---------|---------|--------|------------|--------|
| **Local Infrastructure** | None | Docker Engine | Cluster | Terminal |
| **Cost** | Pay-per-use | Free | Varies | Free |
| **Isolation** | Hardware (VM) | Container | Container | Process |
| **Persistence** | Automatic | Volumes | PVCs | None |
| **Remote Access** | HTTPS URL | Manual | Ingress | SSH |
| **Cold Start** | <1s | ~2-5s | ~5-10s | Instant |
| **Setup Complexity** | Low | Medium | High | Low |
| **Multi-Repository** | Yes | Yes | Yes | Limited |
| **Best For** | Remote teams, zero infra | Local dev | Production | Quick local |

### When to Use Sprites

**Good for:**
- Remote/distributed teams without shared infrastructure
- Users who don't want to manage Docker/Kubernetes locally
- Temporary/ephemeral development environments
- Testing without local resource constraints
- Teams with budget for managed services

**Not ideal for:**
- Cost-sensitive scenarios with heavy usage
- Air-gapped or fully offline environments
- Extremely large monorepos (clone time)
- Workflows requiring local filesystem access

## Troubleshooting

### Authentication Errors

**Error:** `No Sprites authentication token found`

**Solution:**
```bash
# Set environment variable
export SPRITES_TOKEN="sp_your_token_here"

# Or add to config file
echo 'token = "sp_your_token_here"' > ~/.clauderon/sprites-config.toml
```

### Git Clone Failures

**Error:** `Failed to clone repository ... no remote configured`

**Solution:**
Ensure your git worktree has a remote:
```bash
cd /path/to/worktree
git remote -v
# Should show origin URL

# If missing, add remote:
git remote add origin https://github.com/user/repo.git
```

**Error:** `Failed to clone repository ... authentication required`

**Solution:**
Configure git credentials in sprite (future feature) or use public repositories.

### Sprite Creation Timeout

**Error:** `Timeout waiting for sprite to be ready after 120 seconds`

**Possible causes:**
- Sprites.dev API is slow or down
- Network connectivity issues
- Resource constraints on sprites.dev infrastructure

**Solution:**
- Check sprites.dev status page
- Retry after a few minutes
- Contact sprites.dev support if issue persists

### Missing Claude Code

**Error:** `Failed to start agent ... claude: command not found`

**Solution:**
Ensure `install_claude = true` in config, or use a base image with Claude Code pre-installed.

### Sprite Console Not Working

**Error:** `sprite: command not found`

**Solution:**
Install sprites CLI:
```bash
curl -fsSL https://sprites.dev/install.sh | sh
```

### Sprite Persists After Deletion

**Expected behavior if `auto_destroy = false`:**
Sprites are kept for reuse by default. To delete:
```bash
sprite delete clauderon-<session-name>
```

Or set `auto_destroy = true` in config to auto-delete on session deletion.

## Advanced Usage

### Custom Base Images

You can use custom base images with pre-installed tools:

```toml
[image]
base_image = "myregistry/my-dev-image:latest"
install_claude = false  # Already in image
```

### Network Policies for Security

Restrict network access to specific services:

```toml
[network]
default_policy = "allow-list"
allowed_domains = [
    "api.anthropic.com",  # Required for Claude
    "github.com",         # Required for git operations
]
```

### Resource Override per Session

Override resources for specific sessions via API (future feature).

## Support

For issues specific to:
- **Sprites backend integration:** [clauderon issues](https://github.com/anthropics/clauderon/issues)
- **Sprites.dev platform:** [sprites.dev support](https://sprites.dev/support)

## Further Reading

- [Sprites.dev Documentation](https://sprites.dev/docs)
- [Sprites.dev API Reference](https://sprites.dev/docs/api)
- [Firecracker VMM](https://firecracker-microvm.github.io/)

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
- **Hardware isolation** - Each sprite runs in its own Firecracker microVM
- **Fixed environment** - Ubuntu 24.04, 8 vCPUs, 8GB RAM, 100GB storage

### Why Use Sprites Backend?

**Advantages:**
- **Zero local infrastructure** - No Docker, Kubernetes, or local containers required
- **Better for remote teams** - Access from anywhere via HTTPS URLs
- **Hardware isolation** - True VM-level isolation, not just containerization
- **Automatic persistence** - Filesystems persist by default without volume management
- **Fast cold starts** - Quick startup even after hibernation
- **Simple CLI** - Uses the `sprite` CLI for all operations

**Trade-offs:**
- **Higher cost** - Pay-per-use pricing vs free local containers
- **Repository cloning** - Cannot mount local directories, must clone from git remotes
- **Network dependency** - Requires internet connectivity
- **Fixed resources** - Cannot customize CPU, memory, or base image

## Architecture

### How It Works

1. **Session Creation:**
   - clauderon creates a sprite via `sprite create` CLI command
   - Clones repositories into sprite from git remotes
   - Installs Claude Code (if not present)
   - Starts AI agent in tmux session for persistence

2. **Session Execution:**
   - Agent runs inside sprite's tmux session
   - Output available via `sprite console` command
   - Sprites auto-hibernate when idle (saves costs)
   - Wake up automatically on access

3. **Session Deletion:**
   - Optionally checkpoints sprite (faster future cold starts)
   - Destroys sprite via `sprite destroy` (if `auto_destroy=true`)
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

### CLI Commands Used

| Operation | CLI Command |
|-----------|-------------|
| Create | `sprite create {name} --no-console` |
| Check exists | `sprite list` (parse output) |
| Run command | `sprite run -s {name} -- {cmd}` |
| Delete | `sprite destroy {name} --yes` |
| Attach | `sprite console {name}` |

## Setup

### 1. Install Sprites CLI

The sprites CLI is required for this backend:

```bash
# Install sprites CLI tool
curl -fsSL https://sprites.dev/install.sh | sh
```

### 2. Authenticate

Login to sprites.dev:

```bash
sprite login
```

Or set the environment variable:

```bash
export SPRITES_TOKEN="sp_your_token_here"
```

### 3. (Optional) Configure Sprites Backend

Create `~/.clauderon/sprites-config.toml`:

```toml
[lifecycle]
auto_destroy = false  # Keep sprites for reuse
auto_checkpoint = false

[git]
shallow_clone = true  # Use --depth 1 for faster cloning
```

## Configuration

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

### Git Configuration

```toml
[git]
# Use shallow clone (--depth 1) for faster cloning
shallow_clone = true
```

**Note:** Shallow clones may break `git describe`, rebasing, or viewing full commit history.

### Fixed Environment

Sprites use a fixed environment that cannot be customized:
- **OS:** Ubuntu 24.04
- **CPU:** 8 vCPUs
- **Memory:** 8GB RAM
- **Storage:** 100GB

## Limitations and Known Issues

### Private Repository Authentication

**Current Limitation:** The Sprites backend does not yet support automatic authentication for private git repositories.

**Workarounds:**

1. **Use public repositories** - If possible, use public repositories for clauderon sessions

2. **Pre-configure SSH keys** - Configure SSH keys in the sprite after creation:
   ```bash
   sprite console my-sprite
   # Then inside sprite:
   mkdir -p ~/.ssh
   echo "your-private-key" > ~/.ssh/id_ed25519
   chmod 600 ~/.ssh/id_ed25519
   ```

3. **Use personal access tokens in URLs:**
   ```bash
   # Configure git to use HTTPS with token inside the sprite
   git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
   ```

### Shallow Clone Limitations

By default, repositories are cloned with `--depth 1` (shallow clone) for faster setup. This may cause issues with:

- `git describe` (requires tag history)
- Rebasing operations
- Viewing full commit history
- Some CI/CD tools that expect full history

**Solution:** Disable shallow clones in configuration:
```toml
[git]
shallow_clone = false
```

### Other Limitations

- **No local filesystem mounting** - Unlike Docker/Kubernetes, sprites cannot mount local directories. All code must be cloned from git remotes.
- **Network dependency** - Requires internet connectivity and access to git remotes
- **Fixed resources** - Cannot customize CPU, memory, or base image

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
Configuration: 8 vCPUs, 8GB RAM, 10GB storage (fixed)
- CPU: 4h × 8 × $0.07 = $2.24
- Memory: 4h × 8 × $0.04375 = $1.40
- Storage: 4h × 10 × $0.00068 = $0.03
Total: $3.67
```

**Full work day (8 hours active):**
```
Configuration: 8 vCPUs, 8GB RAM, 20GB storage (fixed)
- CPU: 8h × 8 × $0.07 = $4.48
- Memory: 8h × 8 × $0.04375 = $2.80
- Storage: 8h × 20 × $0.00068 = $0.11
Total: $7.39
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
3. **Clean up old sprites** - Delete sprites you're no longer using
4. **Use auto_checkpoint sparingly** - Only for frequently accessed sprites

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
- Users needing custom CPU/memory/image configuration

## Troubleshooting

### CLI Not Found

**Error:** `sprite: command not found`

**Solution:**
Install sprites CLI:
```bash
curl -fsSL https://sprites.dev/install.sh | sh
```

### Authentication Errors

**Error:** `Failed to create sprite: unauthorized`

**Solution:**
```bash
# Login to sprites.dev
sprite login

# Or set environment variable
export SPRITES_TOKEN="sp_your_token_here"
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

**Error:** `Timeout waiting for sprite to be ready`

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
Claude Code should be automatically installed. If it fails, you can install manually:
```bash
sprite console clauderon-<session-name>
# Inside sprite:
curl -fsSL https://claude.ai/install.sh | sh
```

### Sprite Persists After Deletion

**Expected behavior if `auto_destroy = false`:**
Sprites are kept for reuse by default. To delete:
```bash
sprite destroy clauderon-<session-name>
```

Or set `auto_destroy = true` in config to auto-delete on session deletion.

## Support

For issues specific to:
- **Sprites backend integration:** [clauderon issues](https://github.com/anthropics/clauderon/issues)
- **Sprites.dev platform:** [sprites.dev support](https://sprites.dev/support)

## Further Reading

- [Sprites.dev Documentation](https://sprites.dev/docs)
- [Sprites.dev API Reference](https://sprites.dev/docs/api)
- [Firecracker VMM](https://firecracker-microvm.github.io/)

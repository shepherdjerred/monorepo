---
title: Docker Backend
description: Running sessions in Docker containers
---

The Docker backend provides full container isolation for your AI agent sessions. Containers run with their own filesystem, network namespace, and process space, ensuring complete isolation from your host system.

## How It Works

When you create a Docker session, clauderon:

1. Creates a git worktree in `~/.clauderon/worktrees/<session-name>/`
2. Creates a new container with your specified image
3. Mounts the worktree at `/workspace` in the container
4. Configures proxy environment variables for credential injection
5. Mounts the CA certificate for TLS interception
6. Starts Claude Code (or your chosen agent) with your prompt

## Creating Docker Sessions

```bash
clauderon create --backend docker --repo ~/project --prompt "Fix the bug"
```

### Custom Image

```bash
clauderon create --backend docker --image rust:1.85 \
  --repo ~/project --prompt "Build the project"
```

### Resource Limits

```bash
clauderon create --backend docker \
  --cpu-limit 4 \
  --memory-limit 8g \
  --repo ~/project --prompt "Heavy computation task"
```

### Pull Policy

Control when images are pulled:

```bash
# Always pull latest
clauderon create --backend docker --pull-policy always \
  --repo ~/project --prompt "Use latest image"

# Use cached image if available (default)
clauderon create --backend docker --pull-policy if-not-present \
  --repo ~/project --prompt "Task"

# Never pull, fail if not cached
clauderon create --backend docker --pull-policy never \
  --repo ~/project --prompt "Use local image only"
```

## Configuration

Configure Docker defaults in `~/.clauderon/config.toml`:

```toml
[docker]
# Default image for all Docker sessions
default_image = "ghcr.io/anthropics/claude-code:latest"

# Pull policy: always, if-not-present, never
pull_policy = "if-not-present"

[docker.limits]
# Default resource limits (empty = no limit)
cpu = "4"
memory = "8g"
```

## Shared Volumes

clauderon creates shared Docker volumes for caching across sessions:

| Volume | Purpose |
|--------|---------|
| `clauderon-cargo-registry` | Cargo package cache |
| `clauderon-cargo-git` | Git dependencies |
| `clauderon-sccache` | Rust compilation cache |

These volumes are automatically mounted, speeding up builds for Rust projects.

### Cleaning Cache

```bash
# Show cache usage (dry run)
clauderon clean-cache

# Remove all cache volumes
clauderon clean-cache --force
```

## Refreshing Containers

Pull the latest image and recreate the container:

```bash
clauderon refresh <session-name>
```

This is useful when a new version of Claude Code is released.

## Mounted Directories

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `~/.clauderon/worktrees/<name>/` | `/workspace` | Git worktree |
| `~/.clauderon/proxy-ca.pem` | `/etc/clauderon/proxy-ca.pem` | CA certificate |
| `~/.clauderon/claude.json` | `/workspace/.claude.json` | Claude onboarding |
| `~/.clauderon/uploads/<id>/` | `/workspace/.clauderon/uploads/<id>/` | Uploaded images |
| `~/.clauderon/hooks/` | `/workspace/.clauderon/hooks/` | Claude Code hooks |

## Environment Variables

The following environment variables are set in the container:

| Variable | Value | Purpose |
|----------|-------|---------|
| `HTTP_PROXY` | `http://host.docker.internal:<port>` | Proxy for HTTP |
| `HTTPS_PROXY` | `http://host.docker.internal:<port>` | Proxy for HTTPS |
| `SSL_CERT_FILE` | `/etc/clauderon/proxy-ca.pem` | CA certificate |
| `NODE_EXTRA_CA_CERTS` | `/etc/clauderon/proxy-ca.pem` | CA for Node.js |
| `REQUESTS_CA_BUNDLE` | `/etc/clauderon/proxy-ca.pem` | CA for Python |

## Custom Images

You can use any Docker image, but it should have:

- A shell (bash or sh)
- curl or wget (for downloading tools)
- git (for version control operations)

The Claude Code binary is automatically downloaded and started.

See [Custom Images Guide](/guides/custom-images/) for building specialized images.

## Troubleshooting

### Permission Denied

If you see permission errors:

```bash
# Add your user to the docker group
sudo usermod -aG docker $USER

# Log out and back in, or run:
newgrp docker
```

### Container Won't Start

Check Docker is running:

```bash
docker info
```

Check for conflicting containers:

```bash
docker ps -a | grep clauderon
```

### Network Issues

If the agent can't reach APIs:

```bash
# Check proxy is running
curl -x http://localhost:3030 https://api.anthropic.com

# Verify container can reach host
docker exec <container> curl http://host.docker.internal:3030
```

### Out of Disk Space

Docker can accumulate unused data:

```bash
# See disk usage
docker system df

# Clean up unused data
docker system prune -a
```

## See Also

- [Backends Comparison](/getting-started/backends/) - Compare all backends
- [Custom Images](/guides/custom-images/) - Building custom Docker images
- [Troubleshooting](/guides/troubleshooting/) - Common issues and solutions

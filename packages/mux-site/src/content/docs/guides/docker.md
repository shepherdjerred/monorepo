---
title: Docker Backend
description: Running sessions in Docker containers
---

The Docker backend provides full container isolation for your AI agent sessions.

## How It Works

When you create a Docker session, mux:

1. Creates a new container with your specified image
2. Mounts your working directory
3. Configures the proxy environment variables
4. Injects git configuration for version control

## Configuration

Configure Docker settings in `~/.config/mux/config.toml`:

```toml
[docker]
# Base image for containers
image = "ubuntu:22.04"

# Additional volumes to mount
volumes = [
  "/home/user/.ssh:/root/.ssh:ro",
  "/home/user/.gitconfig:/root/.gitconfig:ro"
]

# Environment variables for containers
env = [
  "TERM=xterm-256color",
  "EDITOR=vim"
]

# Network mode
network = "host"
```

## Session Options

When creating a Docker session:

### Working Directory

The working directory is mounted at `/workspace` inside the container:

```bash
# Host path: /home/user/projects/my-app
# Container path: /workspace
```

### Git Repository

If you specify a git repository, mux will:

1. Clone the repo into a temporary directory
2. Mount it as the working directory
3. Configure git credentials via the proxy

### Custom Image

You can specify a custom Docker image per-session:

```bash
mux new --backend docker --image rust:1.85 my-rust-session
```

## Rust Compiler Caching

mux supports sccache for Rust compiler caching across sessions:

```toml
[docker.rust]
# Enable sccache
sccache = true

# Cache directory (shared across sessions)
cache_dir = "/home/user/.cache/sccache"
```

## Resource Limits

Control container resources:

```toml
[docker.limits]
# Memory limit
memory = "4g"

# CPU limit
cpus = "2"

# Disable swap
memory_swap = "4g"
```

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
docker ps -a | grep mux
```

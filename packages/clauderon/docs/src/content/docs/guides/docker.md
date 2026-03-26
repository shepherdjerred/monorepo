---
title: Docker Backend
description: Running sessions in Docker containers
---

## How It Works

1. Creates a git worktree in `~/.clauderon/worktrees/<session-name>/`
2. Creates a container with your specified image
3. Mounts the worktree at `/workspace`
4. Configures proxy env vars and CA certificate
5. Starts the chosen agent with your prompt

## Creating Sessions

```bash
clauderon create --backend docker --repo ~/project --prompt "Fix the bug"

# Custom image
clauderon create --backend docker --image rust:1.85 \
  --repo ~/project --prompt "Build the project"

# Resource limits
clauderon create --backend docker \
  --cpu-limit 4 --memory-limit 8g \
  --repo ~/project --prompt "Heavy computation task"

# Pull policy: always | if-not-present (default) | never
clauderon create --backend docker --pull-policy always \
  --repo ~/project --prompt "Use latest image"
```

All Docker settings are CLI flags -- there is no `[docker]` section in `config.toml`.

## Shared Volumes

Automatically mounted for caching across sessions:

| Volume                     | Purpose                |
| -------------------------- | ---------------------- |
| `clauderon-cargo-registry` | Cargo package cache    |
| `clauderon-cargo-git`      | Git dependencies       |
| `clauderon-sccache`        | Rust compilation cache |

```bash
clauderon clean-cache          # Show cache usage (dry run)
clauderon clean-cache --force  # Remove all cache volumes
```

## Refreshing Containers

Pull latest image and recreate:

```bash
clauderon refresh <session-name>
```

## Mounted Directories

| Host Path                        | Container Path                        | Purpose           |
| -------------------------------- | ------------------------------------- | ----------------- |
| `~/.clauderon/worktrees/<name>/` | `/workspace`                          | Git worktree      |
| `~/.clauderon/proxy-ca.pem`      | `/etc/clauderon/proxy-ca.pem`         | CA certificate    |
| `~/.clauderon/claude.json`       | `/workspace/.claude.json`             | Claude onboarding |
| `~/.clauderon/uploads/<id>/`     | `/workspace/.clauderon/uploads/<id>/` | Uploaded images   |
| `~/.clauderon/hooks/`            | `/workspace/.clauderon/hooks/`        | Claude Code hooks |

## Environment Variables

| Variable              | Value                                | Purpose         |
| --------------------- | ------------------------------------ | --------------- |
| `HTTP_PROXY`          | `http://host.docker.internal:<port>` | Proxy for HTTP  |
| `HTTPS_PROXY`         | `http://host.docker.internal:<port>` | Proxy for HTTPS |
| `SSL_CERT_FILE`       | `/etc/clauderon/proxy-ca.pem`        | CA certificate  |
| `NODE_EXTRA_CA_CERTS` | `/etc/clauderon/proxy-ca.pem`        | CA for Node.js  |
| `REQUESTS_CA_BUNDLE`  | `/etc/clauderon/proxy-ca.pem`        | CA for Python   |

## Custom Images

Any Docker image works if it has a shell, curl/wget, and git. Claude Code is automatically downloaded. See [Custom Images Guide](/guides/custom-images/).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Permission denied | `sudo usermod -aG docker $USER && newgrp docker` |
| Container won't start | `docker info` to check Docker; `docker ps -a \| grep clauderon` for conflicts |
| Network issues | `curl -x http://localhost:3030 https://api.anthropic.com` to test proxy |
| Out of disk space | `docker system df` then `docker system prune -a` |

---
title: Custom Docker Images
description: Building custom Docker images for clauderon sessions
---

clauderon can use any Docker image for sessions. This guide covers building custom images for specific development needs.

## Requirements

Custom images should include:

- A shell (bash or sh)
- curl or wget (for downloading Claude Code)
- git (for version control)
- CA certificate support

## Base Image Selection

### General Purpose

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

### Rust Development

```dockerfile
FROM rust:1.85

RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pre-install common tools
RUN cargo install cargo-watch cargo-edit
```

### Node.js Development

```dockerfile
FROM node:20

RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pre-install global tools
RUN npm install -g typescript ts-node
```

### Python Development

```dockerfile
FROM python:3.12

RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pre-install common tools
RUN pip install poetry pytest black
```

## Adding Tools

### System Packages

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    curl git ca-certificates \
    # Add your tools
    ripgrep \
    fd-find \
    jq \
    && rm -rf /var/lib/apt/lists/*
```

### Language-Specific Tools

```dockerfile
# Rust tools
RUN cargo install ripgrep fd-find bat

# Node tools
RUN npm install -g prettier eslint

# Python tools
RUN pip install black mypy ruff
```

## Pre-configured Environments

### With AWS CLI

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    curl git ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip
```

### With Kubernetes Tools

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# kubectl
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# helm
RUN curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

## Using Custom Images

### Per-Session

```bash
clauderon create --backend docker --image myregistry/myimage:latest \
  --repo ~/project --prompt "Build with custom tools"
```

### As Default

```toml
# ~/.clauderon/config.toml
[docker]
default_image = "myregistry/myimage:latest"
```

## Private Registries

### Docker Hub

```bash
docker login
```

### GitHub Container Registry

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

### AWS ECR

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com
```

## Image Caching

clauderon uses pull policies to control image updates:

```bash
# Always pull latest
clauderon create --backend docker --pull-policy always \
  --image myimage:latest --repo ~/project --prompt "Task"

# Use cached if available (default)
clauderon create --backend docker --pull-policy if-not-present \
  --image myimage:latest --repo ~/project --prompt "Task"

# Never pull (must be cached)
clauderon create --backend docker --pull-policy never \
  --image myimage:latest --repo ~/project --prompt "Task"
```

## Multi-Stage Builds

For smaller images:

```dockerfile
# Build stage
FROM rust:1.85 AS builder
WORKDIR /build
COPY . .
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y \
    curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/myapp /usr/local/bin/
```

## Troubleshooting

### Certificate Errors

Ensure CA certificates are installed:

```dockerfile
RUN apt-get update && apt-get install -y ca-certificates
```

### Git Not Working

Install git:

```dockerfile
RUN apt-get update && apt-get install -y git
```

### Claude Code Won't Start

Ensure curl is available:

```dockerfile
RUN apt-get update && apt-get install -y curl
```

## See Also

- [Docker Backend](/guides/docker/) - Docker backend guide
- [Backends Comparison](/getting-started/backends/) - Compare all backends

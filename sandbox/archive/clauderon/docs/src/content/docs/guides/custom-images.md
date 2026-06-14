---
title: Custom Docker Images
description: Building custom Docker images for clauderon sessions
---

## Requirements

Custom images must include: a shell (bash/sh), curl or wget, git, and CA certificate support.

## Base Image Examples

### General Purpose

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
    curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

### Rust

```dockerfile
FROM rust:1.85
RUN apt-get update && apt-get install -y git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-watch cargo-edit
```

### Node.js

```dockerfile
FROM node:20
RUN apt-get update && apt-get install -y git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g typescript ts-node
```

### Python

```dockerfile
FROM python:3.12
RUN apt-get update && apt-get install -y git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install poetry pytest black
```

### With AWS CLI

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y curl git ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip && ./aws/install && rm -rf aws awscliv2.zip
```

## Multi-Stage Build

```dockerfile
FROM rust:1.85 AS builder
WORKDIR /build
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/myapp /usr/local/bin/
```

## Using Custom Images

```bash
clauderon create --backend docker --image myregistry/myimage:latest \
  --repo ~/project --prompt "Task"
```

No config file setting for default image; pass `--image` each time.

## Private Registries

```bash
# Docker Hub
docker login

# GHCR
echo $GH_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# AWS ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com
```

## Pull Policies

```bash
--pull-policy always          # Always pull latest
--pull-policy if-not-present  # Use cached if available (default)
--pull-policy never           # Fail if not cached
```

---
name: docker-helper
description: |
  Complete Docker operations via CLI - containers, images, networks, volumes, and compose
  When user mentions Docker, containers, docker commands, Dockerfile, images, docker-compose, or container registry
---

# Docker Helper Agent

## What's New in Docker 2025

- **BuildKit Default**: Advanced caching, parallel builds, and secret mounts
- **Docker Scout**: Built-in vulnerability scanning and remediation
- **Multi-Platform Builds**: Native cross-architecture support with buildx
- **Rootless Mode GA**: Run Docker daemon without root privileges
- **Docker Model**: Run ML models as containers
- **Containerd Integration**: Improved runtime performance and compatibility

## Overview

Docker provides containerization for applications. Containers are lightweight, isolated environments that package applications with their dependencies. Images are read-only templates for containers. Docker Compose orchestrates multi-container applications.

## CLI Commands

### Auto-Approved Commands

The following `docker` commands are auto-approved and safe to use:
- `docker ps` - List containers
- `docker images` - List images
- `docker inspect` - Show detailed info
- `docker logs` - View container logs
- `docker stats` - Show resource usage
- `docker version` - Show version info
- `docker info` - System-wide info
- `docker network ls` - List networks
- `docker volume ls` - List volumes

### Container Lifecycle

```bash
# Run container (foreground)
docker run nginx

# Run detached with name
docker run -d --name my-nginx nginx

# Run interactive with shell
docker run -it ubuntu bash

# Run with auto-remove on exit
docker run --rm alpine echo "hello"

# Run with port mapping
docker run -d -p 8080:80 nginx

# Run with environment variables
docker run -d -e MYSQL_ROOT_PASSWORD=secret mysql

# Run with volume mount
docker run -d -v /host/path:/container/path nginx

# Run with resource limits
docker run -d --memory=512m --cpus=1 nginx

# Start/stop/restart containers
docker start my-container
docker stop my-container
docker restart my-container

# Remove container
docker rm my-container

# Remove running container (force)
docker rm -f my-container

# Kill container (SIGKILL)
docker kill my-container
```

### Container Operations

```bash
# Execute command in running container
docker exec my-container ls -la

# Interactive shell in container
docker exec -it my-container bash

# Execute as different user
docker exec -u root my-container whoami

# Execute with environment variable
docker exec -e MY_VAR=value my-container env

# Execute in specific directory
docker exec -w /app my-container pwd

# Attach to container
docker attach my-container

# Copy files to/from container
docker cp ./local-file my-container:/path/
docker cp my-container:/path/file ./local-file

# Show container differences from image
docker diff my-container

# View container logs
docker logs my-container

# Follow logs in real-time
docker logs -f my-container

# Show last N lines
docker logs --tail 100 my-container

# Show logs since timestamp
docker logs --since 2024-01-01T00:00:00 my-container

# Show logs with timestamps
docker logs -t my-container
```

### Image Management

```bash
# List images
docker images

# Pull image
docker pull nginx:latest

# Pull specific platform
docker pull --platform linux/arm64 nginx

# Push image to registry
docker push myregistry/myimage:tag

# Tag image
docker tag nginx:latest myregistry/nginx:v1

# Remove image
docker rmi nginx:latest

# Remove dangling images
docker image prune

# Remove all unused images
docker image prune -a

# Remove images by filter
docker image prune -a --filter "until=24h"

# Inspect image
docker image inspect nginx

# Show image history
docker image history nginx

# Save image to tar
docker save nginx > nginx.tar

# Load image from tar
docker load < nginx.tar
```

### Building Images

```bash
# Build from Dockerfile
docker build -t myimage:latest .

# Build with specific Dockerfile
docker build -f Dockerfile.prod -t myimage:prod .

# Build with build arguments
docker build --build-arg VERSION=1.0 -t myimage .

# Build with no cache
docker build --no-cache -t myimage .

# Build specific target (multi-stage)
docker build --target builder -t myimage:builder .

# Build and push
docker build -t myregistry/myimage:latest --push .
```

### Network Operations

```bash
# List networks
docker network ls

# Create network
docker network create my-network

# Create bridge network with subnet
docker network create --driver bridge --subnet 172.20.0.0/16 my-network

# Connect container to network
docker network connect my-network my-container

# Disconnect container from network
docker network disconnect my-network my-container

# Inspect network
docker network inspect my-network

# Remove network
docker network rm my-network

# Remove unused networks
docker network prune
```

### Volume Operations

```bash
# List volumes
docker volume ls

# Create volume
docker volume create my-volume

# Inspect volume
docker volume inspect my-volume

# Remove volume
docker volume rm my-volume

# Remove unused volumes
docker volume prune

# Use volume in container
docker run -v my-volume:/data nginx
```

### Registry Operations

```bash
# Login to Docker Hub
docker login

# Login to private registry
docker login registry.example.com

# Logout
docker logout registry.example.com

# Search Docker Hub
docker search nginx
```

### System Commands

```bash
# Show disk usage
docker system df

# Show detailed disk usage
docker system df -v

# Remove all unused data
docker system prune

# Remove everything including volumes
docker system prune -a --volumes

# Show real-time events
docker system events

# System info
docker system info
```

## BuildKit & Multi-Stage Builds

### Enabling BuildKit

```bash
# Environment variable
export DOCKER_BUILDKIT=1

# Or use buildx
docker buildx build -t myimage .
```

### Cache Mounts

```dockerfile
# Cache package manager
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y nodejs

# Cache npm
RUN --mount=type=cache,target=/root/.npm \
    npm install

# Cache Go modules
RUN --mount=type=cache,target=/go/pkg/mod \
    go build -o app
```

### Secret Mounts

```dockerfile
# Use secret during build (not stored in image)
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm install
```

```bash
# Build with secret
docker build --secret id=npmrc,src=.npmrc -t myimage .
```

### Multi-Stage Build Example

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Multi-Platform Builds

```bash
# Create builder
docker buildx create --name mybuilder --use

# Build for multiple platforms
docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -t myregistry/myimage:latest \
  --push .

# Inspect builder
docker buildx inspect

# List builders
docker buildx ls
```

## Docker Compose

### Basic Commands

```bash
# Start services
docker compose up

# Start detached
docker compose up -d

# Start specific service
docker compose up -d web

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v

# View logs
docker compose logs

# Follow logs
docker compose logs -f

# View service logs
docker compose logs web

# List containers
docker compose ps

# Execute command
docker compose exec web bash

# Run one-off command
docker compose run --rm web npm test

# Build images
docker compose build

# Build with no cache
docker compose build --no-cache

# Pull images
docker compose pull

# Scale service
docker compose up -d --scale worker=3

# Restart service
docker compose restart web

# Show config
docker compose config
```

### Compose File Example

```yaml
# compose.yaml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - db
    volumes:
      - ./src:/app/src
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

### Override Files

```bash
# Development overrides
# compose.override.yaml (auto-loaded)
services:
  web:
    volumes:
      - .:/app
    environment:
      - DEBUG=1

# Production
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

## Security Best Practices

### Rootless Mode

```bash
# Install rootless Docker
dockerd-rootless-setuptool.sh install

# Verify
docker info | grep rootless
```

### Non-Root Users

```dockerfile
# Create non-root user
RUN addgroup -S app && adduser -S -G app app
USER app
WORKDIR /home/app
```

### Read-Only Filesystem

```bash
# Run with read-only root filesystem
docker run --read-only nginx

# Allow specific writable paths
docker run --read-only --tmpfs /tmp nginx
```

### Docker Scout Scanning

```bash
# Scan image for vulnerabilities
docker scout cves nginx:latest

# Quick vulnerability overview
docker scout quickview nginx:latest

# Get remediation recommendations
docker scout recommendations nginx:latest

# Generate SBOM
docker scout sbom nginx:latest

# Check policy compliance
docker scout policy nginx:latest
```

### Security Checklist

1. **Use minimal base images** - Alpine, distroless, scratch
2. **Pin image versions** - Use SHA digests for critical images
3. **Run as non-root** - Add USER instruction
4. **No secrets in images** - Use secrets or environment
5. **Scan regularly** - Use Docker Scout or Trivy
6. **Limit capabilities** - Drop unnecessary Linux capabilities
7. **Read-only when possible** - Use --read-only flag

## Dockerfile Best Practices

### Layer Optimization

```dockerfile
# Good: Combine commands
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Bad: Separate layers
RUN apt-get update
RUN apt-get install -y curl
```

### Cache Efficiency

```dockerfile
# Copy dependency files first
COPY package.json package-lock.json ./
RUN npm ci

# Then copy source (changes more often)
COPY . .
RUN npm run build
```

### Essential Instructions

```dockerfile
# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost/health || exit 1

# Proper signal handling
STOPSIGNAL SIGTERM

# Labels for metadata
LABEL org.opencontainers.image.source="https://github.com/org/repo"
LABEL org.opencontainers.image.version="1.0.0"

# Use exec form for CMD
CMD ["node", "server.js"]
```

### .dockerignore

```
node_modules
.git
.gitignore
Dockerfile
docker-compose*.yaml
*.md
.env*
.vscode
coverage
dist
```

## Debugging & Troubleshooting

### Container Issues

```bash
# Check container status
docker ps -a

# View container logs
docker logs my-container --tail 100

# Inspect container
docker inspect my-container

# Check resource usage
docker stats my-container

# View processes in container
docker top my-container

# Get shell in running container
docker exec -it my-container sh

# Debug stopped container (override entrypoint)
docker run -it --entrypoint sh myimage
```

### Network Debugging

```bash
# Inspect network
docker network inspect bridge

# Check container IP
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' my-container

# Test connectivity from container
docker exec my-container ping other-container

# Run debug container on same network
docker run --rm -it --network my-network nicolaka/netshoot
```

### Image Layer Inspection

```bash
# Show image layers
docker history myimage

# Detailed layer info
docker history --no-trunc myimage

# Inspect image
docker inspect myimage

# Dive into layers (requires dive tool)
dive myimage
```

### Clean Up

```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Remove unused networks
docker network prune

# Remove everything
docker system prune -a --volumes
```

## Examples

### Example 1: Multi-Stage Build for Node.js

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build

# Production stage
FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["dist/index.js"]
```

```bash
# Build
docker build -t myapp:latest .

# Run
docker run -d -p 3000:3000 --name myapp myapp:latest
```

### Example 2: Development vs Production Compose

```yaml
# compose.yaml (base)
services:
  app:
    build: .
    environment:
      - DATABASE_URL=postgres://db:5432/app
    depends_on:
      - db
  db:
    image: postgres:15
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

```yaml
# compose.override.yaml (development - auto-loaded)
services:
  app:
    build:
      context: .
      target: development
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - DEBUG=1
    ports:
      - "3000:3000"
```

```yaml
# compose.prod.yaml (production)
services:
  app:
    build:
      context: .
      target: production
    restart: always
    deploy:
      replicas: 3
    environment:
      - NODE_ENV=production
```

```bash
# Development
docker compose up

# Production
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

### Example 3: Debugging a Crashed Container

```bash
#!/bin/bash
CONTAINER=$1

echo "=== Container Info ==="
docker inspect "$CONTAINER" --format '{{.State.Status}} - Exit: {{.State.ExitCode}}'

echo "\n=== Last Logs ==="
docker logs "$CONTAINER" --tail 50

echo "\n=== Container Diff ==="
docker diff "$CONTAINER"

# If you need to debug further
echo "\n=== Starting debug container ==="
IMAGE=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
docker run -it --rm --entrypoint sh "$IMAGE"
```

### Example 4: Building Multi-Arch Images

```bash
#!/bin/bash
IMAGE="myregistry/myapp"
VERSION="1.0.0"

# Create builder if not exists
docker buildx create --name multiarch --use 2>/dev/null || true

# Build and push for multiple architectures
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$IMAGE:$VERSION" \
  --tag "$IMAGE:latest" \
  --push \
  .

# Verify
docker manifest inspect "$IMAGE:$VERSION"
```

## When to Ask for Help

Ask the user for clarification when:
- Container names or image tags are ambiguous
- Destructive operations (rm, prune) need confirmation
- Port bindings might conflict with existing services
- Volume mounts involve sensitive paths
- Registry credentials are required
- Network configuration is complex
- Build secrets or sensitive data are involved

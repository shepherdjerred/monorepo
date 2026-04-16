---
name: docker-helper
description: "Complete Docker operations via CLI - build images, run/stop containers, inspect logs, manage networks and volumes, orchestrate with Compose, and push to registries. Activated when user mentions Docker, containers, docker commands, Dockerfile, images, docker-compose, or container registry."
---

# Docker Helper Agent

## Auto-Approved Commands

These read-only commands are safe to run without confirmation:

- `docker ps`, `docker images`, `docker inspect`, `docker logs`, `docker stats`
- `docker version`, `docker info`, `docker system df`
- `docker network ls`, `docker volume ls`
- `docker compose ps`, `docker compose logs`, `docker compose config`

## Destructive Operation Safety

Before running any destructive command, validate what will be affected:

```bash
# ALWAYS preview before pruning
docker system df -v                    # Check what's using space
docker container ls -a --filter status=exited  # See what would be removed
docker image ls --filter dangling=true         # See dangling images

# Then prune with confirmation
docker system prune --dry-run          # Preview what will be removed
docker system prune                    # Removes stopped containers, dangling images, unused networks
docker system prune -a --volumes       # CAUTION: Removes ALL unused data including volumes
```

Never run `docker system prune -a --volumes` without explicit user confirmation -- this deletes volume data permanently.

## BuildKit & Advanced Builds

### Cache Mounts (keep builds fast)

```dockerfile
# Cache package manager downloads across builds
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y nodejs

RUN --mount=type=cache,target=/root/.npm \
    npm install

RUN --mount=type=cache,target=/go/pkg/mod \
    go build -o app
```

### Secret Mounts (never bake secrets into images)

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm install
```

```bash
docker build --secret id=npmrc,src=.npmrc -t myimage .
```

### Multi-Stage Build Pattern

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage -- minimal image, no build tools
FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["dist/index.js"]
```

### Multi-Platform Builds

```bash
# Create builder instance
docker buildx create --name multiarch --use

# Build and push for multiple architectures
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t myregistry/myapp:latest \
  --push .
```

## Dockerfile Best Practices

### Layer Optimization

```dockerfile
# Combine commands to reduce layers and clean up in same layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*
```

### Cache-Friendly Ordering

```dockerfile
# Copy dependency files first (changes less often)
COPY package.json package-lock.json ./
RUN npm ci

# Then copy source (changes more often)
COPY . .
RUN npm run build
```

### Essential Production Instructions

```dockerfile
# Run as non-root user
RUN addgroup -S app && adduser -S -G app app
USER app

# Healthcheck for orchestrators
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost/health || exit 1

# Proper signal handling
STOPSIGNAL SIGTERM

# Use exec form for CMD (enables signal forwarding)
CMD ["node", "server.js"]
```

### .dockerignore (always include)

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

## Docker Compose Workflow

### Dev vs Production Pattern

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
# compose.override.yaml (development -- auto-loaded)
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

```bash
# Development (auto-loads override)
docker compose up

# Production (explicit file selection)
docker compose -f compose.yaml -f compose.prod.yaml up -d

# Scale a service
docker compose up -d --scale worker=3
```

See `references/compose.md` for healthcheck patterns, override strategies, and service orchestration details.

## Debugging Workflow

When a container fails, follow this sequence:

```bash
# 1. Check status and exit code
docker inspect "$CONTAINER" --format '{{.State.Status}} - Exit: {{.State.ExitCode}}'

# 2. Read recent logs
docker logs "$CONTAINER" --tail 100

# 3. If container is running, get a shell
docker exec -it "$CONTAINER" sh

# 4. If container is stopped, debug with same image
IMAGE=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
docker run -it --rm --entrypoint sh "$IMAGE"

# 5. Network debugging -- run netshoot on same network
docker run --rm -it --network my-network nicolaka/netshoot
```

See `references/debugging.md` for network diagnostics, layer inspection, and resource troubleshooting.

## Security Checklist

1. **Use minimal base images** -- Alpine, distroless, scratch
2. **Pin image versions** -- Use SHA digests for critical images
3. **Run as non-root** -- Add USER instruction in Dockerfile
4. **No secrets in images** -- Use secret mounts or environment variables
5. **Scan regularly** -- `docker scout cves <image>` or Trivy
6. **Limit capabilities** -- Drop unnecessary Linux capabilities
7. **Read-only when possible** -- `docker run --read-only --tmpfs /tmp`

See `references/security.md` for rootless mode setup, Docker Scout commands, and capability management.

## When to Ask for Help

Ask the user for clarification when:

- Container names or image tags are ambiguous
- Destructive operations (rm, prune) need confirmation
- Port bindings might conflict with existing services
- Volume mounts involve sensitive host paths
- Registry credentials are required
- Build secrets or sensitive data are involved

# Docker Compose Reference

## Service Orchestration

```bash
# Start specific service and its dependencies
docker compose up -d web

# Rebuild and restart a single service
docker compose up -d --build web

# Run one-off command (container removed after)
docker compose run --rm web npm test

# Execute in running service container
docker compose exec web bash

# Restart a specific service
docker compose restart web

# View merged config (useful for debugging overrides)
docker compose config
```

## Healthcheck Patterns

```yaml
services:
  web:
    build: .
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:15
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
```

## Override Strategy

Docker Compose automatically loads `compose.override.yaml` alongside `compose.yaml`. Use this for development defaults:

```yaml
# compose.override.yaml (development -- auto-loaded)
services:
  app:
    volumes:
      - .:/app
    environment:
      - DEBUG=1
    ports:
      - "3000:3000"
```

For production, explicitly select files to skip the override:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

## Production Compose Patterns

```yaml
# compose.prod.yaml
services:
  app:
    build:
      context: .
      target: production
    restart: always
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
    environment:
      - NODE_ENV=production
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

## Volume Management in Compose

```bash
# Stop services and remove named volumes
docker compose down -v

# Remove only orphan containers (services removed from compose file)
docker compose down --remove-orphans

# List volumes created by this compose project
docker volume ls --filter label=com.docker.compose.project=$(basename $PWD)
```

## Scaling Services

```bash
# Scale workers
docker compose up -d --scale worker=3

# Check scaled service status
docker compose ps worker
```

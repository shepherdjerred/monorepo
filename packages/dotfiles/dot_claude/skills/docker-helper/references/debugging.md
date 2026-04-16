# Docker Debugging Reference

## Container Failure Diagnosis

```bash
# Check all containers including stopped ones
docker ps -a

# Get detailed state info
docker inspect "$CONTAINER" --format '{{json .State}}' | jq .

# View exit code and error
docker inspect "$CONTAINER" --format 'Status: {{.State.Status}}, Exit: {{.State.ExitCode}}, Error: {{.State.Error}}'

# Check OOM kill
docker inspect "$CONTAINER" --format '{{.State.OOMKilled}}'
```

## Log Analysis

```bash
# Recent logs with timestamps
docker logs -t --tail 200 "$CONTAINER"

# Logs since a specific time
docker logs --since 30m "$CONTAINER"

# Follow logs in real-time
docker logs -f "$CONTAINER"

# Filter compose service logs
docker compose logs -f --since 5m web
```

## Resource Troubleshooting

```bash
# Live resource usage for all containers
docker stats

# One-shot stats (no streaming)
docker stats --no-stream

# Check processes inside container
docker top "$CONTAINER"

# Detailed resource config
docker inspect "$CONTAINER" --format '{{json .HostConfig.Memory}} {{json .HostConfig.NanoCpus}}'
```

## Network Diagnostics

```bash
# Get container IP address
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER"

# Show all networks a container is connected to
docker inspect -f '{{json .NetworkSettings.Networks}}' "$CONTAINER" | jq .

# Test connectivity between containers
docker exec "$CONTAINER" ping -c 3 other-container

# DNS resolution inside container
docker exec "$CONTAINER" nslookup other-service

# Full network debugging with netshoot
docker run --rm -it --network my-network nicolaka/netshoot
# Inside netshoot: tcpdump, netstat, curl, dig, nmap, iperf, etc.

# Inspect bridge network
docker network inspect bridge
```

## Image Layer Inspection

```bash
# Show image layers and sizes
docker history myimage

# Full layer commands (untruncated)
docker history --no-trunc myimage

# Deep inspection with dive (if installed)
dive myimage
```

## Filesystem Debugging

```bash
# Show changes container has made to its filesystem
docker diff "$CONTAINER"

# Copy files out for inspection
docker cp "$CONTAINER":/var/log/app.log ./app.log

# Mount a debug shell into a stopped container's filesystem
docker run -it --rm --volumes-from "$CONTAINER" alpine sh
```

## Debug Script: Crashed Container

```bash
#!/bin/bash
CONTAINER=$1

echo "=== Container State ==="
docker inspect "$CONTAINER" --format \
  'Status: {{.State.Status}} | Exit: {{.State.ExitCode}} | OOM: {{.State.OOMKilled}}'

echo ""
echo "=== Last 50 Logs ==="
docker logs "$CONTAINER" --tail 50

echo ""
echo "=== Filesystem Changes ==="
docker diff "$CONTAINER" 2>/dev/null || echo "Container not available for diff"

echo ""
echo "=== Starting Interactive Debug Shell ==="
IMAGE=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
echo "Image: $IMAGE"
echo "Run: docker run -it --rm --entrypoint sh $IMAGE"
```

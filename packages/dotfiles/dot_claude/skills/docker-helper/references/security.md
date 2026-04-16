# Docker Security Reference

## Rootless Mode

Run the Docker daemon without root privileges:

```bash
# Install rootless Docker
dockerd-rootless-setuptool.sh install

# Verify rootless mode is active
docker info | grep -i rootless
```

## Non-Root Container Users

```dockerfile
# Create and switch to non-root user
RUN addgroup -S app && adduser -S -G app app
USER app
WORKDIR /home/app
```

## Read-Only Filesystem

```bash
# Run with read-only root filesystem
docker run --read-only nginx

# Allow specific writable paths via tmpfs
docker run --read-only --tmpfs /tmp --tmpfs /var/run nginx
```

## Docker Scout Vulnerability Scanning

```bash
# Scan image for CVEs
docker scout cves nginx:latest

# Quick vulnerability overview
docker scout quickview nginx:latest

# Get remediation recommendations
docker scout recommendations nginx:latest

# Generate SBOM (Software Bill of Materials)
docker scout sbom nginx:latest

# Check policy compliance
docker scout policy nginx:latest
```

## Capability Management

```bash
# Drop all capabilities and add only what's needed
docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE nginx

# Common minimal capability sets:
# Web servers: NET_BIND_SERVICE
# Network tools: NET_RAW, NET_ADMIN
# File operations: CHOWN, DAC_OVERRIDE, FOWNER
```

## Image Pinning with SHA Digests

For critical production images, pin to exact digest rather than mutable tags:

```dockerfile
# Instead of: FROM node:20-alpine
FROM node:20-alpine@sha256:abc123...
```

Get the digest:

```bash
docker inspect --format='{{index .RepoDigests 0}}' node:20-alpine
```

## Network Security

```bash
# Create isolated network
docker network create --internal isolated-net

# Run container with no network access
docker run --network none myapp

# Limit inter-container communication
docker network create --driver bridge --opt com.docker.network.bridge.enable_icc=false restricted-net
```

## Security Scanning Automation

```bash
# Scan during CI build
docker build -t myapp:latest .
docker scout cves myapp:latest --exit-code --only-severity critical,high

# Exit code 1 if critical/high vulns found -- fails CI pipeline
```

---
title: Installation
description: How to install clauderon on your system
---

## Download Pre-built Binary

The easiest way to install clauderon is to download a pre-built binary from GitHub releases.

### Linux (x86_64)

```bash
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-linux-x86_64 -o clauderon
chmod +x clauderon
sudo mv clauderon /usr/local/bin/
```

### Linux (ARM64)

```bash
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-linux-arm64 -o clauderon
chmod +x clauderon
sudo mv clauderon /usr/local/bin/
```

### macOS (Apple Silicon)

```bash
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-darwin-arm64 -o clauderon
chmod +x clauderon
sudo mv clauderon /usr/local/bin/
```

### macOS (Intel)

```bash
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-darwin-x86_64 -o clauderon
chmod +x clauderon
sudo mv clauderon /usr/local/bin/
```

## Build from Source

Building from source requires Rust 1.85+, Bun, and Node.js.

```bash
# Clone the repository
git clone https://github.com/shepherdjerred/monorepo.git
cd monorepo/packages/clauderon

# Build web frontend first (required - embedded in binary)
cd web && bun install && bun run build && cd ..

# Build documentation (required - embedded in binary)
cd docs && bun install && bun run build && cd ..

# Build Rust binary
cargo build --release

# Install to your path
sudo cp target/release/clauderon /usr/local/bin/
```

**Build Order Note**: The web frontend and documentation must be built before the Rust binary because their static files are embedded during compilation.

## Verify Installation

```bash
clauderon --version
```

## Requirements

### Core Requirements

- 64-bit operating system (Linux or macOS)
- Git 2.x or later (for worktree management)

### Backend-Specific Requirements

Different backends have different requirements. You only need to install requirements for backends you plan to use.

#### Zellij Backend (Default)

- Zellij 0.40 or later

```bash
# macOS
brew install zellij

# Linux (cargo)
cargo install zellij
```

#### Docker Backend

- Docker Engine 20.10 or later
- User must be in the `docker` group (or use sudo)

```bash
# Add yourself to the docker group
sudo usermod -aG docker $USER
# Log out and back in for changes to take effect
```

#### Kubernetes Backend

- kubectl configured with cluster access
- Storage class available for persistent volumes
- Enable with `--enable-kubernetes-backend` flag when starting daemon

#### Sprites Backend

- sprites.dev account
- API key configured in `~/.clauderon/secrets/sprites_api_key` or `SPRITES_API_KEY` environment variable

#### Apple Container Backend (macOS only)

- macOS 26 or later
- Apple Silicon recommended (Intel supported but slower)

## Post-Installation Setup

### 1. Configure Credentials

Create the secrets directory and add your credentials:

```bash
mkdir -p ~/.clauderon/secrets
echo "your-github-token" > ~/.clauderon/secrets/github_token
echo "your-anthropic-token" > ~/.clauderon/secrets/anthropic_oauth_token
chmod 600 ~/.clauderon/secrets/*
```

Or use 1Password integration - see [1Password Guide](/guides/onepassword/).

### 2. Start the Daemon

clauderon requires a background daemon:

```bash
clauderon daemon
```

The daemon starts:
- HTTP server at http://localhost:3030
- Credential proxy for token injection
- Session lifecycle management

### 3. Verify Setup

```bash
# Check configuration
clauderon config show

# Check credential status
clauderon config credentials
```

## Upgrading

### Binary Upgrade

Download the new binary and replace the existing one:

```bash
# Stop the daemon first
pkill clauderon

# Download new version (example for Linux x86_64)
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-linux-x86_64 -o clauderon
chmod +x clauderon
sudo mv clauderon /usr/local/bin/

# Restart the daemon
clauderon daemon
```

### From Source

```bash
cd monorepo
git pull

cd packages/clauderon
cd web && bun install && bun run build && cd ..
cd docs && bun install && bun run build && cd ..
cargo build --release
sudo cp target/release/clauderon /usr/local/bin/
```

## Next Steps

Once installed, head to the [Quick Start](/getting-started/quick-start/) guide to create your first session.

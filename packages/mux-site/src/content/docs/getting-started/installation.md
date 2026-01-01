---
title: Installation
description: How to install mux on your system
---

## Download Pre-built Binary

The easiest way to install mux is to download a pre-built binary from GitHub releases.

### Linux (x86_64)

```bash
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/mux-linux-x86_64 -o mux
chmod +x mux
sudo mv mux /usr/local/bin/
```

### Linux (ARM64)

```bash
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/mux-linux-arm64 -o mux
chmod +x mux
sudo mv mux /usr/local/bin/
```

## Build from Source

If you prefer to build from source, you'll need Rust 1.85 or later.

```bash
# Clone the repository
git clone https://github.com/shepherdjerred/monorepo.git
cd monorepo/packages/multiplexer

# Build in release mode
cargo build --release

# Install to your path
sudo cp target/release/mux /usr/local/bin/
```

## Verify Installation

```bash
mux --version
```

## Requirements

### Docker Backend

If you plan to use Docker as your session backend:

- Docker Engine 20.10 or later
- User must be in the `docker` group (or use sudo)

### Zellij Backend

If you plan to use Zellij as your session backend:

- Zellij 0.40 or later

## Next Steps

Once installed, head to the [Quick Start](/getting-started/quick-start/) guide to create your first session.

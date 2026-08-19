---
title: Installation
description: How to install clauderon on your system
---

## Pre-built Binary

```bash
# Linux x86_64
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-linux-x86_64 -o clauderon

# Linux ARM64
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-linux-arm64 -o clauderon

# macOS Apple Silicon
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-darwin-arm64 -o clauderon

# macOS Intel
curl -fsSL https://github.com/shepherdjerred/monorepo/releases/latest/download/clauderon-darwin-x86_64 -o clauderon
```

```bash
chmod +x clauderon && sudo mv clauderon /usr/local/bin/
```

## Build from Source

Requires Rust 1.85+, Bun, and Node.js.

```bash
git clone https://github.com/shepherdjerred/monorepo.git
cd monorepo/packages/clauderon
cd web && bun install && bun run build && cd ..
cd docs && bun install && bun run build && cd ..
cargo build --release
sudo cp target/release/clauderon /usr/local/bin/
```

## Backend Requirements

**Zellij** (default): 0.40+ — `brew install zellij` or `cargo install zellij`

**Docker**: Engine 20.10+ — user must be in `docker` group (`sudo usermod -aG docker $USER`)

## Setup

```bash
# Start daemon
clauderon daemon

# Verify
clauderon config show
```

Next: [Quick Start](/getting-started/quick-start/)

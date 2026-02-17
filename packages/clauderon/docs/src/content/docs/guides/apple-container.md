---
title: Apple Container Backend
description: Running sessions using native macOS containerization
---

The Apple Container backend uses macOS's native containerization framework for lightweight, secure isolation on Apple hardware.

## Requirements

- macOS 26 or later
- Apple Silicon recommended (Intel supported but slower)

## Creating Sessions

```bash
clauderon create --backend apple \
  --repo ~/project \
  --prompt "Build the iOS app"
```

## How It Works

When you create an Apple Container session, clauderon:

1. Creates a git worktree in `~/.clauderon/worktrees/<session-name>/`
2. Creates a native macOS container
3. Mounts the worktree into the container
4. Configures proxy environment variables
5. Starts the agent with your prompt

## Features

### Native Performance

- Optimized for Apple Silicon
- Low overhead compared to Docker
- Fast startup times (~1s)

### macOS Integration

- Access to macOS frameworks
- Xcode toolchain support
- Native keychain integration (optional)

### Resource Isolation

- Memory limits
- CPU limits
- Filesystem isolation

## Use Cases

### iOS Development

Perfect for iOS/macOS app development:

```bash
clauderon create --backend apple \
  --repo ~/ios-app \
  --prompt "Fix the SwiftUI layout bug"
```

### Swift Projects

Native Swift development with full toolchain:

```bash
clauderon create --backend apple \
  --repo ~/swift-package \
  --prompt "Add async/await support"
```

### macOS Tool Development

Build macOS command-line tools:

```bash
clauderon create --backend apple \
  --repo ~/cli-tool \
  --prompt "Add new subcommand"
```

## Configuration

No special configuration required. Set as default backend:

```toml
# ~/.clauderon/config.toml
[general]
default_backend = "apple"
```

## Resource Limits

Configure container resources:

```bash
clauderon create --backend apple \
  --cpu-limit 4 \
  --memory-limit 8g \
  --repo ~/project \
  --prompt "Build with heavy compilation"
```

## Xcode Integration

Apple Containers can access Xcode toolchains:

```bash
# Session has access to xcodebuild, swift, etc.
clauderon create --backend apple \
  --repo ~/ios-app \
  --prompt "Run tests with xcodebuild"
```

## Comparison with Docker

| Feature        | Apple Container | Docker  |
| -------------- | --------------- | ------- |
| Startup        | ~1s             | ~2-5s   |
| macOS SDK      | Yes             | Limited |
| Xcode          | Yes             | No      |
| Linux tools    | No              | Yes     |
| Custom images  | No              | Yes     |
| Cross-platform | macOS only      | Any     |

**Choose Apple Container when:**

- Building iOS/macOS apps
- Need native performance
- Using Xcode tools
- Only working on macOS

**Choose Docker when:**

- Need Linux environment
- Custom runtime requirements
- Cross-platform development
- Reproducible builds across systems

## Limitations

- macOS 26+ required
- No custom images (uses system image)
- Limited to macOS tools
- Intel Macs may have slower performance

## Troubleshooting

### macOS Version Check

Verify your macOS version:

```bash
sw_vers
```

Must be macOS 26 or later.

### Container Not Starting

Check system integrity:

```bash
csrutil status
```

Ensure SIP settings don't block containerization.

### Performance Issues (Intel)

On Intel Macs, consider:

- Using Zellij instead for lightweight tasks
- Using Docker for isolation with Rosetta
- Upgrading to Apple Silicon

### Xcode Not Found

Ensure Xcode is installed:

```bash
xcode-select -p
```

Install if needed:

```bash
xcode-select --install
```

## See Also

- [Backends Comparison](/getting-started/backends/) - Compare all backends
- [Docker Backend](/guides/docker/) - For cross-platform containers
- [Zellij Backend](/guides/zellij/) - For lightweight local sessions

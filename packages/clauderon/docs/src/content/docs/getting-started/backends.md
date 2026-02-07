---
title: Backends
description: Choose the right backend for your session isolation needs
---

clauderon supports multiple backends for running AI agent sessions. Each backend offers different trade-offs between isolation, performance, and capabilities.

## Backend Comparison

| Feature | Zellij | Docker | Kubernetes | Sprites | Apple |
|---------|--------|--------|------------|---------|-------|
| Isolation | Process | Container | Pod | Container | Container |
| Startup | ~100ms | ~2-5s | ~10-30s | ~5-10s | ~1s |
| Host tools | Full | Limited | None | None | Limited |
| Custom image | No | Yes | Yes | Yes | No |
| Resource limits | No | Yes | Yes | Yes | Yes |
| Cloud native | No | No | Yes | Yes | No |
| Platform | Any | Any | Any | Any | macOS 26+ |
| Network isolation | No | Yes | Yes | Yes | Yes |
| Persistent storage | Host FS | Volumes | PVCs | Volumes | Volumes |

## Zellij (Default)

Lightweight terminal multiplexer sessions running directly on your host.

**Best for:**
- Fast iteration during development
- Projects that need host tools
- Local development workflows
- Debugging and exploration

**Limitations:**
- No isolation from host system
- No resource limits
- No custom runtime environment

```bash
clauderon create --repo ~/project --prompt "Explore the codebase"
```

[Zellij Backend Guide](/guides/zellij/)

## Docker

Full container isolation with configurable images and resource limits.

**Best for:**
- Isolated development environments
- Reproducible builds
- Projects with specific runtime requirements
- Untrusted code exploration

**Limitations:**
- Slower startup than Zellij
- Limited host tool access
- Requires Docker installed

```bash
clauderon create --backend docker --repo ~/project --prompt "Build the project"
```

[Docker Backend Guide](/guides/docker/)

## Kubernetes

Cloud-native pod-based sessions for scalable, isolated environments.

**Best for:**
- Team environments
- Cloud deployments
- Scalable AI agent farms
- Enterprise security requirements

**Limitations:**
- Requires Kubernetes cluster
- Slowest startup time
- More complex setup

**Note:** Requires `--enable-kubernetes-backend` flag.

```bash
clauderon daemon --enable-kubernetes-backend
clauderon create --backend kubernetes --repo ~/project --prompt "Deploy to staging"
```

[Kubernetes Backend Guide](/guides/kubernetes/)

## Sprites

Managed cloud containers via sprites.dev for zero-ops deployment.

**Best for:**
- No-maintenance cloud sessions
- Remote development
- Team collaboration
- Situations where you can't run Docker locally

**Limitations:**
- Requires sprites.dev account
- Network latency
- Usage costs

```bash
clauderon create --backend sprites --repo ~/project --prompt "Work on feature"
```

[Sprites Backend Guide](/guides/sprites/)

## Apple Container (macOS only)

Native macOS containerization using Apple's container framework.

**Best for:**
- macOS-native isolation
- Apple Silicon optimization
- Swift/iOS development
- macOS-specific tooling

**Limitations:**
- macOS 26+ required
- Apple Silicon recommended
- Limited to macOS

```bash
clauderon create --backend apple --repo ~/project --prompt "Build iOS app"
```

[Apple Container Guide](/guides/apple-container/)

## Choosing a Backend

### For Local Development

| Scenario | Recommended Backend |
|----------|-------------------|
| Quick tasks, exploration | Zellij |
| Need specific tools/versions | Docker |
| Untrusted code | Docker |
| macOS with isolation needs | Apple or Docker |

### For Teams/Production

| Scenario | Recommended Backend |
|----------|-------------------|
| Cloud deployment | Kubernetes |
| Zero-ops requirement | Sprites |
| On-premise with isolation | Kubernetes |
| Mixed local/cloud | Docker + Sprites |

### Decision Tree

```
Need isolation?
├─ No → Zellij (fastest)
└─ Yes
   ├─ Have Kubernetes cluster?
   │  ├─ Yes → Kubernetes
   │  └─ No
   │     ├─ Want managed service?
   │     │  ├─ Yes → Sprites
   │     │  └─ No
   │     │     ├─ macOS 26+?
   │     │     │  ├─ Yes → Apple or Docker
   │     │     │  └─ No → Docker
   │     │     └─ Docker
   │     └─ Docker
   └─ Docker (default isolated choice)
```

## Setting Default Backend

Configure your preferred default in `~/.clauderon/config.toml`:

```toml
[general]
default_backend = "docker"  # or zellij, kubernetes, sprites, apple
```

Or specify per-session:

```bash
clauderon create --backend docker --repo ~/project --prompt "Task"
```

## See Also

- [Zellij Backend](/guides/zellij/) - Detailed Zellij guide
- [Docker Backend](/guides/docker/) - Detailed Docker guide
- [Kubernetes Backend](/guides/kubernetes/) - Detailed Kubernetes guide
- [Sprites Backend](/guides/sprites/) - Detailed Sprites guide
- [Apple Container](/guides/apple-container/) - Detailed Apple guide

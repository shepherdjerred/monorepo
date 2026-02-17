---
title: Performance Tuning
description: Optimize Clauderon for faster session creation, agent responses, and overall performance
---

This guide covers strategies for optimizing Clauderon performance across all components: session creation, backend selection, resource configuration, caching, and monitoring.

## Backend Selection for Performance

Different backends offer different performance characteristics:

### Startup Time Comparison

| Backend             | Cold Start | Warm Start | Best For                   |
| ------------------- | ---------- | ---------- | -------------------------- |
| **Zellij**          | ~100ms     | ~50ms      | Local development, fastest |
| **Apple Container** | ~1s        | ~500ms     | macOS native, fast         |
| **Docker**          | 2-5s       | 1-2s       | General use, balanced      |
| **Kubernetes**      | 10-30s     | 5-10s      | Production, scalable       |
| **Sprites**         | 5-15s      | 3-8s       | Remote, variable (network) |

**Cold start:** First session creation (image pull, container creation)
**Warm start:** Subsequent sessions (image cached, container reuse)

### Backend Performance Characteristics

**Zellij (Fastest):**

- ✅ No container overhead
- ✅ Native filesystem performance
- ✅ Instant session creation
- ❌ No isolation (shares host environment)

**Apple Container (Very Fast):**

- ✅ Native macOS integration
- ✅ Fast filesystem (APFS)
- ✅ Minimal overhead
- ❌ macOS only

**Docker (Balanced):**

- ✅ Good performance with proper configuration
- ✅ Extensive caching options
- ✅ Wide compatibility
- ⚠️ Volume performance can vary

**Kubernetes (Scalable):**

- ✅ Excellent for many concurrent sessions
- ✅ Resource scheduling and limits
- ❌ Slowest startup time
- ❌ Higher overhead per session

**Sprites (Remote):**

- ✅ No local resource usage
- ✅ Powerful remote hardware
- ❌ Network latency impacts git operations
- ⚠️ Performance depends on internet speed

### When to Use Each Backend

**Zellij:**

- Quick experiments and prototypes
- Latency-sensitive workflows
- Limited resource environments
- When you trust the repository code

**Apple Container:**

- macOS development
- Native performance requirements
- iOS/macOS app development

**Docker:**

- General-purpose development
- Isolation required
- Cross-platform consistency
- Moderate performance needs

**Kubernetes:**

- Many concurrent sessions
- Production-like environments
- Resource isolation critical
- Startup time not critical

**Sprites:**

- Limited local resources
- Large repository cloning
- Powerful compute needs
- Remote development

## Docker Optimization

### Volume Mode vs Bind Mounts

Two strategies with different performance trade-offs:

**Bind Mounts (Default):**

```bash
clauderon create --backend docker --volume-mode bind
```

- ✅ No copy overhead (direct host filesystem access)
- ✅ Instant session creation
- ✅ Changes immediately visible on host
- ❌ Slower I/O on macOS/Windows (especially with large file counts)

**Docker Volumes:**

```bash
clauderon create --backend docker --volume-mode volume
```

- ✅ Better I/O performance (Linux native filesystem)
- ✅ Consistent performance across platforms
- ❌ Initial copy overhead (proportional to repo size)
- ❌ Changes not directly visible on host

**Performance comparison (macOS):**

| Operation               | Bind Mount | Docker Volume    |
| ----------------------- | ---------- | ---------------- |
| Session create          | 1s         | 5s (+ copy time) |
| File read (1000 files)  | 2s         | 0.5s             |
| File write (1000 files) | 3s         | 0.8s             |
| Git operations          | 1.5x       | 1x (baseline)    |

**Recommendation:**

- **Linux:** Bind mounts (minimal difference)
- **macOS/Windows:** Docker volumes for I/O-heavy workloads
- **Small repos (<100MB):** Bind mounts
- **Large repos (>1GB):** Docker volumes

### Image Pull Policy

Control when Docker pulls images:

```toml
# ~/.config/clauderon/config.toml
[docker]
image_pull_policy = "IfNotPresent"  # Options: Always, IfNotPresent, Never
```

**Always:**

- Pulls image every session creation
- Ensures latest image
- Slowest (network overhead)
- Use for: Production, frequent image updates

**IfNotPresent (Default):**

- Pulls only if image not cached
- Balanced performance
- Use for: Most development workflows

**Never:**

- Never pulls, uses cached image only
- Fastest startup
- Fails if image not cached
- Use for: Offline development, custom images

### Pre-pulling Images

Pre-pull images to avoid delays during session creation:

```bash
# Pull default image
docker pull clauderon/agent:latest

# Pull specific image
docker pull clauderon/agent:claude-code-v1.0
```

**Automate pre-pulling:**

```bash
# In cron or startup script
docker pull clauderon/agent:latest
```

Or configure image warming:

```toml
[docker]
warm_images = ["clauderon/agent:latest", "clauderon/agent:gpt-codex"]
```

(Feature may require implementation)

### Build Caching

For custom images with Dockerfile builds:

```dockerfile
# Optimize layer caching - put stable layers first
FROM clauderon/base:latest

# Dependencies change less frequently
COPY package.json package-lock.json ./
RUN npm install

# Code changes more frequently
COPY . .
RUN npm run build
```

**Cache persistence:**

```toml
[docker]
# Preserve build cache across sessions
preserve_build_cache = true
```

## Resource Limits

### CPU Limits

**When to use:**

- Preventing resource monopolization
- Running many concurrent sessions
- Enforcing fair resource sharing

**When NOT to use:**

- Single-user development machine
- Latency-sensitive workloads
- Sessions need full CPU for builds

**Configuration:**

```bash
# Limit to 2 CPUs
clauderon create --backend docker --cpu-limit 2

# Or in config
```

```toml
[docker]
default_cpu_limit = 2  # CPU cores
```

**Impact on build times:**

| Build Type         | No Limit | 2 CPU Limit | 1 CPU Limit |
| ------------------ | -------- | ----------- | ----------- |
| Rust (cargo build) | 60s      | 90s         | 180s        |
| Node (npm install) | 30s      | 40s         | 60s         |
| Go (go build)      | 15s      | 20s         | 30s         |

**Recommendation:** Avoid CPU limits unless necessary.

### Memory Limits

**When to use:**

- Preventing OOM kills of host system
- Enforcing resource constraints
- Testing low-memory scenarios

**When NOT to use:**

- Single session on powerful machine
- Memory-intensive builds (Rust, C++)
- Large language model operations

**Configuration:**

```bash
# Limit to 4GB
clauderon create --backend docker --memory-limit 4g

# Or in config
```

```toml
[docker]
default_memory_limit = "4g"
```

**Typical memory requirements:**

| Task           | Minimum | Recommended | Comfortable |
| -------------- | ------- | ----------- | ----------- |
| Light editing  | 512MB   | 1GB         | 2GB         |
| Node.js build  | 1GB     | 2GB         | 4GB         |
| Rust build     | 2GB     | 4GB         | 8GB         |
| Large AI model | 4GB     | 8GB         | 16GB        |

**Recommendation:** Set memory limit to 50-75% of available host memory for single-session use, or divide evenly for concurrent sessions.

## Proxy Performance

### Proxy Port Reuse

**Experimental feature** to reduce port allocation overhead:

```toml
[features]
proxy_port_reuse = true
```

**Benefits:**

- Faster session creation (~100ms improvement)
- Reduced port exhaustion
- Better resource utilization

**Risks:**

- Race conditions during rapid session creation
- Port conflicts if timing is unlucky
- Not recommended for production (yet)

**When to enable:**

- Development environments
- Single-user setups
- Frequent session create/delete cycles

### TLS Overhead

Proxy uses TLS for all credential injection. Impact is minimal but measurable:

**Performance impact:**

- Overhead: ~5-10ms per API request
- Throughput: ~95% of non-TLS
- CPU usage: +2-5% for agent requests

**Optimization:**

Cannot disable TLS (required for security), but can:

- Use faster ciphers (automatically selected)
- Enable TLS session resumption (enabled by default)
- Use connection pooling (implemented)

### Audit Logging Impact

Audit logging adds overhead:

```toml
[features]
audit_logging = true  # Logs all proxy requests
```

**Performance impact:**

| Metric          | No Audit   | With Audit | Overhead |
| --------------- | ---------- | ---------- | -------- |
| Request latency | 10ms       | 12ms       | +20%     |
| Throughput      | 1000 req/s | 850 req/s  | -15%     |
| Disk I/O        | Minimal    | Moderate   | Varies   |

**When to enable:**

- Security compliance required
- Debugging credential issues
- Production environments

**When to disable:**

- Performance-critical workflows
- High-frequency API calls
- Local development

## Git Worktree Performance

### Worktree vs Clone

Clauderon uses git worktrees by default (except Sprites):

**Worktree advantages:**

- Instant creation (no clone time)
- Shared object database (saves disk space)
- Faster session creation

**Clone advantages:**

- No dependency on main repository
- Can be moved independently
- Better for remote backends (Sprites)

**Performance comparison:**

| Repository Size | Worktree Creation | Full Clone |
| --------------- | ----------------- | ---------- |
| 10MB            | 100ms             | 2s         |
| 100MB           | 200ms             | 10s        |
| 1GB             | 500ms             | 60s        |
| 10GB            | 2s                | 600s       |

### Large Repository Strategies

For very large repositories (>1GB):

**1. Use Sprites backend:**

- Remote clone avoids local disk usage
- Powerful remote machines handle large repos better

**2. Use shallow clones (future feature):**

```bash
clauderon create --shallow --depth 1
```

**3. Use sparse checkout (future feature):**

```bash
clauderon create --sparse-checkout "src/*"
```

**4. Split into smaller repositories:**

- If possible, refactor into smaller repos
- Use multi-repo sessions for coordination

**5. Use Docker volumes:**

- Better I/O performance for large file counts

### Git Operation Performance

**Worktree filesystem performance:**

| Operation       | Speed  | Notes             |
| --------------- | ------ | ----------------- |
| Checkout branch | Fast   | Shared objects    |
| Commit          | Fast   | No network        |
| Push            | Normal | Network dependent |
| Fetch           | Fast   | Shared objects    |
| Rebase          | Fast   | Local operation   |

**Optimization tips:**

- Keep repository clean (no large untracked files)
- Use `.gitignore` properly
- Avoid committing build artifacts
- Periodically run `git gc` on main repo

## Caching Strategies

### Rust (Cargo)

**Docker volume for cargo cache:**

```bash
# Create persistent volume
docker volume create clauderon-cargo-cache

# Use in session (automatic if configured)
```

```toml
[docker]
persistent_caches = ["cargo"]
```

**Cache hit improvement:**

- Cold build: 5-10 minutes
- Warm build: 30-60 seconds
- Savings: 80-90%

### Node.js (npm/bun)

**Docker volume for npm/bun cache:**

```toml
[docker]
persistent_caches = ["npm", "bun"]
```

**Cache hit improvement:**

- Cold install: 2-5 minutes
- Warm install: 10-30 seconds
- Savings: 70-85%

**Bun-specific optimization:**

Bun is faster than npm/yarn:

- `bun install` ~3x faster than `npm install`
- Better caching and parallelization

### Docker Layer Caching

**Build custom images with layering optimization:**

```dockerfile
# Bad: Single layer
COPY . .
RUN npm install && npm run build

# Good: Separate layers
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
```

Each layer cached independently - only rebuild what changed.

### Clean Cache Command

Clear caches when they become stale or consume too much disk:

```bash
# Clear all session caches
clauderon cache clean

# Clear specific cache type
clauderon cache clean --type cargo

# Check cache size
clauderon cache size
```

(Commands may require implementation)

## Model Selection for Speed

Different AI models have different response times:

### Fastest Models

**For quick iterations:**

- Claude Haiku 4.5 (fastest Claude)
- GPT-5.2-Instant (fastest GPT)
- Gemini 3 Flash (fastest Gemini)

**Typical latency:**

- First token: 200-500ms
- Tokens/second: 50-100

### Balanced Models (Default)

**For most tasks:**

- Claude Sonnet 4.5 (default)
- GPT-5.2-Codex
- Gemini 3 Pro

**Typical latency:**

- First token: 500-1000ms
- Tokens/second: 30-60

### Slowest Models

**For complex tasks only:**

- Claude Opus 4.5
- GPT-5.2-Thinking
- GPT-5.2-Pro

**Typical latency:**

- First token: 1-3s
- Tokens/second: 20-40

See [Model Selection Guide](/guides/model-selection/) for detailed comparison.

## Monitoring Performance

### Session Creation Time

Track session creation performance:

```bash
# Time session creation
time clauderon create --backend docker --repo ~/project --prompt "test"
```

**Target times:**

- Zellij: <500ms
- Docker (bind): 1-3s
- Docker (volume): 3-10s (depends on repo size)
- Kubernetes: 10-30s
- Sprites: 5-15s (network dependent)

### Container Startup Time

Monitor container readiness:

```bash
# Check when container becomes healthy
clauderon status <session-name>
```

**Factors affecting startup:**

- Image size (larger = slower pull)
- Container initialization scripts
- Resource allocation delays
- Network conditions (for image pull)

### API Response Times

Monitor API latency:

```bash
# Test API responsiveness
curl -w "Total time: %{time_total}s\n" http://localhost:3030/api/sessions
```

**Expected latency:**

- Session list: 10-50ms
- Session detail: 20-100ms
- Create session: 1-30s (depends on backend)
- Attach session: 100-500ms

### Proxy Latency

Measure proxy overhead:

```bash
# Without proxy
time curl https://api.anthropic.com/v1/messages

# With proxy (in session)
time curl https://api.anthropic.com/v1/messages
```

**Expected overhead:** +5-15ms per request

## Performance Best Practices

### General

1. **Choose right backend** - Zellij for speed, Docker for isolation, K8s for scale
2. **Use appropriate model** - Haiku for quick tasks, Sonnet as default, Opus for complex only
3. **Enable caching** - Persistent caches for Cargo, NPM, etc.
4. **Pre-pull images** - Avoid pull delays during session creation
5. **Monitor resource usage** - Adjust limits based on actual needs

### Backend-Specific

**Docker:**

- Use volumes on macOS/Windows for I/O performance
- Set `image_pull_policy = "IfNotPresent"`
- Pre-pull images before heavy session creation
- Use persistent caches for build tools

**Kubernetes:**

- Use node affinity for session locality
- Pre-create storage classes
- Set appropriate resource requests (not just limits)
- Use local storage when possible

**Sprites:**

- Enable build caching
- Use hibernation for idle sessions
- Choose region closest to you

### Development Workflow

1. **Start with fast backend** - Zellij or Docker for initial development
2. **Use fast model** - Haiku for quick iterations
3. **Enable caching** - Cargo, NPM, etc.
4. **Scale up when needed** - Switch to Opus for complex refactoring
5. **Move to K8s/Sprites for production-like testing**

## Troubleshooting Slow Performance

### Slow Docker Image Pulls

**Symptoms:**

- Session creation takes 30s-5min
- "Pulling image..." message for long time

**Solutions:**

- Pre-pull images: `docker pull clauderon/agent:latest`
- Use `image_pull_policy = "IfNotPresent"`
- Check network speed: `docker pull alpine` (should be fast)
- Use local registry mirror for large organizations

### High Proxy Latency

**Symptoms:**

- Agent responses delayed by seconds
- API calls take much longer than expected

**Solutions:**

- Check `clauderon serve` logs for errors
- Verify proxy is running locally (not remote)
- Disable audit logging if enabled
- Check for proxy port conflicts

### Slow Git Operations

**Symptoms:**

- `git status` takes >5s
- Git operations hang or timeout

**Solutions:**

- Run `git gc` on main repository
- Check for large untracked files
- Verify filesystem performance (disk full?)
- Use Sprites backend (remote git)

### Resource Contention

**Symptoms:**

- All operations slower than usual
- CPU/memory maxed out
- System becomes unresponsive

**Solutions:**

- Reduce concurrent sessions
- Set CPU/memory limits
- Archive old sessions
- Increase host resources

### Network Issues (Sprites)

**Symptoms:**

- Session creation very slow
- Git operations timeout
- Intermittent connection failures

**Solutions:**

- Check internet speed (run speedtest)
- Try different Sprites region
- Use Docker/Zellij for network-independent work
- Enable build caching to reduce clone frequency

## Performance Metrics Reference

### Target Latency (95th percentile)

| Operation               | Target | Acceptable | Slow   |
| ----------------------- | ------ | ---------- | ------ |
| Session list API        | 50ms   | 100ms      | >200ms |
| Session create (Zellij) | 500ms  | 1s         | >2s    |
| Session create (Docker) | 3s     | 10s        | >20s   |
| Agent first token       | 1s     | 3s         | >5s    |
| Proxy overhead          | 10ms   | 20ms       | >50ms  |

### Resource Usage Targets

| Component         | CPU      | Memory    | Disk      |
| ----------------- | -------- | --------- | --------- |
| clauderon daemon  | <5% idle | 50-100MB  | Minimal   |
| Proxy per session | <2%      | 10-20MB   | Logs only |
| Docker container  | Varies   | 512MB-8GB | Repo size |
| Database          | <1%      | 10-20MB   | 10-100MB  |

### Throughput Targets

| Metric                       | Target | Notes                |
| ---------------------------- | ------ | -------------------- |
| Sessions per minute (create) | 10-20  | Docker backend       |
| Concurrent sessions          | 20-50  | Depends on resources |
| API requests/second          | 100+   | Daemon capacity      |
| Proxy requests/second        | 50-100 | Per session          |

## See Also

- [Model Selection](/guides/model-selection/) - Choose the right model for performance
- [Docker Backend](/guides/docker/) - Docker-specific optimizations
- [Kubernetes Backend](/guides/kubernetes/) - K8s performance tuning
- [Configuration Reference](/reference/configuration/) - Performance-related settings

---
title: Performance Tuning
description: Optimize Clauderon for faster session creation, agent responses, and overall performance
---

## Backend Startup Times

| Backend    | Cold Start | Warm Start | Best For             |
| ---------- | ---------- | ---------- | -------------------- |
| **Zellij** | ~100ms     | ~50ms      | Fastest, no isolation |
| **Docker** | 2-5s       | 1-2s       | Balanced, isolated   |

## Docker Optimization

### Volume Mode vs Bind Mounts

```bash
clauderon create --backend docker --volume-mode bind    # default
clauderon create --backend docker --volume-mode volume
```

| Operation               | Bind Mount | Docker Volume    |
| ----------------------- | ---------- | ---------------- |
| Session create          | 1s         | 5s (+ copy time) |
| File read (1000 files)  | 2s         | 0.5s             |
| File write (1000 files) | 3s         | 0.8s             |
| Git operations          | 1.5x       | 1x (baseline)    |

**Recommendation:** Bind mounts on Linux/small repos. Docker volumes on macOS/Windows or large repos (>1GB).

### Image Pull Policy

```bash
clauderon create --backend docker --pull-policy if-not-present  # default
clauderon create --backend docker --pull-policy never           # fastest, requires cached image
clauderon create --backend docker --pull-policy always          # ensures latest
```

Pre-pull images to avoid delays: `docker pull clauderon/agent:latest`

## Resource Limits

### CPU

```bash
clauderon create --backend docker --cpu-limit 2
```

| Build Type    | No Limit | 2 CPU | 1 CPU |
| ------------- | -------- | ----- | ----- |
| Rust (cargo)  | 60s      | 90s   | 180s  |
| Node (npm)    | 30s      | 40s   | 60s   |
| Go            | 15s      | 20s   | 30s   |

### Memory

```bash
clauderon create --backend docker --memory-limit 4g
```

| Task          | Minimum | Recommended |
| ------------- | ------- | ----------- |
| Light editing | 512MB   | 1GB         |
| Node.js build | 1GB     | 2GB         |
| Rust build    | 2GB     | 4GB         |

## Proxy Performance

| Setting | Impact |
| ------- | ------ |
| TLS overhead | ~5-10ms per request |
| Audit logging | +20% latency, -15% throughput |
| Port reuse (experimental) | ~100ms faster session creation |

```toml
[feature_flags]
proxy_port_reuse = true    # experimental, dev only
audit_logging = false      # disable for performance
```

## Git Worktree Performance

| Repository Size | Worktree Creation | Full Clone |
| --------------- | ----------------- | ---------- |
| 10MB            | 100ms             | 2s         |
| 100MB           | 200ms             | 10s        |
| 1GB             | 500ms             | 60s        |
| 10GB            | 2s                | 600s       |

## Caching

Clauderon automatically creates shared Docker volumes for Cargo and npm/bun caching.

| Tool  | Cold  | Warm      | Savings |
| ----- | ----- | --------- | ------- |
| Cargo | 5-10m | 30-60s    | 80-90%  |
| npm   | 2-5m  | 10-30s    | 70-85%  |

```bash
clauderon cache clean              # clear all
clauderon cache clean --type cargo # specific type
clauderon cache size               # check usage
```

## Target Latency (p95)

| Operation               | Target | Acceptable | Slow   |
| ----------------------- | ------ | ---------- | ------ |
| Session list API        | 50ms   | 100ms      | >200ms |
| Session create (Zellij) | 500ms  | 1s         | >2s    |
| Session create (Docker) | 3s     | 10s        | >20s   |
| Agent first token       | 1s     | 3s         | >5s    |
| Proxy overhead          | 10ms   | 20ms       | >50ms  |

## Resource Usage Targets

| Component         | CPU      | Memory    | Disk      |
| ----------------- | -------- | --------- | --------- |
| clauderon daemon  | <5% idle | 50-100MB  | Minimal   |
| Proxy per session | <2%      | 10-20MB   | Logs only |
| Docker container  | Varies   | 512MB-8GB | Repo size |
| Database          | <1%      | 10-20MB   | 10-100MB  |

## Troubleshooting

| Symptom | Solution |
| ------- | -------- |
| Slow image pulls (30s-5m) | Pre-pull images; use `--pull-policy if-not-present` |
| High proxy latency | Check `clauderon serve` logs; disable audit logging |
| Slow git operations (>5s) | Run `git gc`; check for large untracked files |
| Resource contention | Reduce concurrent sessions; set CPU/memory limits |

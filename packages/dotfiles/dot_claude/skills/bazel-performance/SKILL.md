---
name: bazel-performance
description: |
  High-performance Bazel optimization - profiling, caching, memory, I/O, CPU, rule authoring, and debugging.
  When user works with Bazel builds, .bazelrc, BUILD files, mentions slow builds, cache misses, memory issues, or wants to optimize build performance. Also use when writing custom Starlark rules, debugging remote cache, or profiling build bottlenecks. Use this skill proactively whenever Bazel performance could be relevant.
---

# High-Performance Bazel

Distilled from ~60 official docs, blog posts, and engineering articles. Focused on minimizing system calls, I/O, CPU, and memory usage.

## Top 10 Optimizations (Ranked by Impact)

1. **Keep the analysis cache warm** -- Don't switch flags, don't kill the server, use `--noallow_analysis_cache_discard`
2. **Use depsets correctly in custom rules** -- Never flatten early; use `ctx.actions.args()` for deferred expansion
3. **Enable remote caching** with compression, async uploads, and `--remote_download_outputs=minimal`
4. **Persistent workers** for compilation-heavy actions -- 2-6x speedup
5. **Reuse sandbox directories** -- `--reuse_sandbox_directories` eliminates repeated directory setup syscalls
6. **Set adequate JVM heap** -- Too low causes GC thrashing and analysis cache eviction
7. **Profile before optimizing** -- JSON trace profiles + critical path analysis reveal the actual bottleneck
8. **Fine-grained targets** -- One BUILD file per directory enables parallelism and incrementality
9. **Disk cache** -- Survives `bazel clean`, crucial for branch switching
10. **Skyfocus** (experimental) -- 45% memory reduction while preserving incremental speed

---

## Reduce System Calls

### Sandbox Overhead
Sandboxing creates/destroys directory trees per action -- symlinks, mkdir, and cleanup syscalls on every action.

- **`--reuse_sandbox_directories`** -- Retain sandbox dirs between actions; eliminates repeated mkdir/rmdir/symlink cycles
- **`--spawn_strategy=worker,sandboxed`** -- Prefer persistent workers (no sandbox setup per action); fall back to sandbox
- **`--strategy=Genrule=local`** -- Disable sandboxing for trusted rule types entirely
- **`--worker_sandboxing`** -- Lighter isolation for workers (avoids full sandbox while retaining some guarantees)

### Persistent Workers (2-6x speedup)
Workers keep tool processes alive, eliminating fork/exec per action. Tool-internal caches (JIT warmup, AST caches) persist.

- **`--strategy=Javac=worker`** -- Enable per action mnemonic
- **`--worker_max_instances=N`** (default: 4) -- For single-target incremental builds, 1 often suffices
- **Multiplex workers** (`--experimental_worker_multiplex_sandboxing`) -- Share one process across concurrent actions
- Supported: Java, Scala, Kotlin, NodeJS (via `@bazel/worker`)

### Process Spawning
- Each action without a worker spawns a new process. Fine-grained targets increase action count but enable parallelism -- balance target granularity against spawn overhead
- `--local_cpu_resources` and `--local_ram_resources` prevent over-spawning (critical in containers)

---

## Reduce I/O

### Build Without the Bytes (biggest remote I/O win)
- **`--remote_download_outputs=minimal`** -- Skip downloading intermediate artifacts from remote cache/execution
- **`--remote_download_outputs=toplevel`** -- Download only top-level outputs (default)
- **`--remote_download_regex`** -- Selectively force downloads for specific paths

### Remote Cache I/O
- **`--remote_cache_async`** (default: true in newer Bazel) -- Upload results in background, non-blocking
- **`--remote_cache_compression`** -- zstd compression reduces bytes transferred
- **`--experimental_remote_cache_chunking`** -- Content-defined chunking (FastCDC) for large blob deduplication
- **`--digest_function=BLAKE3`** (Bazel 6.4+) -- Faster hashing than SHA256
- **gRPC over HTTP** for remote cache -- lower per-request overhead

### Disk I/O
- **`--output_base=<path>`** -- Place output on fast storage (SSD, tmpfs, ramdisk)
- **`--disk_cache=<path>`** -- Local disk cache for branch switching; survives `bazel clean`
- **Disk cache GC** (Bazel 7.4+): `--experimental_disk_cache_gc_max_size=10G`, `--experimental_disk_cache_gc_max_age=14d`
- **`--nobuild_runfile_links`** -- Skip creating symlink trees when not needed
- **`--noexperimental_check_output_files`** -- Skip stat'ing output files after build

### File Watching & Merkle Trees
- **`--watchfs`** -- Use OS file watching instead of polling; reduces stat syscalls on incremental builds
- **`--experimental_remote_merkle_tree_cache`** -- Cache computed Merkle trees to avoid recomputation
- **`--experimental_remote_discard_merkle_trees`** (default: true) -- Discard in-memory copies after use (trades CPU for memory)

---

## Reduce CPU Usage

### Analysis Cache Preservation
**The single most important factor for iteration speed.** Losing the analysis cache forces full re-analysis.

- **`--noallow_analysis_cache_discard`** (Bazel 6.4+) -- Error instead of warning on cache loss
- Never switch flags between invocations (e.g., `-c opt` then `cquery`)
- Never change startup options mid-workflow
- Press Ctrl-C only once (repeated presses kill the server)
- **`--max_idle_secs=0`** -- Keep the server alive indefinitely
- Use **`--output_base`** for separate flag sets (each gets its own server + cache)

### Parallelism Tuning
- **`--jobs=N`** -- Concurrent action limit. `auto` is usually good; for remote, increase to 50-600
- **`--local_cpu_resources=HOST_CPUS-1`** -- Leave headroom for the Bazel server
- **`--local_ram_resources=HOST_RAM*.5`** -- Prevent OOM from over-parallelism
- **`--io_nice_level=N`** (Linux, -1 to 7) -- Set I/O scheduling priority
- **`--batch_cpu_scheduling`** -- Use batch CPU scheduling for non-interactive builds

### Dynamic Execution
Races local vs remote; uses whichever finishes first.

- **`--dynamic_local_execution_delay=1000`** -- Delay local start when remote cache hits are likely
- **`--experimental_dynamic_local_load_factor`** (0-1) -- Reduce local scheduling when many remote actions queued
- **`--experimental_dynamic_slow_remote_time`** -- Start local branches when remote is slow
- Apply to **specific action types only** (e.g., `--strategy=Javac=dynamic`), never blanket

### Exec Configuration
Bazel auto-optimizes tools: `--strip=always`, `-c opt`, `--copt=-g0`. Reduces linking time, disk space, and network I/O for tool actions.

---

## Reduce Memory Usage

### JVM Heap
- **`startup --host_jvm_args=-Xmx16g`** -- Set max heap. Too low = GC thrashing + analysis cache eviction
- Signs of memory pressure: frequent `MerkleTree.build` in profiles, heavy GC, analysis cache re-computation

### GC Tuning
- **`--gc_thrashing_limits=1s:2,20s:3,1m:5`** -- OOM if consecutive full GCs exceed tenured space limits
- **`--gc_churning_threshold=100`** -- % of wall time in full GC before Bazel gives up
- **`--heap_dump_on_oom`** -- Generate heap dump for post-mortem analysis
- **`startup --host_jvm_args=-XX:-UseParallelGC`** -- Serial GC may be better for small heaps

### Skyframe Memory Management
- **`--skyframe_high_water_mark_threshold=85`** -- Trigger state cleanup when heap exceeds this %
- **`--heuristically_drop_nodes`** -- Drop FileState/DirectoryListingState nodes after use

### Skyfocus (Experimental, 45% reduction)
- **`--experimental_enable_skyfocus`** + **`--experimental_working_set=path1,path2`**
- Documented heap reduction: 1237MB to 676MB (-45%)
- Tradeoff: changes outside working set cause build errors

### Memory-Speed Tradeoffs
Three flags that save memory at the cost of incremental speed:
1. **`--discard_analysis_cache`** -- ~10% memory savings; forces re-analysis next build
2. **`--nokeep_state_after_build`** -- Discards all data after build
3. **`--notrack_incremental_state`** -- No dependency graph edges stored

### Worker Memory
- **`--worker_max_instances=N`** (default: 4) -- Fewer workers = less memory
- **`--worker_quit_after_build`** -- Force shutdown after build completes

---

## Rule Authoring for Performance

The most important pattern: **use depsets, not lists, for transitive data.** Lists cause O(N^2) copying; depsets share via DAG structure.

```python
# BAD: Flattening depset prematurely
all_files = depset(...).to_list() + ctx.files.srcs

# BAD: Nesting depset() in a loop
x = depset()
for i in inputs:
    x = depset(transitive=[x, i.deps])

# GOOD: Collect all transitives, merge once
x = depset(direct=ctx.files.srcs, transitive=[dep[MyInfo].files for dep in ctx.attr.deps])
```

- Never call `to_list()` except in terminal rules (binaries, test rules)
- Use `ctx.actions.args()` to defer depset expansion to execution phase (90%+ memory reduction)
- Declare only necessary inputs -- every extra input increases stat overhead
- Use Validations Output Group (`_validation`) to run validation off the critical path

For detailed patterns and examples, read `references/rule-authoring-performance.md`.

---

## Caching Strategy

Three cache layers, fastest to slowest:

| Layer | Scope | Persistence | Key Flag |
|-------|-------|-------------|----------|
| Analysis cache | In-memory | Lost on server restart or flag change | `--noallow_analysis_cache_discard` |
| Disk cache | Per-machine | Survives `bazel clean` | `--disk_cache=~/.cache/bazel-disk` |
| Remote cache | Team-wide | Shared across machines | `--remote_cache=grpc://...` |

**Top cache hit rate killers:** environment variable leakage, non-hermetic toolchains, flag differences across machines, platform property mismatches.

For complete caching setup and debugging, read `references/caching-strategy.md`.

---

## Profiling & Debugging

### Quick Start: "Why is my build slow?"

```bash
# 1. Generate detailed profile
bazel build --profile=profile.gz --noslim_profile //target

# 2. View in chrome://tracing or Perfetto (ui.perfetto.dev)

# 3. Automated analysis at analyzer.engflow.com
```

### Quick Start: "Why did this action re-run?"

```bash
bazel build --explain=explain.log --verbose_explanations //target
```

### Profile Interpretation

| Symptom in Profile | Root Cause | Fix |
|--------------------|-----------|-----|
| Slow `runAnalysisPhase` | Depset flattening, expensive macros, recursive globs | Fix rules, simplify BUILD files |
| Individual slow critical-path action | Large action, many inputs | Split action, reduce transitive deps |
| Few busy threads, many idle | Parallelism bottleneck | Finer-grained targets |
| Heavy GC events | Insufficient heap | Increase `-Xmx`, try Skyfocus |
| High `REMOTE_SETUP`/`FETCH` | Infrastructure overhead | Network proximity, compression |
| High wall time, low CPU | Waiting on I/O/network | Build without the Bytes, faster storage |
| High system time | File I/O bottleneck | SSD, tmpfs, reduce inputs |

For complete profiling workflows (execution logs, aquery, benchmarking, BEP metrics), read `references/profiling-debugging-workflows.md`.

---

## BEP Metrics for Dashboards

| Metric | Phase | What It Tells You |
|--------|-------|-------------------|
| `PackageMetrics.packages_loaded` | Loading | BUILD files parsed |
| `TargetMetrics.targets_configured` | Analysis | Targets + aspects configured |
| `ActionSummary.actions_created` | Graph | Total actions (including unused) |
| `ActionSummary.actions_executed` | Execution | Actions actually run |
| `BuildGraphSummary.outputArtifactCount` | Output | Artifacts produced |
| `CumulativeMetrics.num_analyses` | Meta | 1=clean, >1=incremental |
| `MemoryMetrics.peak_post_gc_heap_size` | Memory | Peak heap after GC |
| `NetworkMetrics.SystemNetworkStats` | Network | Bytes in/out |

---

## Recommended .bazelrc Template

```bash
# === Performance ===

# JVM
startup --host_jvm_args=-Xmx16g

# Server lifecycle
startup --max_idle_secs=0

# Parallelism
build --jobs=auto

# Analysis cache protection
build --noallow_analysis_cache_discard

# Sandbox optimization
build --reuse_sandbox_directories
build --noexperimental_check_output_files

# File watching
build --watchfs

# Merkle tree
build --experimental_remote_merkle_tree_cache

# Disk cache
build --disk_cache=~/.cache/bazel-disk
build --experimental_disk_cache_gc_max_size=10G
build --experimental_disk_cache_gc_max_age=14d

# Remote cache (dev -- read-only)
build --remote_cache=https://your-cache-server
build --remote_upload_local_results=false
build --remote_cache_compression
build --remote_cache_async

# Remote cache (CI -- read-write)
build:ci --remote_cache=grpc://cache:9092
build:ci --remote_upload_local_results=true

# Hashing
build --digest_function=BLAKE3

# Build without the Bytes (remote)
build --remote_download_outputs=toplevel

# Memory management
build --skyframe_high_water_mark_threshold=85
build --heuristically_drop_nodes

# Profiling (always-on, low overhead)
build --experimental_collect_load_average_in_profiler

# === CI-specific ===
build:ci --remote_download_outputs=minimal
build:ci --sandbox_fake_hostname
build:ci --sandbox_fake_username
build:ci --nolegacy_important_outputs
build:ci --remote_build_event_upload=minimal
```

---

## Reference Files

Read these for deep-dive content on specific topics:

| File | When to Read |
|------|-------------|
| `references/flags-reference.md` | Need the complete list of all performance-related flags |
| `references/rule-authoring-performance.md` | Writing or optimizing custom Starlark rules |
| `references/profiling-debugging-workflows.md` | Debugging slow builds, cache misses, or memory issues step-by-step |
| `references/caching-strategy.md` | Setting up or debugging remote/disk caching |

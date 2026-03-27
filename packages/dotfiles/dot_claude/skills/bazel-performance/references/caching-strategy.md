# Caching Strategy

Complete guide to Bazel's cache layers, configuration, and cache miss debugging.

---

## Cache Architecture

Bazel uses a two-layer action caching system:

- **Action cache**: Maps action hash (inputs + command + env) to action result metadata
- **Content-addressable store (CAS)**: Stores actual output files by content hash

Three cache scopes, fastest to slowest:

| Layer          | Scope       | Persistence                           | Cost to Lose                 |
| -------------- | ----------- | ------------------------------------- | ---------------------------- |
| Analysis cache | In-memory   | Lost on server restart or flag change | Very high (full re-analysis) |
| Disk cache     | Per-machine | Survives `bazel clean`                | Medium (re-execution)        |
| Remote cache   | Team-wide   | Shared across machines                | Low (just network fetch)     |

---

## Analysis Cache Preservation

The analysis cache is the most impactful cache. Losing it forces full re-analysis of the entire dependency graph.

### Rules for Preserving It

1. **Do not switch flags between invocations** -- `bazel build -c opt` then `bazel cquery` discards and rebuilds the cache
2. **Do not kill the Bazel server** -- Multiple Ctrl-C kills the server; configure `--max_idle_secs`
3. **Do not change startup options** -- Forces a full server restart
4. **Use `--output_base`** for different flag sets -- Each gets its own server and cache
5. **Enforce preservation** -- `--noallow_analysis_cache_discard` (Bazel 6.4+) turns discard warnings into errors

Watch for this log message: `"Build option --compilation_mode has changed, discarding analysis cache."`

---

## Disk Cache

```bash
build --disk_cache=~/.cache/bazel-disk
```

- Survives `bazel clean` (only `bazel clean --expunge` removes it)
- Ideal for branch switching -- actions cached from other branches are reusable
- Use tilde (`~`) for per-user paths in shared `.bazelrc`

### Garbage Collection (Bazel 7.4+)

```bash
build --experimental_disk_cache_gc_max_size=10G    # Storage limit
build --experimental_disk_cache_gc_max_age=14d     # Entry retention
build --experimental_disk_cache_gc_idle_delay=300  # Seconds idle before GC (default: 5m)
```

Without GC, disk cache grows unbounded.

---

## Remote Cache

### Setup

```bash
# Supports http, https, grpc, grpcs, unix schemes
build --remote_cache=grpc://your-cache-server:9092

# Or HTTPS
build --remote_cache=https://cache.example.com
```

### Read-Only vs Read-Write

```bash
# CI: read-write (populates cache)
build:ci --remote_cache=grpc://cache:9092
build:ci --remote_upload_local_results=true

# Dev: read-only (consumes cache, doesn't pollute)
build --remote_cache=https://cache.example.com
build --remote_upload_local_results=false
```

### Performance Flags

```bash
build --remote_cache_async                          # Background uploads (default: true in newer Bazel)
build --remote_cache_compression                    # zstd compression
build --experimental_remote_cache_chunking          # Content-defined chunking for large blobs
build --digest_function=BLAKE3                      # Faster hashing (Bazel 6.4+)
```

### Authentication

```bash
# Basic Auth (always use HTTPS)
build --remote_cache=https://user:pass@host:port/path

# Google Cloud
build --google_credentials=/path/to/key.json

# Unix domain socket (lowest latency for local cache servers)
build --remote_proxy=unix:/path/to/socket
```

### Protocol

- gRPC preferred over HTTP for performance
- Action cache at `/ac/`, CAS at `/cas/`

---

## Two-Tier Cache (Disk + Remote)

Combine both for maximum cache coverage:

```bash
build --disk_cache=~/.cache/bazel-disk
build --remote_cache=grpc://cache:9092
```

Bazel checks disk cache first (fastest), then remote cache. This reduces network fetches for recently-built actions.

---

## Repository Cache

```bash
build --repository_cache=~/.cache/bazel-repo
```

- Shared across workspaces and Bazel versions
- Avoids re-downloading external dependencies
- Checks file hashes for correctness

### Offline Builds

```bash
build --distdir=/path/to/predownloaded/deps
build --fetch=false   # Prevent automatic downloads
```

`--distdir` searches read-only directories before the repository cache.

---

## Cache Key Computation

An action's cache key is a hash of:

1. All input file contents (by digest)
2. The command line
3. Environment variables (only those set via `--action_env`)
4. Tool paths and versions (within the workspace)
5. Platform properties

Understanding this helps debug cache misses -- any difference in these inputs produces a different cache key.

---

## Cache Hit Rate Killers

| Cause                           | Symptom                                     | Fix                                               |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Environment variable leakage    | Different `$PATH` between machines          | Use `--action_env` to whitelist only needed vars  |
| Tool outside workspace          | Compiler version differs between machines   | Use hermetic toolchains                           |
| Non-deterministic outputs       | Same inputs produce different output hashes | Fix the tool or rule to be deterministic          |
| Input modification during build | Corrupted cache entries                     | `--experimental_guard_against_concurrent_changes` |
| Flag differences                | Different `--copt`, `--define`, etc.        | Standardize `.bazelrc` across team                |
| Platform property mismatch      | OS/arch in action key                       | Configure `--host_platform` and `--platforms`     |
| `tags = ["no-cache"]` on rule   | Action marked non-cacheable                 | Remove tag or fix hermeticity                     |
| `--noremote_accept_cached`      | Cache reads explicitly disabled             | Remove the flag                                   |
| Coverage reporting              | `--coverage` disables test caching          | Expected; don't run coverage on every build       |

---

## Same-Machine Cache Test

Quick way to verify your build is hermetic and cacheable:

```bash
# 1. Build to populate cache
bazel build //target

# 2. Clear local cache (not remote)
bazel clean

# 3. Rebuild and check INFO line
bazel build //target
# Look for: "INFO: 6 remote cache hit, 0 remote"
# Any misses = non-hermetic build
```

---

## Debugging Cache Misses

### Step 1: Check Hit Rate

Look at the INFO line in build output:

```
INFO: 6 remote cache hit, 3 internal, 2 remote
```

### Step 2: Use --explain

```bash
bazel build --explain=/tmp/explain.log --verbose_explanations //target
```

### Step 3: Compare Execution Logs

```bash
bazel build //target --execution_log_compact_file=/tmp/exec1.log
# ... on different machine or after change ...
bazel build //target --execution_log_compact_file=/tmp/exec2.log

bazel run //src/tools/execlog:parser -- --log_path=/tmp/exec1.log > /tmp/exec1.txt
bazel run //src/tools/execlog:parser -- --log_path=/tmp/exec2.log > /tmp/exec2.txt
diff /tmp/exec1.txt /tmp/exec2.txt
```

Look for differences in: input digests, command lines, environment variables, platform properties.

### Step 4: Exclude Non-Hermetic Targets

```python
# In BUILD file
my_rule(
    name = "flaky_output",
    tags = ["no-remote-cache"],  # Exclude from remote cache
)
```

---

## Cache TTL and Eviction

```bash
--experimental_remote_cache_ttl=3h                  # Min guaranteed blob lifetime (default)
--experimental_remote_cache_lease_extension          # Extend leases during long builds
```

Configure your remote cache server's eviction policy separately (LRU, size-based, time-based).

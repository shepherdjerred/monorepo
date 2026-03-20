# Bazel Performance Flags Reference

Complete reference of all performance-related Bazel flags, organized by category.

---

## Profiling & Tracing

```
--profile=PATH                                      # Write JSON trace profile to specific file
--generate_json_trace_profile={true,false,auto}     # Control profile generation (default: auto)
--slim_profile={true,false}                         # Merge small events (default: true); use --noslim_profile for full detail
--profiles_to_retain=N                              # Number of profiles to keep (default: 5)
--experimental_command_profile={cpu,wall,alloc,lock} # Java Flight Recorder profile
--starlark_cpu_profile=PATH                         # pprof-format CPU profile of Starlark threads
--experimental_profile_additional_tasks=TASK,...     # Extra event types in profile
--experimental_collect_load_average_in_profiler     # System load average in profile (default: true)
--experimental_collect_system_network_usage         # Network stats in BEP and profile
--experimental_collect_resource_estimation          # CPU/memory per action
--record_full_profiler_data                         # Record every event (not aggregated)
--experimental_include_primary_output               # Add primary output info to profile events
```

## Cache Debugging

```
--explain=PATH                                      # Log why actions re-executed
--verbose_explanations                              # More detailed explain output
--execution_log_compact_file=PATH                   # Compact execution log (recommended format)
--execution_log_binary_file=PATH                    # Binary protobuf execution log
--execution_log_json_file=PATH                      # JSON execution log (slowest, largest)
--experimental_execution_log_spawn_metrics          # Detailed spawn timing metrics (Bazel 5.2+)
```

## Execution Graph

```
--experimental_execution_graph_log                  # Log action dependency graph (Bazel 6.0+)
--experimental_execution_graph_log_dep_type=all     # Include all dependency types
```

The execution graph log calculates "drag" -- time potentially saved by removing a node from the critical path. Use this to predict optimization impact before making changes.

## Memory

```
startup --host_jvm_args=-Xmx<size>                  # JVM max heap (e.g., -Xmx16g)
startup --host_jvm_args=-XX:-UseParallelGC          # Disable parallel GC (serial may be better for small heaps)
--memory_profile=PATH                               # Write memory usage at phase boundaries
--memory_profile_stable_heap_parameters=<int,int>   # Configure stable heap computation (default: 1,0)
--heap_dump_on_oom                                  # Dump heap on OOM for diagnosis
--discard_analysis_cache                            # Free analysis cache during execution (~10% savings)
--nokeep_state_after_build                          # Discard all state post-build
--notrack_incremental_state                         # No dependency graph edges stored
--experimental_enable_skyfocus                      # Focus on working set for memory reduction
--experimental_working_set=PATH,...                  # Directories in Skyfocus working set
--experimental_skyfocus_dump_post_gc_stats           # Show memory reduction stats
--skyframe_high_water_mark_threshold=<0-100>        # Trigger cleanup when heap exceeds % (default: 85)
--skyframe_high_water_mark_full_gc_drops_per_invocation=N  # Max cleanup triggers per full GC (default: 10)
--skyframe_high_water_mark_minor_gc_drops_per_invocation=N # Max cleanup triggers per minor GC (default: 10)
--heuristically_drop_nodes                          # Drop FileState nodes after use
--gc_churning_threshold=<0-100>                     # % wall time in full GC before OOM (default: 100)
--gc_thrashing_threshold=<0-100>                    # Memory pressure detection threshold (default: 100)
--gc_thrashing_limits=<period:count>                # GC rate limits (default: 1s:2,20s:3,1m:5)
--experimental_remote_discard_merkle_trees           # Discard Merkle trees after use (default: true)
--shutdown --iff_heap_size_greater_than=N            # Conditional server restart for memory leaks
```

## Caching

```
--disk_cache=PATH                                   # Local disk cache path
--experimental_disk_cache_gc_max_size=SIZE           # Max disk cache size (e.g., 10G)
--experimental_disk_cache_gc_max_age=DURATION        # Max entry age (e.g., 14d)
--experimental_disk_cache_gc_idle_delay=DURATION     # Idle time before GC (default: 5m)
--remote_cache=URI                                  # Remote cache URL (http, https, grpc, grpcs, unix)
--remote_upload_local_results={true,false}           # Upload locally-built results to remote cache
--remote_cache_async                                # Background cache uploads (default: true in newer Bazel)
--remote_cache_compression                          # zstd compression for cache blobs
--experimental_remote_cache_chunking                # Content-defined chunking for large blobs
--experimental_remote_cache_ttl=DURATION            # Min guaranteed blob lifetime (default: 3h)
--experimental_remote_cache_lease_extension         # Extend blob leases during builds
--experimental_guard_against_concurrent_changes     # Detect input modification during build
--digest_function=BLAKE3                            # Faster hashing (Bazel 6.4+)
--noallow_analysis_cache_discard                    # Error on analysis cache loss (Bazel 6.4+)
--repository_cache=PATH                             # Shared repo cache across workspaces
--distdir=PATH                                      # Pre-downloaded deps for offline builds
--noremote_accept_cached                            # Disable reading from cache (debugging)
--action_env=VAR                                    # Whitelist env vars in action keys
```

## Remote Execution

```
--remote_download_outputs={minimal,toplevel,all}    # Control artifact downloads
--remote_download_regex=PATTERN                     # Force download for matching paths
--nolegacy_important_outputs                        # Reduce BEP payload size
--remote_build_event_upload=minimal                 # Minimize upload bandwidth
--noremote_upload_local_results                     # Skip uploading locally-built results
--experimental_remote_failure_rate_threshold=<0-100> # Stop remote after failure rate exceeds % (default: 10)
--experimental_remote_failure_window_interval=DURATION # Failure rate window (default: 60s)
--remote_proxy=unix:/path/to/socket                 # Unix socket for local cache server
```

## Execution Strategy

```
--spawn_strategy=STRATEGY                           # Default strategy: local, sandboxed, worker, remote, docker
--strategy=MNEMONIC=STRATEGY                        # Per-action type override
--strategy_regexp=FILTER=STRATEGY                   # Regex-based strategy assignment
--dynamic_local_strategy=STRATEGY,...               # Local fallback chain for dynamic execution
--dynamic_remote_strategy=STRATEGY,...              # Remote fallback chain for dynamic execution
--dynamic_local_execution_delay=MS                  # Delay local start (default: 1000ms)
--experimental_dynamic_local_load_factor=<0-1>      # Reduce local when many remote actions queued
--experimental_dynamic_slow_remote_time=DURATION    # Start local when remote is slow
--debug_spawn_scheduler                             # Debug output for dynamic execution
--reuse_sandbox_directories                         # Retain sandbox dirs between actions
--sandbox_debug                                     # Preserve sandbox dirs for inspection
--worker_max_instances=N                            # Worker pool size per mnemonic (default: 4)
--worker_sandboxing                                 # Enable sandboxing for workers
--worker_quit_after_build                           # Shutdown workers after build
--experimental_worker_multiplex_sandboxing          # Multiplex worker sandboxing
--experimental_local_lockfree_output                # Opt out of sandboxing in dynamic execution
```

## Parallelism & Resources

```
--jobs=N                                            # Concurrent action limit (default: auto)
--local_cpu_resources=N                             # Available CPUs (supports HOST_CPUS-1)
--local_ram_resources=N                             # Available RAM in MB (supports HOST_RAM*.5)
--local_resources=memory=N,cpus=N                   # Combined resource specification
--io_nice_level=<-1 to 7>                           # I/O scheduling priority (Linux, -1=disabled)
--batch_cpu_scheduling                              # Batch CPU scheduling for builds
```

## Build Output

```
--nobuild_runfile_links                             # Skip creating symlink trees
--noexperimental_check_output_files                 # Skip stat'ing outputs after build
--watchfs                                           # Use OS file watching instead of polling
--experimental_remote_merkle_tree_cache             # Cache Merkle tree computations
--use_ijars                                         # Interface JARs for Java (avoid recompilation)
--check_up_to_date                                  # Validate staleness without rebuilding
```

## Build Visibility

```
--subcommands[=pretty_print]                        # Print action command lines before execution
--verbose_failures                                  # Full command line on failure only
--experimental_record_metrics_for_all_mnemonics     # Record metrics for all action types (default: top 20)
```

## Server Lifecycle

```
startup --max_idle_secs=N                           # Idle time before shutdown (default: 10800/3h, 0=never)
--output_base=PATH                                  # Separate output base for different flag sets
--output_user_root=PATH                             # Override default install/output location
```

## Memory Profiling Commands

```bash
bazel info used-heap-size-after-gc                  # Quick heap size check
bazel info committed-heap-size                      # Committed heap
bazel info max-heap-size                            # Max heap
bazel dump --rules                                  # Per-rule memory usage
bazel dump --skylark_memory                         # Starlark memory analysis (use with pprof)
bazel dump --skyframe=deps                          # Skyframe graph dump (small builds only)
```

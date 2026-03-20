# Profiling & Debugging Workflows

Step-by-step workflows for diagnosing and fixing Bazel performance problems.

---

## Workflow: "Why Is My Build Slow?"

### Step 1: Generate a Detailed Profile

```bash
bazel build --profile=profile.gz --noslim_profile //target
```

Profiles are also auto-generated at `$(bazel info output_base)/command.profile.gz`.

### Step 2: View the Profile

- **chrome://tracing**: Load `.profile.gz` directly. Keys: `1`=select, `2`=pan, `3`=zoom, `4`=timing
- **Perfetto UI** (ui.perfetto.dev): Modern alternative
- **Bazel Invocation Analyzer**: CLI or web at analyzer.engflow.com -- prints optimization suggestions
- **jq**: Extract specific data: `zcat profile.gz | jq '.traceEvents | .[] | select(.name == "sandbox.createFileSystem") | .dur'`

### Step 3: Interpret the Profile

Key rows to examine:

| Row | What It Shows |
|-----|--------------|
| `action count` | Concurrent actions over time (should reach `--jobs` value) |
| `CPU usage (Bazel)` | Per-second CPU utilization |
| `Critical Path` | Actions on the critical path |
| `Main Thread` | High-level phases: Launch Blaze, evaluateTargetPatterns, runAnalysisPhase |
| `Garbage Collector` | Minor and major GC pause events |

### Step 4: Identify the Bottleneck Type

| Observation | Bottleneck | Next Step |
|-------------|-----------|-----------|
| Slow `runAnalysisPhase` | Rule implementation | Profile Starlark with `--starlark_cpu_profile` |
| One slow action on critical path | Action design | Split action or reduce its deps |
| Low action concurrency | Parallelism | Finer-grained targets |
| Heavy GC | Memory | Increase `-Xmx` or use Skyfocus |
| High `REMOTE_SETUP`/`FETCH` | Infrastructure | Network proximity, compression |

---

## Workflow: "Why Did This Action Re-Run?"

### Quick: Use --explain

```bash
bazel build --explain=explain.log --verbose_explanations //target
cat explain.log
```

Logs reasons like: "input changed", "command changed", "environment variable changed".

### Deep: Execution Log Comparison

```bash
# Run 1
bazel build //target --execution_log_compact_file=/tmp/exec1.log

# Run 2 (after change, or on different machine)
bazel build //target --execution_log_compact_file=/tmp/exec2.log

# Convert to text
bazel run //src/tools/execlog:parser -- --log_path=/tmp/exec1.log > /tmp/exec1.txt
bazel run //src/tools/execlog:parser -- --log_path=/tmp/exec2.log > /tmp/exec2.txt

# Diff to find discrepancies
diff /tmp/exec1.txt /tmp/exec2.txt
```

Three formats available (compact is recommended -- smallest files):
- `--execution_log_compact_file=PATH` (recommended)
- `--execution_log_binary_file=PATH`
- `--execution_log_json_file=PATH`

Check that actions have `cacheable=true` in the log; if not, the rule is tagged `no-cache`.

### Structural: aquery_differ

Compare action graphs between two builds:

```bash
bazel aquery --output=proto //target > /tmp/before.proto
# ... make changes ...
bazel aquery --output=proto //target > /tmp/after.proto

bazel run //tools/aquery_differ -- \
  --before=/tmp/before.proto \
  --after=/tmp/after.proto \
  --input_type=proto \
  --attrs=cmdline \
  --attrs=inputs
```

Shows added/removed actions and unified diffs for changed commands or inputs.

---

## Workflow: "What Actions Does My Target Produce?"

```bash
# All actions for a target
bazel aquery '//my:target'

# Including dependencies
bazel aquery 'deps(//my:target)'

# Filter by input pattern
bazel aquery 'inputs(".*cpp", deps(//target))'

# Filter by action type (mnemonic)
bazel aquery 'mnemonic("BunRun", deps(//my:target))'

# Dump from Skyframe in-memory cache (no re-analysis)
bazel aquery --output=proto --skyframe_state

# Summary view
bazel aquery --output=summary //target
```

Output formats: `--output=text` (default), `--output=proto`, `--output=textproto`, `--output=jsonproto`, `--output=commands`.

Key options:
- `--include_commandline` (default: true) -- show action command lines
- `--include_param_files` (default: false) -- include param file contents
- `--skyframe_state` -- dump from cache without re-running analysis

---

## Workflow: "How Much Memory Is Bazel Using?"

```bash
# Quick check
bazel info used-heap-size-after-gc

# Detailed memory profile
bazel build --memory_profile=memory.log //target

# Per-rule memory breakdown
bazel dump --rules

# Starlark heap analysis (use with pprof)
bazel dump --skylark_memory

# Worker memory (from BEP)
# Look for WorkerMetrics.WorkerStats.worker_memory_in_kb
```

---

## Workflow: "What Is the Dependency Graph?"

```bash
# Target graph (loading phase, fast, no select() resolution)
bazel query 'deps(//my:target)' --output=graph | dot -Tpng > deps.png

# Configured target graph (analysis phase, resolves select())
bazel cquery 'deps(//my:target)'

# With Starlark output for custom inspection
bazel cquery 'deps(//my:target)' --output=starlark --starlark:expr='providers(target)'

# Reverse dependencies
bazel query 'rdeps(//..., //my:target)'

# Configuration transitions
bazel cquery 'deps(//my:target)' --transitions=LITE
```

---

## Workflow: "How Do Builds Compare Across Commits?"

### Using bazel-bench

```bash
bazel-bench --project_source=/path/to/repo \
  --commits=abc123,def456 \
  --bazel_binaries=/path/to/bazel \
  -- build //target
```

Tracks: wall time, CPU time, system time, heap size retention.

### Manual Before/After

```bash
# Baseline
bazel clean && bazel build //target --profile=/tmp/before.profile.gz

# After optimization
bazel clean && bazel build //target --profile=/tmp/after.profile.gz

# Compare visually in chrome://tracing
# Compare critical path times, action counts, cache hit rates
```

Best practices:
- Run on **dedicated physical machines** (not VMs or shared CI)
- Use **multiple runs** and take the median
- Control variables: same flags, Bazel version, machine, OS
- Use **execution graph log drag analysis** to predict impact before making changes

---

## Critical Path Analysis

The critical path is the longest sequential chain of actions that determines minimum build time.

### How to Find It
1. **JSON trace profile**: Dedicated "Critical Path" row
2. **Build output**: Bazel prints critical path summary at end of build
3. **Execution graph log** (Bazel 6.0+):
   ```bash
   bazel build //target \
     --experimental_execution_graph_log \
     --experimental_execution_graph_log_dep_type=all
   ```

### Drag Analysis
"Drag" = time potentially saved by removing a node from the execution graph. Use this to predict optimization impact before making changes.

### Optimization Strategies
- Split large critical-path actions into smaller parallel tasks
- Reduce transitive dependencies of critical-path actions
- Cache actions (remote cache) to eliminate them entirely
- Investigate non-processing overhead (REMOTE_SETUP, FETCH)

---

## Starlark CPU Profiling

For analysis-phase bottlenecks:

```bash
# Profile Starlark thread CPU usage
bazel build --starlark_cpu_profile=/tmp/starlark.pprof --nobuild //target

# View with pprof
go tool pprof -http=:8080 /tmp/starlark.pprof
```

Use `--nobuild` to isolate analysis-phase cost (no execution phase).

---

## Third-Party Tools

### BuildBuddy
- **Timing Profile Tab**: Visual breakdown of analysis and execution phases
- **Cache Tab**: Upload/download volumes, cache miss counts; `AC Misses` filter for root cause
- **Trends Page**: Build time percentiles, cache hit rates over time
- **Drilldown Tab**: Common characteristics of slow vs fast builds

### EngFlow Bazel Invocation Analyzer
- Open-source CLI + web at analyzer.engflow.com
- Analyzes JSON trace profiles and suggests improvements

### bazel-bench
- Compare performance across git commits or Bazel versions
- Best run on dedicated physical machines for consistent results

---

## Build Event Protocol (BEP)

Capture structured build data for dashboards and analysis:

```bash
# JSON output
bazel build --build_event_json_file=bep.json //target

# Binary protobuf
bazel build --build_event_binary_file=bep.pb //target
```

Key metrics available via BEP:

| Metric | Description |
|--------|-------------|
| `PackageMetrics.packages_loaded` | Packages loaded |
| `TargetMetrics.targets_configured` | Targets configured |
| `ActionSummary.actions_created` | Total actions created |
| `ActionSummary.actions_executed` | Actions actually executed |
| `ActionData` | Top action types by count (top 20 default) |
| `CumulativeMetrics.num_analyses` | 1=clean build, >1=incremental |
| `MemoryMetrics.peak_post_gc_heap_size` | Peak heap (requires `--memory_profile`) |
| `WorkerMetrics.WorkerStats.worker_memory_in_kb` | Worker memory |
| `NetworkMetrics.SystemNetworkStats` | Network I/O (requires `--experimental_collect_system_network_usage`) |

Use `--experimental_record_metrics_for_all_mnemonics` for comprehensive action type coverage beyond the default top 20.

---

## Skyframe Debugging

Skyframe is Bazel's core evaluation framework -- a DAG of computations.

### Key Concepts
- **SkyKey**: Identifier for a computation node
- **SkyValue**: Result of a computation
- **SkyFunction**: Computes a SkyValue; requests dependencies via `getValue()`
- Functions **restart from scratch** when dependencies are unavailable -- batch dependency declarations to minimize restarts

### Inspecting the Graph

```bash
# Dump action graph from Skyframe cache
bazel aquery --output=proto --skyframe_state

# Query specific outputs
bazel aquery --output=proto --skyframe_state 'outputs("foo.out")'

# Full Skyframe dump (small builds only)
bazel dump --skyframe=deps
```

### In Trace Profiles
- `skyframe evaluator` sections in analysis phase
- `skyframe evaluator execution-X` sections in execution phase
- `package creation` events show external dependency resolution

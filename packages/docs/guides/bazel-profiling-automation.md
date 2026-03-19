# Bazel Profiling Automation (Future Plan)

Follow-up to one-off profiling via `scripts/bench.py`. Goal: automated, recurring Bazel build benchmarks with historical tracking.

## Architecture

```
Buildkite Pipeline (on-demand or weekly)
  → Launch dedicated EC2 spot instance (i4i.32xlarge)
  → Run bench_remote_profile.py
  → Upload results to SeaweedFS S3 (bazel-bench/ bucket)
  → Post summary to Slack/Buildkite annotation
  → Terminate instance
```

## Implementation Steps

1. **Add SeaweedFS bucket**: `bazel-bench` in `packages/homelab/src/tofu/seaweedfs/` with 90-day lifecycle
2. **Buildkite pipeline**: New pipeline in `.buildkite/` triggered by:
   - Manual trigger (button in Buildkite UI)
   - Weekly cron (Sunday night)
   - Tag matching `bench/*`
3. **Results storage**: Upload to `s3://bazel-bench/{date}/{git-sha}/` with:
   - `timings.csv`
   - `build-info.txt`
   - Profile `.gz` files
   - BEP `.pb` files
4. **Trend dashboard**: Python script that fetches historical `timings.csv` files and generates a trend chart (wall time over time for each category)
5. **Regression detection**: Compare latest run against rolling 4-week average. Alert if uncached build time increases by >10%

## BEP Metrics to Track

From Build Event Protocol files, extract and store:
- `ActionSummary.actions_created` / `actions_executed`
- `PackageMetrics.packages_loaded`
- `TargetMetrics.targets_configured`
- `MemoryMetrics.peak_post_gc_heap_size`
- Per-mnemonic action counts and timing

## Prerequisites

- Spot vCPU quota >= 128 in the CI AWS account
- IAM role for Buildkite agents to launch/terminate EC2 instances
- SeaweedFS bucket for results

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Remote profiling script for Bazel benchmarking.

Runs on the EC2 instance inside tmux. Executes the full build matrix:
1. Analysis-only (1x)
2. Uncached builds (3x)
3. Cached builds — cold analysis, warm disk cache (3x)
4. Warm incremental — no clean (1x)

Results written incrementally to /mnt/nvme/results/.
"""

from __future__ import annotations

import csv
import os
import platform
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_DIR = Path("/mnt/nvme/repo/monorepo")
RESULTS_DIR = Path("/mnt/nvme/results")
PROFILES_DIR = RESULTS_DIR / "profiles"
BEP_DIR = RESULTS_DIR / "bep"
DISK_CACHE_BASE = Path("/mnt/nvme/bazel-disk-cache")
BAZELRC_ARGS = ["--bazelrc=.bazelrc", "--bazelrc=.bazelrc.bench"]
TIMINGS_CSV = RESULTS_DIR / "timings.csv"
BUILD_INFO = RESULTS_DIR / "build-info.txt"


@dataclass
class RunResult:
    category: str
    run_number: int
    wall_seconds: float
    exit_code: int


def run_cmd(cmd: str, check: bool = True) -> subprocess.CompletedProcess:
    print(f"\n  $ {cmd}", flush=True)
    return subprocess.run(cmd, shell=True, check=check, cwd=REPO_DIR)


def bazel(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    cmd = f"bazel {' '.join(BAZELRC_ARGS)} {' '.join(args)}"
    return run_cmd(cmd, check=check)


def timed_bazel(category: str, run_number: int, *args: str) -> RunResult:
    """Run a bazel command and measure wall time."""
    print(f"\n{'='*60}")
    print(f"  {category} (run {run_number})")
    print(f"  {datetime.now(timezone.utc).isoformat()}")
    print(f"{'='*60}", flush=True)

    start = time.monotonic()
    result = bazel(*args, check=False)
    elapsed = time.monotonic() - start

    run_result = RunResult(
        category=category,
        run_number=run_number,
        wall_seconds=elapsed,
        exit_code=result.returncode,
    )

    status = "OK" if result.returncode == 0 else f"FAILED (exit {result.returncode})"
    print(f"\n  {category} run {run_number}: {elapsed:.1f}s — {status}", flush=True)

    # Append to CSV incrementally
    append_timing(run_result)
    return run_result


def append_timing(result: RunResult) -> None:
    """Append a timing row to the CSV file."""
    write_header = not TIMINGS_CSV.exists()
    with TIMINGS_CSV.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["category", "run", "wall_seconds", "exit_code", "timestamp"])
        if write_header:
            writer.writeheader()
        writer.writerow({
            "category": result.category,
            "run": result.run_number,
            "wall_seconds": f"{result.wall_seconds:.1f}",
            "exit_code": result.exit_code,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


def write_build_info() -> None:
    """Capture system and build environment info."""
    info_lines = [
        f"timestamp: {datetime.now(timezone.utc).isoformat()}",
        f"hostname: {platform.node()}",
        f"platform: {platform.platform()}",
    ]

    # CPU info
    try:
        cpu_info = Path("/proc/cpuinfo").read_text()
        model_names = [line.split(":")[1].strip() for line in cpu_info.splitlines() if "model name" in line]
        if model_names:
            info_lines.append(f"cpu_model: {model_names[0]}")
            info_lines.append(f"cpu_count: {len(model_names)}")
    except Exception:
        info_lines.append(f"cpu_count: {os.cpu_count()}")

    # Memory
    try:
        meminfo = Path("/proc/meminfo").read_text()
        for line in meminfo.splitlines():
            if line.startswith("MemTotal:"):
                info_lines.append(f"memory: {line.split(':')[1].strip()}")
                break
    except Exception:
        pass

    # Git SHA
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=REPO_DIR
        ).stdout.strip()
        info_lines.append(f"git_sha: {sha}")
    except Exception:
        pass

    # Bazel version
    try:
        ver = subprocess.run(
            ["bazel", "--version"], capture_output=True, text=True, cwd=REPO_DIR
        ).stdout.strip()
        info_lines.append(f"bazel_version: {ver}")
    except Exception:
        pass

    # Instance type from EC2 metadata
    try:
        import urllib.request
        token = urllib.request.urlopen(
            urllib.request.Request(
                "http://169.254.169.254/latest/api/token",
                headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
                method="PUT",
            ),
            timeout=2,
        ).read().decode()
        instance_type = urllib.request.urlopen(
            urllib.request.Request(
                "http://169.254.169.254/latest/meta-data/instance-type",
                headers={"X-aws-ec2-metadata-token": token},
            ),
            timeout=2,
        ).read().decode()
        info_lines.append(f"instance_type: {instance_type}")
    except Exception:
        pass

    BUILD_INFO.write_text("\n".join(info_lines) + "\n")
    print(f"Build info written to {BUILD_INFO}")
    for line in info_lines:
        print(f"  {line}")


def common_build_flags(profile_name: str) -> list[str]:
    """Return common profiling flags for a build run."""
    return [
        f"--profile={PROFILES_DIR / profile_name}",
        "--experimental_record_metrics_for_all_mnemonics",
        "--experimental_collect_load_average_in_profiler",
        "--experimental_profile_cpu_usage",
    ]


def run_analysis_only() -> None:
    """Run analysis phase only (no execution)."""
    print("\n" + "#" * 60)
    print("# PHASE 1: Analysis-only")
    print("#" * 60)

    bazel("clean", "--expunge")
    timed_bazel("analysis-only", 1,
        "build", "//...", "--nobuild",
        f"--profile={PROFILES_DIR / 'analysis-only.profile.gz'}",
        f"--starlark_cpu_profile={PROFILES_DIR / 'starlark-analysis.pprof.gz'}",
    )


def run_uncached(num_runs: int = 3) -> None:
    """Run uncached builds (fresh disk cache each time)."""
    print("\n" + "#" * 60)
    print(f"# PHASE 2: Uncached builds ({num_runs}x)")
    print("#" * 60)

    for i in range(1, num_runs + 1):
        cache_dir = DISK_CACHE_BASE / f"uncached-{i}"
        cache_dir.mkdir(parents=True, exist_ok=True)

        # Run 1 gets --expunge (cold JVM), runs 2+ get regular clean (warm JVM)
        if i == 1:
            bazel("clean", "--expunge")
        else:
            bazel("clean")

        timed_bazel(f"uncached", i,
            "build", "//...",
            f"--disk_cache={cache_dir}",
            *common_build_flags(f"uncached-{i}.profile.gz"),
            f"--build_event_binary_file={BEP_DIR / f'uncached-{i}.pb'}",
            f"--starlark_cpu_profile={PROFILES_DIR / f'starlark-uncached-{i}.pprof.gz'}",
        )


def run_cached(num_runs: int = 3) -> None:
    """Run cached builds (cold analysis, warm disk cache from uncached-1)."""
    print("\n" + "#" * 60)
    print(f"# PHASE 3: Cached builds ({num_runs}x)")
    print("#" * 60)

    # Reuse disk cache from uncached run 1
    cache_dir = DISK_CACHE_BASE / "uncached-1"
    if not cache_dir.exists():
        print(f"WARNING: {cache_dir} does not exist. Cached runs will be effectively uncached.")

    for i in range(1, num_runs + 1):
        # bazel clean clears analysis cache but NOT disk cache
        bazel("clean")

        timed_bazel(f"cached", i,
            "build", "//...",
            f"--disk_cache={cache_dir}",
            *common_build_flags(f"cached-{i}.profile.gz"),
            f"--build_event_binary_file={BEP_DIR / f'cached-{i}.pb'}",
        )


def run_warm_incremental() -> None:
    """Run a warm incremental build (no clean at all)."""
    print("\n" + "#" * 60)
    print("# PHASE 4: Warm incremental (no clean)")
    print("#" * 60)

    cache_dir = DISK_CACHE_BASE / "uncached-1"
    timed_bazel("warm-incremental", 1,
        "build", "//...",
        f"--disk_cache={cache_dir}",
        *common_build_flags("warm-incremental.profile.gz"),
    )


def print_summary() -> None:
    """Print a summary of all timings."""
    if not TIMINGS_CSV.exists():
        return

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    with TIMINGS_CSV.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            status = "OK" if row["exit_code"] == "0" else f"FAILED"
            print(f"  {row['category']:20s}  run {row['run']}  {float(row['wall_seconds']):8.1f}s  {status}")

    print("=" * 60)


def main() -> None:
    print("=" * 60)
    print("Bazel Bench - Remote Profiling")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    # Ensure directories exist
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    BEP_DIR.mkdir(parents=True, exist_ok=True)

    write_build_info()

    total_start = time.monotonic()

    run_analysis_only()
    run_uncached(3)
    run_cached(3)
    run_warm_incremental()

    total_elapsed = time.monotonic() - total_start

    print_summary()
    print(f"\nTotal profiling time: {total_elapsed:.1f}s ({total_elapsed/3600:.1f} hours)")
    print(f"Results in: {RESULTS_DIR}")


if __name__ == "__main__":
    main()

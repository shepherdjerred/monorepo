#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Remote setup script for Bazel benchmarking.

Runs on the EC2 instance to:
1. Set up NVMe RAID0 with XFS
2. Tune kernel for benchmarking
3. Install system dependencies
4. Clone the monorepo

This script must be run as root (or with sudo).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

NVME_MOUNT = "/mnt/nvme"
REPO_URL = "https://github.com/shepherdjerred/monorepo.git"
REPO_DIR = f"{NVME_MOUNT}/repo/monorepo"


def run(cmd: str, check: bool = True) -> subprocess.CompletedProcess:
    print(f"  $ {cmd}", flush=True)
    return subprocess.run(cmd, shell=True, check=check)


def discover_nvme_instance_store() -> list[str]:
    """Find NVMe instance store devices (not EBS)."""
    devices = []
    for dev_path in sorted(Path("/dev").glob("nvme*n1")):
        dev_name = dev_path.name
        model_path = Path(f"/sys/block/{dev_name}/device/model")
        if model_path.exists():
            model = model_path.read_text().strip()
            if "Instance Storage" in model:
                devices.append(str(dev_path))
                print(f"  Found instance store: {dev_path} ({model})")
    return devices


def setup_nvme_raid0() -> None:
    """Create RAID0 across all NVMe instance store drives, format with XFS, mount."""
    print("\n=== NVMe RAID0 Setup ===")
    devices = discover_nvme_instance_store()
    if not devices:
        print("ERROR: No NVMe instance store devices found!")
        sys.exit(1)

    print(f"Creating RAID0 across {len(devices)} devices...")
    dev_list = " ".join(devices)
    run(f"mdadm --create /dev/md0 --level=0 --raid-devices={len(devices)} "
        f"--chunk=256 --run --force {dev_list}")

    print("Formatting with XFS (agcount=32 for parallel metadata)...")
    run("mkfs.xfs -f -K -d agcount=32 /dev/md0")

    print(f"Mounting at {NVME_MOUNT}...")
    Path(NVME_MOUNT).mkdir(parents=True, exist_ok=True)
    run(f"mount -o noatime,allocsize=64k /dev/md0 {NVME_MOUNT}")

    # Create directory structure
    for d in ["repo", "bazel-output-base", "bazel-disk-cache", "results", "results/profiles", "results/bep"]:
        Path(f"{NVME_MOUNT}/{d}").mkdir(parents=True, exist_ok=True)

    # Make writable by ubuntu user
    run(f"chown -R ubuntu:ubuntu {NVME_MOUNT}")
    print("NVMe RAID0 ready.")


def tune_kernel() -> None:
    """Apply kernel tuning for benchmark consistency."""
    print("\n=== Kernel Tuning ===")
    sysctls = {
        "vm.swappiness": "1",
        "fs.inotify.max_user_watches": "1048576",
        "fs.inotify.max_user_instances": "8192",
        "vm.max_map_count": "2097152",
        "vm.dirty_ratio": "5",
        "vm.dirty_background_ratio": "2",
        "fs.aio-max-nr": "1048576",
    }
    for key, value in sysctls.items():
        run(f"sysctl -w {key}={value}")

    # Disable transparent huge pages
    for path in [
        "/sys/kernel/mm/transparent_hugepage/enabled",
        "/sys/kernel/mm/transparent_hugepage/defrag",
    ]:
        if Path(path).exists():
            Path(path).write_text("never")
            print(f"  Set {path} = never")

    # CPU governor: performance
    governors = list(Path("/sys/devices/system/cpu").glob("cpu*/cpufreq/scaling_governor"))
    if governors:
        for gov in governors:
            try:
                gov.write_text("performance")
            except OSError:
                pass
        print(f"  Set {len(governors)} CPUs to performance governor")
    else:
        print("  No CPU frequency scaling available (EC2 handles this)")

    # File descriptor limits
    run("ulimit -n 1048576", check=False)

    print("Kernel tuning applied.")


def install_deps() -> None:
    """Install system packages needed for Bazel builds."""
    print("\n=== Installing System Dependencies ===")
    run("apt-get update -qq")
    run(
        "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "
        "build-essential git curl unzip pkg-config libssl-dev "
        "ca-certificates mdadm xfsprogs tmux"
    )
    print("System dependencies installed.")


def clone_repo() -> None:
    """Clone the monorepo to NVMe."""
    print("\n=== Cloning Repository ===")
    if Path(REPO_DIR).exists():
        print(f"  {REPO_DIR} already exists, skipping clone")
        return
    run(f"sudo -u ubuntu git clone {REPO_URL} {REPO_DIR}")
    print(f"Cloned to {REPO_DIR}")


def main() -> None:
    if os.geteuid() != 0:
        print("This script must be run as root. Re-running with sudo...")
        os.execvp("sudo", ["sudo", sys.executable] + sys.argv)

    print("=" * 60)
    print("Bazel Bench - Remote Setup")
    print("=" * 60)

    install_deps()
    setup_nvme_raid0()
    tune_kernel()
    clone_repo()

    print("\n" + "=" * 60)
    print("Setup complete!")
    print(f"  NVMe RAID0: {NVME_MOUNT}")
    print(f"  Repo: {REPO_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()

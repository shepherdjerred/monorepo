#!/usr/bin/env python3
"""
Watch ZFS resilver progress.
Usage: uv run watch-resilver.py [--interval SECONDS]
"""
# /// script
# requires-python = ">=3.11"
# ///

import subprocess
import time
import sys
import re
from datetime import datetime


def get_zpool_status() -> str:
    """Get zpool status via kubectl exec."""
    cmd = [
        "kubectl", "exec", "-n", "prometheus", "zfs-zpool-collector-9z5r7", "--",
        "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
        "zpool", "status", "zfspv-pool-hdd"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def parse_resilver_progress(status: str) -> dict:
    """Parse resilver progress from zpool status output."""
    info = {
        "state": "UNKNOWN",
        "resilvering": False,
        "scanned": None,
        "issued": None,
        "total": None,
        "percent": None,
        "speed": None,
        "eta": None,
        "resilvered": None,
    }

    # Get pool state
    state_match = re.search(r"state:\s+(\w+)", status)
    if state_match:
        info["state"] = state_match.group(1)

    # Check if resilvering
    if "resilver in progress" in status.lower():
        info["resilvering"] = True

        # Parse progress line like:
        # 1.11G / 8.70T scanned at 26.4M/s, 0B / 8.70T issued
        scan_match = re.search(
            r"([\d.]+[KMGTP]?B?) / ([\d.]+[KMGTP]?B?) scanned.*?([\d.]+[KMGTP]?/s)?",
            status
        )
        if scan_match:
            info["scanned"] = scan_match.group(1)
            info["total"] = scan_match.group(2)
            if scan_match.group(3):
                info["speed"] = scan_match.group(3)

        # Parse issued
        issued_match = re.search(
            r"([\d.]+[KMGTP]?B?) / ([\d.]+[KMGTP]?B?) issued",
            status
        )
        if issued_match:
            info["issued"] = issued_match.group(1)

        # Parse percent and ETA
        # 20K resilvered, 0.00% done, no estimated completion time
        # OR: 1.23T resilvered, 14.5% done, 01:23:45 to go
        progress_match = re.search(
            r"([\d.]+[KMGTP]?B?) resilvered,\s+([\d.]+)% done(?:,\s+(.+?))?$",
            status,
            re.MULTILINE
        )
        if progress_match:
            info["resilvered"] = progress_match.group(1)
            info["percent"] = float(progress_match.group(2))
            if progress_match.group(3):
                eta = progress_match.group(3).strip()
                if eta != "no estimated completion time":
                    info["eta"] = eta

    elif "resilvered" in status.lower() and "errors" in status.lower():
        # Resilver complete
        info["resilvering"] = False
        complete_match = re.search(
            r"resilvered ([\d.]+[KMGTP]?B?) in (\d+:\d+:\d+)",
            status
        )
        if complete_match:
            info["resilvered"] = complete_match.group(1)
            info["eta"] = f"COMPLETE in {complete_match.group(2)}"
            info["percent"] = 100.0

    return info


def print_progress(info: dict, raw_status: str):
    """Print formatted progress."""
    # Clear screen
    print("\033[2J\033[H", end="")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"=== ZFS Resilver Monitor === ({now})")
    print()

    if info["resilvering"]:
        print(f"State:      {info['state']} (resilvering)")
        print(f"Progress:   {info['percent']:.2f}%" if info['percent'] else "Progress:   calculating...")
        print(f"Scanned:    {info['scanned']} / {info['total']}" if info['scanned'] else "")
        print(f"Issued:     {info['issued']} / {info['total']}" if info['issued'] else "")
        print(f"Resilvered: {info['resilvered']}" if info['resilvered'] else "")
        print(f"Speed:      {info['speed']}" if info['speed'] else "")
        print(f"ETA:        {info['eta']}" if info['eta'] else "ETA:        calculating...")

        # Progress bar
        if info['percent'] is not None:
            bar_width = 50
            filled = int(bar_width * info['percent'] / 100)
            bar = "█" * filled + "░" * (bar_width - filled)
            print(f"\n[{bar}] {info['percent']:.1f}%")
    else:
        if info['percent'] == 100.0:
            print("✅ RESILVER COMPLETE!")
            print(f"   Resilvered: {info['resilvered']}")
            print(f"   Duration:   {info['eta']}")
        else:
            print(f"State: {info['state']}")
            print("No resilver in progress.")

    print("\n" + "=" * 50)
    print("Press Ctrl+C to exit")

    # Show drive status
    print("\nDrive Status:")
    for line in raw_status.split('\n'):
        if any(x in line for x in ['sda', 'sdb', 'sdc', 'sdd', 'sde', 'sdf', 'replacing', 'raidz']):
            print(f"  {line.strip()}")


def main():
    interval = 5  # Default 5 seconds

    # Parse args
    if "--interval" in sys.argv:
        idx = sys.argv.index("--interval")
        if idx + 1 < len(sys.argv):
            interval = int(sys.argv[idx + 1])

    print(f"Monitoring resilver progress (refresh every {interval}s)...")
    print("Press Ctrl+C to exit\n")

    try:
        while True:
            status = get_zpool_status()
            info = parse_resilver_progress(status)
            print_progress(info, status)

            # Exit if complete
            if not info["resilvering"] and info["percent"] == 100.0:
                print("\nResilver finished! Exiting in 10 seconds...")
                time.sleep(10)
                break

            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped.")


if __name__ == "__main__":
    main()

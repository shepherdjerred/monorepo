"""Quality gate: ratchet check + compliance check.

Usage: uv run -m ci.quality_gate

Runs:
  1. Quality ratchet check (suppression counts)
  2. Compliance check (required scripts and config per package)
"""

from __future__ import annotations

import sys

from ci.lib import compliance, quality


def main() -> None:
    print("--- Quality ratchet check ---", flush=True)
    passed, msg = quality.check()
    print(msg, flush=True)
    if not passed:
        print("Quality ratchet failed!", flush=True)
        sys.exit(1)

    print("\n--- Compliance check ---", flush=True)
    passed, msg = compliance.check()
    print(msg, flush=True)
    if not passed:
        print("Compliance check failed!", flush=True)
        sys.exit(1)

    print("\nQuality gate passed", flush=True)


if __name__ == "__main__":
    main()

"""Validate the genuine demonstration export before preparing a pilot review."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from data import Dataset


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    dataset = Dataset.load(args.dataset)
    print(json.dumps({"dataset_sha256": dataset.fingerprint}, allow_nan=False))


if __name__ == "__main__":
    main()

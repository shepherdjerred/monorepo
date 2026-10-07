"""Read complete bot-only schema-3 captures for the blind preference pack."""

from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path

from dataset import read


def inspect(path: Path) -> dict[str, object]:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        header = stream.readline().rstrip("\n").split("\t")
        stream.seek(0)
        recording = read(stream)
    if (
        header[3] != "training-yard"
        or re.fullmatch("[a-f0-9]{64}", header[4]) is None
        or len(recording.roster) != 2
        or recording.inputs
        or sorted(recording.roster.values()) != [("BLUE", "trooper", True), ("RED", "trooper", True)]
    ):
        raise ValueError("preference requires a complete native training-yard Trooper duel")
    if any(sum(actor == key[0] for key in recording.frames) < 2 for actor in recording.roster):
        raise ValueError("preference capture lacks native fighter frames")
    if recording.reason not in ("LAST_TEAM_STANDING", "DRAW", "STOPPED") or (recording.winner != "-") != (
        recording.reason == "LAST_TEAM_STANDING"
    ):
        raise ValueError("preference capture has an invalid native outcome")
    return {"match": recording.match, "map_sha256": header[4], "winner": recording.winner, "reason": recording.reason}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recordings", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps([inspect(path) for path in args.recordings], allow_nan=False))


if __name__ == "__main__":
    main()

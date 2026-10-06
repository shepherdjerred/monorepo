"""Verified restoration exports contain native terrain and identity data, never server configuration."""

import hashlib
import json
import re
from pathlib import Path, PurePosixPath

DIMENSIONS = frozenset(("overworld", "the_nether", "the_end", "settlement", "rustworks",
                        "rwf", "wilds", "peaks", "mining"))
REQUIRED = frozenset(("world/level.dat", "plugins/TheStorm/the-storm.db"))


def selected_files(files: dict[str, str]) -> dict[str, str]:
    """Select every supported native store from the whole-volume hash proof."""
    if not isinstance(files, dict) or not files:
        raise ValueError("Expected a nonempty whole-volume file manifest")
    result = {}
    for name, checksum in files.items():
        if not isinstance(name, str) or not isinstance(checksum, str):
            raise ValueError("Whole-volume manifest contains an invalid path or checksum")
        relative = PurePosixPath(name)
        if (relative.is_absolute() or ".." in relative.parts or str(relative) != name
                or not re.fullmatch(r"[a-f0-9]{64}", checksum)):
            raise ValueError("Whole-volume manifest contains an invalid path or checksum")
        if name in ("world/level.dat", "world/level.dat_old", "world/uid.dat",
                    "plugins/TheStorm/the-storm.db", "plugins/TheStorm/the-storm.db-wal",
                    "plugins/TheStorm/the-storm.db-shm"):
            result[name] = checksum
            continue
        if re.fullmatch(r"world/data/[a-z0-9_.-]+/[a-z0-9_./-]+\.dat", name):
            result[name] = checksum
            continue
        parts = relative.parts
        if parts[:2] == ("world", "dimensions") and (
                len(parts) < 4 or parts[2] != "minecraft" or parts[3] not in DIMENSIONS):
            raise ValueError("Whole-volume proof contains an unreviewed native dimension")
        if len(parts) < 6 or parts[:3] != ("world", "dimensions", "minecraft") or parts[3] not in DIMENSIONS:
            continue
        if (len(parts) == 6 and parts[4] in ("region", "entities", "poi")
                and re.fullmatch(r"(?:r\.-?\d+\.-?\d+\.mca|c\.-?\d+\.-?\d+\.mcc)", parts[5])):
            result[name] = checksum
        elif parts[4] == "data" and re.fullmatch(r"[a-z0-9_.-]+/[a-z0-9_./-]+\.dat", "/".join(parts[5:])):
            result[name] = checksum
    if not REQUIRED.issubset(result):
        raise ValueError("Whole-volume proof must include the Storm world and identity database")
    return dict(sorted(result.items()))


def whole_proof(path: Path, expected_sha256: str) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ValueError("Whole-volume proof must be a regular file")
    encoded = path.read_bytes()
    if hashlib.sha256(encoded).hexdigest() != expected_sha256:
        raise ValueError("Whole-volume proof changed after verification")
    proof = json.loads(encoded)
    if (proof.get("schemaVersion") != 1 or proof.get("status") != "VERIFIED"
            or not all(proof.get(key) for key in ("requestId", "backupUid", "sourceVolumeUid", "restoredVolumeUid"))
            or proof["sourceVolumeUid"] == proof["restoredVolumeUid"]):
        raise ValueError("Export requires verified independent whole-volume storage identities")
    selected_files(proof.get("files"))
    return proof


def verified_export(receipt: dict) -> dict[str, str]:
    if receipt.get("schemaVersion") != 2 or receipt.get("status") != "VERIFIED_EXPORT":
        raise ValueError("Expected a verified native data export")
    source = whole_proof(Path(receipt["wholeVolumeProofPath"]), receipt["wholeVolumeProofSha256"])
    if any(receipt.get(key) != source[key] for key in
           ("requestId", "backupUid", "sourceVolumeUid", "restoredVolumeUid")):
        raise ValueError("Export and whole-volume proof identify different storage or requests")
    expected = selected_files(source["files"])
    if receipt.get("files") != expected:
        raise ValueError("Export does not contain the complete approved native data selection")
    return expected

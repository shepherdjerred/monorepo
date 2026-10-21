"""Seal the recovered creative terrain against the independent stopped-volume backup."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import creative_install
import restoration_backup
import restoration_files as storage
from restoration_json import JsonObject

LEVEL_SHA256 = "c4ed053dcf7a96cd8865a2634d09fe69fda6b49637856c51347fde17c4b5ac61"
REGIONS_SHA256 = "9b2279c6f39010ac294f42cf693b02ab88559e2d777fbed081d04cbfbd619020"
REGION_COUNT = 110
REGION_BYTES = 225415168
CREATIVE_ENTRY = {
    "version": 1.3,
    "generator": "TheStorm:creative",
    "gamemode": "creative",
    "auto-load": False,
    "adjust-spawn": False,
    "read-only": {"legacy-world-name": "creative", "environment": "NORMAL"},
}


def verify_terrain(root: Path) -> None:
    """Only pinned level metadata and region terrain are imported, never old player files."""
    manifest = storage.files(root)
    if manifest.get("level.dat") != LEVEL_SHA256:
        raise ValueError("Creative level metadata differs from the recovered archive")
    regions = {Path(name).name: checksum for name, checksum in manifest.items() if name.startswith("region/")}
    encoded = "".join(f"{checksum}  {name}\n" for name, checksum in sorted(regions.items()))
    if (
        set(manifest) != {"level.dat", *("region/" + name for name in regions)}
        or len(regions) != REGION_COUNT
        or hashlib.sha256(encoded.encode()).hexdigest() != REGIONS_SHA256
        or sum((root / "region" / name).stat().st_size for name in regions) != REGION_BYTES
    ):
        raise ValueError("Creative region inventory differs from the recovered archive")


def registry(contents: bytes) -> JsonObject:
    # Preparation runs on the operator host with the repository's Bun runtime;
    # the stopped-volume writer remains Python standard-library-only.
    parser = (
        "const value = Bun.YAML.parse(await Bun.stdin.text());"
        "console.log(JSON.stringify(value, (_key, item) => {"
        'if (item === undefined || (typeof item === "number" && !Number.isFinite(item))) '
        'throw new Error("World registry contains a non-JSON value"); return item; }));'
    )
    result = subprocess.run(["bun", "-e", parser], input=contents, capture_output=True, check=True, timeout=30)
    return JsonObject.parse(result.stdout)


def plan(staging: Path, control: JsonObject, candidate: Path) -> JsonObject:
    if staging.is_symlink() or candidate.is_symlink() or not candidate.is_file():
        raise ValueError("Creative preparation requires regular staging and candidate files")
    restore = control.object("restore")
    if (
        control.get("phase") != "LEASED_OFFLINE"
        or control.get("admissionProbes") != "UPDATE_SCALE_AND_DELETE_DENIED"
        or restore.get("phase") != "Completed"
        or restore.get("byteVerification") != "VERIFIED"
    ):
        raise ValueError(
            "Creative installation requires its stopped lease and verified independent whole-volume restore"
        )
    proof = restoration_backup.whole_proof(Path(restore.string("proofPath")), restore.string("proofSha256"))
    bindings = {
        "requestId": control.string("requestId"),
        "backupUid": control.object("backup").string("uid"),
        "sourceVolumeUid": control.string("volumeUid"),
        "restoredVolumeUid": restore.string("volumeUid"),
    }
    if any(proof.get(key) != value for key, value in bindings.items()):
        raise ValueError("Creative backup proof belongs to another request or volume")
    original = proof.strings("files")
    before = staging / "worlds-before.yml"
    payload = staging / "payload"
    if (
        before.is_symlink()
        or not before.is_file()
        or storage.digest(before) != original.get(creative_install.REGISTRY)
        or any(
            name.startswith("creative/") or name.startswith("world/dimensions/minecraft/creative/") for name in original
        )
    ):
        raise ValueError("Creative registry export or original world inventory differs from the independent backup")
    previous = registry(before.read_bytes())
    if "creative" in previous or "minecraft:creative" in previous:
        raise ValueError("Original Multiverse registry already declares creative")
    expected_registry = {**previous, "creative": CREATIVE_ENTRY}
    replacement = payload / creative_install.REGISTRY
    if replacement.is_symlink() or registry(replacement.read_bytes()) != expected_registry:
        raise ValueError("Creative registry must preserve every existing world and disable early auto-load")
    verify_terrain(payload / "creative")
    result = JsonObject(
        {
            "status": "VERIFIED_CREATIVE_INSTALLATION_PLAN",
            "scope": "additive-creative",
            **bindings,
            "candidateImage": control.string("candidateImage"),
            "candidateJarSha256": storage.digest(candidate),
            "layout": str(payload.resolve(strict=True)),
            "originalFiles": original,
            "files": storage.files(payload),
        }
    )
    creative_install.installation_files(result)
    return result


def prepare(staging: Path, archive: Path, before: Path, control: JsonObject, candidate: Path) -> JsonObject:
    """Build a bounded local payload; no production volume is mounted or written."""
    if staging.is_symlink() or staging.exists() or archive.is_symlink() or before.is_symlink():
        raise ValueError("Creative preparation requires a new staging directory and regular source inputs")
    files = [archive / "level.dat", *sorted((archive / "region").glob("r.*.*.mca"))]
    if (archive / "region").is_symlink() or any(path.is_symlink() or not path.is_file() for path in files):
        raise ValueError("Recovered creative terrain cannot be linked")
    payload = staging / "payload"
    staging.mkdir(mode=0o700)
    payload.mkdir(mode=0o700)
    (payload / "creative/region").mkdir(parents=True, mode=0o700)
    for source in files:
        shutil.copyfile(source, payload / "creative" / source.relative_to(archive))
    shutil.copyfile(before, staging / "worlds-before.yml")
    previous = registry(before.read_bytes())
    replacement = payload / creative_install.REGISTRY
    replacement.parent.mkdir(parents=True, mode=0o700)
    replacement.write_text(json.dumps({**previous, "creative": CREATIVE_ENTRY}, indent=2) + "\n")
    return plan(staging, control, candidate)

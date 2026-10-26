"""Connect circular-world retirement to the existing admission, backup and writer guards."""

import base64
import io
import json
import os
import struct
import subprocess
import tarfile
import time
from pathlib import Path
from types import ModuleType

import restoration_files as storage
from restoration_json import JsonObject

from maintenance.database import border_radii

ACCEPTANCE_CHECKS = (
    "startup",
    "circularBorders",
    "safeSpawns",
    "creativeClaims",
    "creativeInventoryIsolation",
    "retiredWorldsAbsent",
    "playerInventories",
    "savedDestinations",
    "graveRecovery",
    "retainedWorlds",
    "restorationArchives",
    "maps",
    "privateAdmission",
)
CACHE_ACCEPTANCE_CHECKS = (
    "startup",
    "maps",
    "independentMount",
    "backupExclusion",
    "worldsUnchanged",
    "privateAdmission",
)


def borders(path: Path) -> list[JsonObject]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("World border policy must be the regular owned YAML")
    result = subprocess.run(
        [
            "bun",
            "-e",
            "console.log(JSON.stringify({borders:Bun.YAML.parse(await Bun.file(process.argv[1]).text()).borders}))",
            str(path),
        ],
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    selected = JsonObject.parse(result.stdout).objects("borders")
    border_radii(selected)
    return selected


def sites(path: Path) -> tuple[list[dict[str, object]], str]:
    """Use a captured MCBridge region, never guesses about ground near spawn."""
    value = JsonObject.parse(path.read_bytes())
    region = value.object("region")
    bounds = region.object("min")
    size = region.object("size")
    palette = region.string_list("palette")
    encoded = base64.b64decode(region.string("blocks"), validate=True)
    if region.get("world") != "world" or len(encoded) != 4 * size.integer("x") * size.integer("y") * size.integer("z"):
        raise ValueError("Grave recovery requires a complete main-world MCBridge region capture")

    def block(x: int, y: int, z: int) -> str:
        coordinates = [(x, "x"), (y, "y"), (z, "z")]
        if any(
            not bounds.integer(axis) <= coordinate < bounds.integer(axis) + size.integer(axis)
            for coordinate, axis in coordinates
        ):
            raise ValueError("Recovery site is outside its captured evidence")
        index = (
            ((y - bounds.integer("y")) * size.integer("z") + z - bounds.integer("z")) * size.integer("x")
            + x
            - bounds.integer("x")
        )
        return palette[struct.unpack_from("<I", encoded, 4 * index)[0]]

    result = []
    for site in value.objects("sites"):
        if set(site) != {"world", "x", "y", "z"} or site.get("world") != "world":
            raise ValueError("Recovery site must identify an exact main-world block")
        x, y, z = (site.integer(axis) for axis in ("x", "y", "z"))
        if (
            block(x, y, z) != "minecraft:air"
            or block(x, y + 1, z) != "minecraft:air"
            or block(x, y - 1, z)
            not in (
                "minecraft:cobblestone",
                "minecraft:stone_bricks",
                "minecraft:stone",
                "minecraft:andesite",
            )
        ):
            raise ValueError("Recovery sites need two air blocks above verified solid ground")
        result.append(dict(site))
    return result, storage.digest(path)


def install(
    control: ModuleType, path: Path, journal: JsonObject, staging: Path, candidate: Path, evidence: Path
) -> None:
    control.require_restore(journal)
    if journal.object("restore").get("byteVerification") != "VERIFIED":
        raise ValueError("World retirement requires an independently verified complete restore")
    proof = Path(journal.object("restore").string("proofPath"))
    if storage.digest(proof) != journal.object("restore").string("proofSha256"):
        raise ValueError("Whole-volume proof changed after independent verification")
    captured_sites, sites_sha = sites(evidence)
    owned = Path(__file__).resolve().parent.parent
    world_config = owned / "owned/plugins/TheStorm/world.yml"
    sources = {
        name: owned / name
        for name in (
            "restoration_files.py",
            "restoration_json.py",
            "maintenance/__init__.py",
            "maintenance/database.py",
            "maintenance/retire.py",
        )
    }
    sources["NativePlayerRetirement.class"] = staging / "NativePlayerRetirement.class"
    for source in (*sources.values(), candidate, proof, evidence):
        if source.is_symlink() or not source.is_file():
            raise ValueError("Maintenance input must be a regular file")
    plan = JsonObject(
        {
            "schemaVersion": 1,
            "scope": "circular-worlds",
            "requestId": journal.string("requestId"),
            "candidateImage": journal.string("candidateImage"),
            "candidateJarSha256": storage.digest(candidate),
            "backupUid": journal.object("backup").string("uid"),
            "sourceVolumeUid": journal.string("volumeUid"),
            "restoredVolumeUid": journal.object("restore").string("volumeUid"),
            "backupProofSha256": storage.digest(proof),
            "graveSites": captured_sites,
            "siteEvidenceSha256": sites_sha,
            "borders": borders(world_config),
            "worldConfigSha256": storage.digest(world_config),
            "operatorFiles": {name: storage.digest(source) for name, source in sources.items()},
            "nativeSourceSha256": storage.digest(owned / "conversion/NativePlayerRetirement.java"),
            "preparedAt": (
                journal.object("installationPlan").integer("preparedAt")
                if "installationPlan" in journal
                else time.time_ns() // 1_000_000
            ),
        }
    )
    if journal.get("installationPlan") is not None and journal.object("installationPlan") != plan:
        raise ValueError("Sealed world retirement inputs changed")
    journal["installationPlan"] = plan
    control.save(path, journal)
    name = upload(control, path, journal, sources, {"proof.json": proof}, plan)
    result = control.run(
        [
            "-n",
            control.NAMESPACE,
            "exec",
            name,
            "-c",
            "writer",
            "--",
            "env",
            "PYTHONPATH=/scratch/operator",
            "python3",
            "-m",
            "maintenance.retire",
            "--data",
            "/data",
            "--proof",
            "/scratch/proof.json",
            "--plan",
            "/scratch/plan.json",
        ],
        900,
    )
    receipt = installed(result, plan)
    control.require_offline(journal, writer=True)
    control.require_restore(journal)
    journal["installation"] = receipt
    control.save(path, journal)


def upload(
    control: ModuleType,
    path: Path,
    journal: JsonObject,
    sources: dict[str, Path],
    documents: dict[str, Path],
    plan: JsonObject,
) -> str:
    pod = control.create_writer(path, journal)
    control.require_offline(journal, writer=True)
    name = pod.object("metadata").string("name")
    process = subprocess.Popen(
        [
            "kubectl",
            "--context",
            control.CONTEXT,
            "-n",
            control.NAMESPACE,
            "exec",
            "-i",
            name,
            "-c",
            "writer",
            "--",
            "tar",
            "-xf",
            "-",
            "-C",
            "/scratch",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        if process.stdin is None:
            raise RuntimeError("Maintenance upload stream is unavailable")
        with tarfile.open(fileobj=process.stdin, mode="w|") as archive:
            for relative, source in sources.items():
                if storage.digest(source) != plan.object("operatorFiles").string(relative):
                    raise ValueError("Maintenance code changed before upload")
                archive.add(source, arcname="operator/" + relative, recursive=False)
            for relative, source in documents.items():
                archive.add(source, arcname=relative, recursive=False)
            encoded = json.dumps(plan).encode()
            entry = tarfile.TarInfo("plan.json")
            entry.mode, entry.size = 0o600, len(encoded)
            archive.addfile(entry, io.BytesIO(encoded))
        process.stdin.close()
        process.stdin = None
        _, errors = process.communicate(timeout=90)
        if process.returncode:
            raise RuntimeError("Maintenance upload failed: " + errors.decode(errors="replace"))
    except BaseException:
        process.kill()
        process.wait()
        raise
    control.assert_writer(control.read("pod", name), journal)
    return name


def installed(result: str, plan: JsonObject) -> JsonObject:
    receipt = JsonObject.parse(result.strip().splitlines()[-1])
    if (
        receipt.get("phase") != "INSTALLED"
        or receipt.get("scope") != plan.string("scope")
        or receipt.get("candidateJarSha256") != plan.string("candidateJarSha256")
        or receipt.get("unrelatedFiles") != "UNCHANGED"
    ):
        raise ValueError("Maintenance did not return complete unchanged-data evidence")
    return receipt


def retire_cache(control: ModuleType, path: Path, journal: JsonObject, candidate: Path, evidence: Path) -> None:
    if journal.string("candidateImage") != journal.string("rollbackImage"):
        raise ValueError("Cache retirement must keep the exact accepted production image")
    value = JsonObject.parse(evidence.read_bytes())
    if (
        value.get("requestId") != journal.string("requestId")
        or value.get("candidateImage") != journal.string("candidateImage")
        or not value.string_list("renderedMaps")
        or value.get("browserStatus") != "VERIFIED"
        or value.get("independentMount") != "VERIFIED"
        or value.get("backupExclusion") != "VERIFIED"
    ):
        raise ValueError("Cache retirement requires live map, independent storage and backup exclusion acceptance")
    claim = control.read("pvc", "minecraft-tsmc-bluemap")
    if (
        claim.object("metadata").get("uid") != value.string("cacheClaimUid")
        or claim.object("status").get("phase") != "Bound"
        or claim.object("spec").get("volumeName") == journal.string("volumeName")
    ):
        raise ValueError("Accepted BlueMap storage identity changed")
    owned = Path(__file__).resolve().parent.parent
    sources = {
        name: owned / name
        for name in ("restoration_files.py", "restoration_json.py", "maintenance/__init__.py", "maintenance/cache.py")
    }
    sources["bluemap_storage.py"] = (
        owned.parents[2] / "packages/homelab/src/cdk8s/src/misc/minecraft/bluemap-storage/bluemap.py"
    )
    if any(source.is_symlink() or not source.is_file() for source in (*sources.values(), candidate, evidence)):
        raise ValueError("Cache maintenance requires regular operator inputs")
    plan = JsonObject(
        {
            "schemaVersion": 1,
            "scope": "bluemap-storage",
            "requestId": journal.string("requestId"),
            "candidateImage": journal.string("candidateImage"),
            "candidateJarSha256": storage.digest(candidate),
            "cacheClaimUid": value.string("cacheClaimUid"),
            "manifestSha256": value.string("manifestSha256"),
            "acceptanceSha256": storage.digest(evidence),
            "operatorFiles": {name: storage.digest(source) for name, source in sources.items()},
        }
    )
    if journal.get("installationPlan") is not None and journal.object("installationPlan") != plan:
        raise ValueError("Cache maintenance inputs changed after acceptance")
    journal["maintenanceScope"] = "bluemap-storage"
    journal["installationPlan"] = plan
    control.save(path, journal)
    name = upload(control, path, journal, sources, {}, plan)
    result = control.run(
        [
            "-n",
            control.NAMESPACE,
            "exec",
            name,
            "-c",
            "writer",
            "--",
            "env",
            "PYTHONPATH=/scratch/operator",
            "python3",
            "-m",
            "maintenance.cache",
            "--plan",
            "/scratch/plan.json",
        ],
        1800,
    )
    control.require_offline(journal, writer=True)
    if control.read("pvc", "minecraft-tsmc-bluemap").object("metadata").get("uid") != plan.string("cacheClaimUid"):
        raise ValueError("BlueMap storage was replaced during maintenance")
    journal["installation"] = installed(result, plan)
    control.save(path, journal)

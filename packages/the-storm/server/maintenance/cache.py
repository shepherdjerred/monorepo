"""Retire only the verified original BlueMap cache while keeping every world byte unchanged."""

import argparse
import importlib.util
import json
import uuid
from pathlib import Path
from types import ModuleType

import restoration_files as storage
from restoration_json import JsonObject


def load_asset() -> ModuleType:
    specification = importlib.util.spec_from_file_location(
        "bluemap_storage", Path(__file__).parent.parent / "bluemap_storage.py"
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("The verified BlueMap operator asset is unavailable")
    asset = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(asset)
    return asset


def files(data: Path, request: str) -> dict[str, str]:
    excluded = ("bluemap/", f"{storage.WORKSPACE}/{request}/bluemap-storage/")
    return {name: checksum for name, checksum in storage.files(data).items() if not name.startswith(excluded)}


def retire(data: Path, cache: Path, plan: JsonObject, baked_jar: Path = Path("/plugins/TheStorm.jar")) -> JsonObject:
    bluemap_storage = load_asset()
    request = plan.string("requestId")
    if (
        str(uuid.UUID(request)) != request
        or plan.get("scope") != "bluemap-storage"
        or storage.digest(baked_jar) != plan.string("candidateJarSha256")
    ):
        raise ValueError("Cache retirement requires the exact request and unchanged published server")
    bluemap_storage.mounts(data, cache)
    copy = bluemap_storage.read_receipt(cache)
    if copy.get("manifestSha256") != plan.string("manifestSha256"):
        raise ValueError("Live map acceptance belongs to a different migrated cache")
    root = data / storage.WORKSPACE / request / "bluemap-storage"
    for path in (root, root.parent, root.parent.parent):
        if path.is_symlink():
            raise ValueError("Cache maintenance workspace cannot be linked")
    with storage.stopped(data):
        receipt_path = root / "journal.json"
        if not receipt_path.exists():
            if root.exists():
                raise ValueError("Cache maintenance workspace already exists without its receipt")
            original = files(data, request)
            root.mkdir(mode=0o700, parents=True)
            storage.save(receipt_path, {"phase": "PREPARED", "plan": plan, "original": original})
        receipt = JsonObject.parse(receipt_path.read_bytes())
        if receipt.object("plan") != plan or files(data, request) != receipt.strings("original"):
            raise ValueError("Cache retirement changed owner or unrelated world data")
        bluemap_storage.retire_source(data, cache, plan.string("manifestSha256"))
        if files(data, request) != receipt.strings("original") or (data / "bluemap").exists():
            raise ValueError("Cache retirement failed unchanged-world readback")
        receipt.update(
            phase="INSTALLED",
            scope="bluemap-storage",
            unrelatedFiles="UNCHANGED",
            candidateJarSha256=plan.string("candidateJarSha256"),
        )
        storage.save(receipt_path, receipt)
        return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    arguments = parser.parse_args()
    result = retire(Path("/data"), Path("/cache"), JsonObject.parse(arguments.plan.read_bytes()))
    print(json.dumps({key: result[key] for key in ("phase", "scope", "candidateJarSha256", "unrelatedFiles")}))

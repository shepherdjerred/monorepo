"""Render untouched converted chunks without loading or ticking the historical world."""

import argparse
import hashlib
import json
import os
import re
import uuid
from pathlib import Path

import restoration_files as storage
from restoration_json import JsonObject


def render_unlit(data: Path, request: str, jar_sha: str) -> JsonObject:
    if str(uuid.UUID(request)) != request or re.fullmatch(r"[a-f0-9]{64}", jar_sha) is None:
        raise ValueError("Map rendering requires an exact request and published JAR hash")
    if data.is_symlink():
        raise ValueError("Map data root cannot be linked")
    data = data.resolve(strict=True)
    workspace = data / storage.WORKSPACE / request
    config = data / "plugins/BlueMap/maps/world.conf"
    receipt_path = workspace / "bluemap-render.json"
    for path in (workspace, workspace / "journal.json", config, receipt_path, *config.parents):
        if path.is_symlink():
            raise ValueError("Map rendering inputs cannot be linked")
    installed = JsonObject.parse((workspace / "journal.json").read_bytes())
    if (
        installed.get("phase") != "INSTALLED"
        or installed.get("requestId") != request
        or installed.get("candidateJarSha256") != jar_sha
        or storage.digest(data / "plugins/TheStorm.jar") != jar_sha
    ):
        raise ValueError("Map rendering requires this installed candidate")
    current = config.read_bytes()
    if receipt_path.exists():
        receipt = JsonObject.parse(receipt_path.read_bytes())
        if receipt.get("requestId") != request or receipt.get("candidateJarSha256") != jar_sha:
            raise ValueError("Map rendering receipt belongs to another candidate")
        original = receipt.string("original").encode()
    else:
        original = current
        receipt = JsonObject({"requestId": request, "candidateJarSha256": jar_sha, "original": original.decode()})
    text = original.decode()
    if (
        text.splitlines().count('world: "world"') != 1
        or text.splitlines().count('dimension: "minecraft:overworld"') != 1
        or text.splitlines().count("ignore-missing-light-data: false") != 1
    ):
        raise ValueError("Map rendering requires the generated main-overworld configuration")
    updated = text.replace("\nignore-missing-light-data: false\n", "\nignore-missing-light-data: true\n").encode()
    if updated == original or current not in (original, updated):
        raise ValueError("Map configuration changed outside the bounded lighting repair")
    storage.save(receipt_path, receipt)
    if current != updated:
        temporary = workspace / f"bluemap-config-{uuid.uuid4()}.writing"
        owner = config.stat()
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(updated)
                stream.flush()
                os.fchmod(stream.fileno(), owner.st_mode & 0o777)
                os.fchown(stream.fileno(), owner.st_uid, owner.st_gid)
                os.fsync(stream.fileno())
            temporary.replace(config)
        finally:
            temporary.unlink(missing_ok=True)
        storage.sync_directory(config.parent)
    if config.read_bytes() != updated:
        raise ValueError("Map configuration readback changed")
    receipt.update({"phase": "VERIFIED", "configSha256": hashlib.sha256(updated).hexdigest(), "worldTicks": 0})
    storage.save(receipt_path, receipt)
    return JsonObject(
        {key: receipt[key] for key in ("requestId", "candidateJarSha256", "phase", "configSha256", "worldTicks")}
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--jar-sha", required=True)
    arguments = parser.parse_args()
    print(json.dumps(render_unlit(Path("/data"), arguments.request, arguments.jar_sha)))

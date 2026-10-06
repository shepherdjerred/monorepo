"""Execute a sealed installation inside the controller's stopped-volume writer."""

import argparse
import json
from pathlib import Path

import restoration_files
from restoration_json import JsonObject


def install(data: Path, payload: Path, plan: JsonObject, baked_jar: Path) -> JsonObject:
    if plan.get("status") != "VERIFIED_INSTALLATION_PLAN" or restoration_files.digest(baked_jar) != plan.string(
        "candidateJarSha256"
    ):
        raise ValueError("Writer image does not contain the exact verified candidate plugin")
    expected = restoration_files.installation_manifest(plan.strings("installationFiles"))
    if restoration_files.files(payload) != expected:
        raise ValueError("Uploaded installation payload changed or is incomplete")
    root = data / restoration_files.WORKSPACE / plan.string("requestId")
    if not root.exists():
        root = restoration_files.stage(
            data,
            payload,
            expected,
            plan.strings("originalFiles"),
            plan.string("requestId"),
            plan.string("candidateImage"),
            plan.string("candidateJarSha256"),
            plan.string("backupUid"),
        )
    if root.is_symlink() or root.parent.is_symlink() or (root / "journal.json").is_symlink():
        raise ValueError("Installation journal cannot be linked")
    receipt = JsonObject.parse((root / "journal.json").read_bytes())
    if (
        any(
            receipt.get(key) != plan.get(key)
            for key in ("requestId", "candidateImage", "candidateJarSha256", "backupUid")
        )
        or receipt.strings("installation") != expected
        or receipt.strings("original") != plan.strings("originalFiles")
    ):
        raise ValueError("Writer workspace belongs to different installation inputs")
    result = restoration_files.commit(data, plan.string("requestId"))
    return JsonObject(
        {
            "phase": result.string("phase"),
            "requestId": result.string("requestId"),
            "candidateImage": result.string("candidateImage"),
            "candidateJarSha256": result.string("candidateJarSha256"),
            "backupUid": result.string("backupUid"),
            "files": len(expected),
            "coreProtectEpoch": result.string("coreProtectEpoch"),
            "privateStartup": result.string("privateStartup"),
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path("/data"))
    parser.add_argument("--payload", type=Path, default=Path("/scratch/payload"))
    parser.add_argument("--baked-jar", type=Path, default=Path("/plugins/TheStorm.jar"))
    arguments = parser.parse_args()
    if arguments.plan.is_symlink():
        raise ValueError("Installation plan cannot be linked")
    print(
        json.dumps(
            install(
                arguments.data, arguments.payload, JsonObject.parse(arguments.plan.read_bytes()), arguments.baked_jar
            )
        )
    )


if __name__ == "__main__":
    main()

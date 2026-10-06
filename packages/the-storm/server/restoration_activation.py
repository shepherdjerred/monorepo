"""Bind installation inputs to the exact maintenance request and verified independent rollback volume."""

from pathlib import Path

import restoration_backup
import restoration_files
from restoration_json import JsonObject

ARCHIVE_SHA256 = "89fc7865604b5ab9ecf3030c90a192f8f9c963083cc77135949c953ae6b645fa"
DIMENSIONS = ("settlement", "rustworks", "rwf")


def sealed(path: Path, checksum: str) -> JsonObject:
    if path.is_symlink() or not path.is_file() or restoration_files.digest(path) != checksum:
        raise ValueError("Installation evidence changed after verification")
    return JsonObject.parse(path.read_bytes())


def plan(staging: Path, control: JsonObject, candidate: Path) -> JsonObject:
    """Read-only validation; generic local-copy and synthetic receipts cannot authorize installation."""
    if staging.is_symlink() or candidate.is_symlink() or not candidate.is_file():
        raise ValueError("Installation requires regular private staging and candidate inputs")
    staging = staging.resolve(strict=True)
    candidate_sha = restoration_files.digest(candidate)
    restore = control.object("restore")
    export = control.object("export")
    if (
        control.get("phase") != "LEASED_OFFLINE"
        or control.get("admissionProbes") != "UPDATE_AND_SCALE_DENIED"
        or restore.get("phase") != "Completed"
        or restore.get("byteVerification") != "VERIFIED"
        or export.get("phase") != "VERIFIED"
    ):
        raise ValueError("Installation requires the stopped lease and verified whole-volume restore and export")
    original = restoration_backup.whole_proof(Path(restore.string("proofPath")), restore.string("proofSha256"))
    bindings = {
        "requestId": control.string("requestId"),
        "backupUid": control.object("backup").string("uid"),
        "sourceVolumeUid": control.string("volumeUid"),
        "restoredVolumeUid": restore.string("volumeUid"),
    }
    if any(original.get(key) != value for key, value in bindings.items()):
        raise ValueError("Installation backup proof belongs to another request or storage identity")
    export_proof = sealed(Path(export.string("proofPath")), export.string("proofSha256"))
    if export_proof.get("schemaVersion") != 2 or any(export_proof.get(key) != value for key, value in bindings.items()):
        raise ValueError("Installation requires the request-owned storage-bound export, not a generic local copy")
    restoration_backup.verified_export(export_proof)
    if export_proof.get("wholeVolumeProofPath") != restore.string("proofPath") or export_proof.get(
        "wholeVolumeProofSha256"
    ) != restore.string("proofSha256"):
        raise ValueError("Installation export is not bound to this exact whole-volume proof")
    journal_path = staging / "restore-journal.json"
    if journal_path.is_symlink():
        raise ValueError("Historical preparation journal cannot be linked")
    journal = JsonObject.parse(journal_path.read_bytes())
    if (
        journal.get("phase") != "ACTIVATION_LAYOUT_READY"
        or journal.get("requestId") != control.string("requestId")
        or journal.get("archiveSha256") != ARCHIVE_SHA256
    ):
        raise ValueError("Historical preparation is not ready for this exact installation request")
    receipt = sealed(staging / "activation-layout-receipt.json", journal.string("activationReceiptSha256"))
    native = receipt.object("native")
    if (
        receipt.integer("schemaVersion") != 1
        or receipt.get("status") != "VERIFIED"
        or receipt.get("testOnly")
        or receipt.get("syntheticRetainedDimensions")
        or receipt.get("requestId") != control.string("requestId")
        or receipt.get("archiveSha256") != ARCHIVE_SHA256
        or receipt.get("candidateJarSha256") != candidate_sha
        or receipt.get("backupProofSha256") != export.string("proofSha256")
        or receipt.integer("historicalChunks") != 638_647
        or receipt.get("freshDimensions") != ["wilds", "peaks", "mining"]
        or native.get("status") != "VERIFIED"
        or native.integer("dataVersion") != 4903
        or native.integer("worldTicks") != 0
        or native.get("terrainGeneration") is not False
        or native.get("entityUuidCollisions") != []
        or native.object("dimensions").object("overworld").integer("region") != 638_647
    ):
        raise ValueError("Installation requires the exact native production-data verification receipt")
    owned = Path(__file__).resolve().parent
    tool_names = ("NativeActivationCheck.java", "NativeAnimalIdentityRepair.java", "NativeLayoutMetadata.java")
    for name in tool_names:
        if receipt.object("inputs").get(name) != restoration_files.digest(owned / "conversion" / name):
            raise ValueError("Native verification tools changed after activation preparation")
    manifest_path = staging / "activation-layout-files.json"
    if manifest_path.is_symlink() or restoration_files.digest(manifest_path) != receipt.string("filesSha256"):
        raise ValueError("The sealed installation file manifest changed")
    manifest = JsonObject.parse(manifest_path.read_bytes())
    expected = restoration_files.checked_manifest(JsonObject({"files": manifest}).strings("files"))
    # Native conversion writes a plain path-to-hash object, with no wrapper.
    layout = staging / "activation-layout"
    if restoration_files.files(layout) != expected:
        raise ValueError("Prepared activation files changed after complete native verification")
    selected = restoration_files.installation_manifest(expected)
    if selected.get("plugins/TheStorm/the-storm.db") != receipt.string("databaseSha256"):
        raise ValueError("Prepared identity database differs from its verified receipt")
    database_proof = sealed(staging / "restoration-database/receipt.json", journal.string("databaseReceiptSha256"))
    if (
        database_proof.get("townImport") != "VERIFIED"
        or database_proof.get("gameplayReset") is not True
        or database_proof.get("sourceVersionMigration") != "VERIFIED_PRIVATE_COPY"
        or database_proof.get("databaseSha256") != receipt.string("databaseSha256")
    ):
        raise ValueError("Installation lacks verified identity migration and fresh gameplay state")
    for name in ("restoration-policy.json", "database-restore.py"):
        if database_proof.object("inputs").get(name) != restoration_files.digest(owned / name):
            raise ValueError("Identity retention policy or importer changed after database preparation")
    retained = receipt.object("retainedDimensions")
    if set(retained) != set(DIMENSIONS):
        raise ValueError("Installation lacks the complete retained arena dimension selection")
    for dimension in DIMENSIONS:
        prefix = "world/dimensions/minecraft/" + dimension + "/"
        facts = JsonObject({"files": retained[dimension]})
        if facts.strings("files") != {
            name.removeprefix(prefix): value for name, value in selected.items() if name.startswith(prefix)
        }:
            raise ValueError("Retained arena terrain or metadata changed after verification")
        if {name: value for name, value in selected.items() if name.startswith(prefix)} != {
            name: value for name, value in export_proof.strings("files").items() if name.startswith(prefix)
        }:
            raise ValueError("Retained arenas differ from the actual independently restored production data")
        if native.object("dimensions").object(dimension).integer("region") <= 0:
            raise ValueError("Retained arena native verification contains no terrain")
    return JsonObject(
        {
            "status": "VERIFIED_INSTALLATION_PLAN",
            **bindings,
            "candidateImage": control.string("candidateImage"),
            "candidateJarSha256": candidate_sha,
            "activationReceiptSha256": journal.string("activationReceiptSha256"),
            "layout": str(layout),
            "files": expected,
            "installationFiles": selected,
            "originalFiles": original.strings("files"),
            "privateAcceptance": "PENDING",
        }
    )

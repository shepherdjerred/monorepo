import json
import tempfile
import unittest
from collections.abc import Mapping
from pathlib import Path

import restoration_activation as activation
import restoration_backup
import restoration_files
from restoration_json import JsonObject

REQUEST = "6903b19f-f4d2-42a5-91ba-6ce046562c83"
IMAGE = "ghcr.io/shepherdjerred/the-storm-server:fixture@sha256:" + "a" * 64


class RestorationActivationTest(unittest.TestCase):
    """Synthetic receipts exercise the installation boundary, never provide native acceptance proof."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.staging = self.root / "historical"
        self.layout = self.staging / "activation-layout"
        self.layout.mkdir(parents=True)
        self.candidate = self.root / "TheStorm.jar"
        self.candidate.write_bytes(b"synthetic plugin")
        self.write("world/level.dat", b"historical metadata")
        self.write("world/dimensions/minecraft/overworld/region/r.0.0.mca", b"historical terrain")
        self.write("plugins/TheStorm/the-storm.db", b"migrated database")
        retained = {}
        for dimension in activation.DIMENSIONS:
            prefix = "world/dimensions/minecraft/" + dimension + "/"
            self.write(prefix + "data/paper/metadata.dat", dimension.encode())
            self.write(prefix + "region/r.0.0.mca", b"retained production arena fixture")
            retained[dimension] = restoration_files.files(self.layout / prefix)
        original = restoration_files.files(self.layout)
        original["server.properties"] = "c" * 64
        whole = self.root / "whole-proof.json"
        bindings = {
            "requestId": REQUEST,
            "backupUid": "backup-uid",
            "sourceVolumeUid": "source-uid",
            "restoredVolumeUid": "restore-uid",
        }
        self.save(whole, {"schemaVersion": 1, "status": "VERIFIED", **bindings, "files": original})
        exported = self.root / "export-proof.json"
        self.save(
            exported,
            {
                "schemaVersion": 2,
                "status": "VERIFIED_EXPORT",
                **bindings,
                "wholeVolumeProofPath": str(whole),
                "wholeVolumeProofSha256": restoration_files.digest(whole),
                "files": restoration_backup.selected_files(original),
            },
        )
        self.control = JsonObject(
            {
                "phase": "LEASED_OFFLINE",
                "admissionProbes": "UPDATE_SCALE_AND_DELETE_DENIED",
                "requestId": REQUEST,
                "candidateImage": IMAGE,
                "backup": {"uid": "backup-uid"},
                "volumeUid": "source-uid",
                "restore": {
                    "phase": "Completed",
                    "byteVerification": "VERIFIED",
                    "volumeUid": "restore-uid",
                    "proofPath": str(whole),
                    "proofSha256": restoration_files.digest(whole),
                },
                "export": {
                    "phase": "VERIFIED",
                    "proofPath": str(exported),
                    "proofSha256": restoration_files.digest(exported),
                },
            }
        )
        owned = Path(activation.__file__).parent
        inputs = {
            name: restoration_files.digest(owned / "conversion" / name)
            for name in ("NativeActivationCheck.java", "NativeAnimalIdentityRepair.java", "NativeLayoutMetadata.java")
        }
        database = self.staging / "restoration-database/receipt.json"
        database.parent.mkdir()
        self.save(
            database,
            {
                "townImport": "VERIFIED",
                "gameplayReset": True,
                "sourceVersionMigration": "VERIFIED_PRIVATE_COPY",
                "databaseSha256": original["plugins/TheStorm/the-storm.db"],
                "inputs": {
                    name: restoration_files.digest(owned / name)
                    for name in ("restoration-policy.json", "database-restore.py")
                },
            },
        )
        self.receipt = JsonObject(
            {
                "schemaVersion": 1,
                "status": "VERIFIED",
                "requestId": REQUEST,
                "archiveSha256": activation.ARCHIVE_SHA256,
                "candidateJarSha256": restoration_files.digest(self.candidate),
                "backupProofSha256": restoration_files.digest(exported),
                "databaseSha256": original["plugins/TheStorm/the-storm.db"],
                "historicalChunks": 638647,
                "freshDimensions": ["wilds", "peaks", "mining"],
                "retainedDimensions": retained,
                "inputs": inputs,
                "native": {
                    "status": "VERIFIED",
                    "dataVersion": 4903,
                    "worldTicks": 0,
                    "terrainGeneration": False,
                    "entityUuidCollisions": [],
                    "dimensions": {
                        "overworld": {"region": 638647},
                        **{name: {"region": 1} for name in activation.DIMENSIONS},
                    },
                },
            }
        )
        self.journal = JsonObject(
            {
                "phase": "ACTIVATION_LAYOUT_READY",
                "requestId": REQUEST,
                "archiveSha256": activation.ARCHIVE_SHA256,
                "databaseReceiptSha256": restoration_files.digest(database),
            }
        )
        self.seal()

    def write(self, name: str, value: bytes):
        path = self.layout / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)

    def save(self, path: Path, value: Mapping[str, object]):
        path.write_text(json.dumps(value), encoding="utf-8")

    def seal(self):
        manifest = self.staging / "activation-layout-files.json"
        self.save(manifest, restoration_files.files(self.layout))
        self.receipt["filesSha256"] = restoration_files.digest(manifest)
        receipt = self.staging / "activation-layout-receipt.json"
        self.save(receipt, self.receipt)
        self.journal["activationReceiptSha256"] = restoration_files.digest(receipt)
        self.save(self.staging / "restore-journal.json", self.journal)

    def plan(self) -> JsonObject:
        return activation.plan(self.staging, self.control, self.candidate)

    def test_plan_binds_native_layout_candidate_and_exact_independent_storage_without_writes(self):
        before = restoration_files.files(self.root)
        result = self.plan()
        self.assertEqual(result["status"], "VERIFIED_INSTALLATION_PLAN")
        self.assertEqual(result["privateAcceptance"], "PENDING")
        self.assertEqual(result["candidateImage"], IMAGE)
        self.assertEqual(result["candidateJarSha256"], restoration_files.digest(self.candidate))
        self.assertEqual(result["sourceVolumeUid"], "source-uid")
        self.assertEqual(result["restoredVolumeUid"], "restore-uid")
        self.assertEqual(result["installationFiles"], restoration_files.files(self.layout))
        self.assertEqual(restoration_files.files(self.root), before)

    def test_synthetic_audit_and_incomplete_native_receipts_cannot_authorize_installation(self):
        for change in (
            {"testOnly": True},
            {"syntheticRetainedDimensions": True},
            {"status": "AUDIT_ONLY"},
            {"historicalChunks": True},
        ):
            with self.subTest(change=change):
                original = dict(self.receipt)
                self.receipt.update(change)
                self.seal()
                with self.assertRaises(ValueError):
                    self.plan()
                self.receipt = JsonObject(original)
        self.receipt.object("native")["entityUuidCollisions"] = [{"type": "duplicate"}]
        self.seal()
        with self.assertRaisesRegex(ValueError, "native production-data"):
            self.plan()

    def test_changed_layout_candidate_or_storage_proof_is_refused(self):
        self.write("world/level.dat", b"unexpected terrain drift")
        with self.assertRaisesRegex(ValueError, "activation files changed"):
            self.plan()
        self.write("world/level.dat", b"historical metadata")
        self.candidate.write_bytes(b"new candidate")
        with self.assertRaisesRegex(ValueError, "native production-data"):
            self.plan()
        self.candidate.write_bytes(b"synthetic plugin")
        self.control["volumeUid"] = "foreign-source-uid"
        with self.assertRaisesRegex(ValueError, "storage identity"):
            self.plan()

    def test_arena_copy_must_match_the_actual_verified_modern_backup(self):
        name = "world/dimensions/minecraft/settlement/region/r.0.0.mca"
        self.write(name, b"wrong arena data")
        self.receipt.object("retainedDimensions").object("settlement")["region/r.0.0.mca"] = restoration_files.digest(
            self.layout / name
        )
        self.seal()
        with self.assertRaisesRegex(ValueError, "actual independently restored production"):
            self.plan()

    def test_installation_refuses_open_or_unverified_maintenance_state(self):
        self.control["phase"] = "PREPARED"
        with self.assertRaisesRegex(ValueError, "stopped lease"):
            self.plan()
        self.control["phase"] = "LEASED_OFFLINE"
        self.control.object("restore")["byteVerification"] = "PENDING"
        with self.assertRaisesRegex(ValueError, "whole-volume restore"):
            self.plan()

    def test_generic_copy_receipts_and_changed_retention_tools_are_refused(self):
        file = Path(self.control.object("export").string("proofPath"))
        original = file.read_bytes()
        self.save(file, {"schemaVersion": 1, "status": "VERIFIED", "files": restoration_files.files(self.layout)})
        self.control.object("export")["proofSha256"] = restoration_files.digest(file)
        with self.assertRaisesRegex(ValueError, "storage-bound export"):
            self.plan()
        file.write_bytes(original)
        self.control.object("export")["proofSha256"] = restoration_files.digest(file)
        database = self.staging / "restoration-database/receipt.json"
        proof = JsonObject.parse(database.read_bytes())
        proof.object("inputs")["restoration-policy.json"] = "d" * 64
        self.save(database, proof)
        self.journal["databaseReceiptSha256"] = restoration_files.digest(database)
        self.seal()
        with self.assertRaisesRegex(ValueError, "retention policy"):
            self.plan()


if __name__ == "__main__":
    unittest.main()

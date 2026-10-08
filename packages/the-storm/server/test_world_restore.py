"""Archive preparation and independent backup verification use real filesystem fixtures."""

import importlib.util
import io
import json
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from typing import Literal
from unittest.mock import patch

from restoration_json import JsonObject
from test_restoration_locks import fixture as lock_fixture

spec = importlib.util.spec_from_file_location("restore", Path(__file__).with_name("world-restore.py"))
assert spec is not None and spec.loader is not None
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def archive(self, names: list[str]):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            for name in names:
                archive.writestr(name, b"fixture")
        data.seek(0)
        return zipfile.ZipFile(data)

    def test_rejects_escaping_duplicate_and_foreign_members(self):
        for names in [
            ["../escape"],
            ["/absolute"],
            ["foreign/world/level.dat"],
            [restore.ARCHIVE_ROOT + "../escape"],
            [restore.ARCHIVE_ROOT + "level.dat"] * 2,
        ]:
            with self.subTest(names=names), self.archive(names) as archive, self.assertRaises(ValueError):
                restore.archive_members(archive)

    def test_accepts_only_selected_world_paths(self):
        with self.archive([restore.ARCHIVE_ROOT + "region/r.-1.0.mca"]) as archive:
            members = restore.archive_members(archive)
            self.assertEqual(str(members[0][1]), "region/r.-1.0.mca")

    def test_unapproved_archive_cannot_create_staging(self):
        archive = self.root / "wrong.zip"
        archive.write_bytes(b"wrong source")
        destination = self.root / "stage"
        with self.assertRaisesRegex(ValueError, "approved July 2015"):
            restore.prepare(archive, destination)
        self.assertFalse(destination.exists())

    def test_resource_preparation_rejects_overlapping_roots_before_any_backup_write(self):
        for relationship in ("same", "staging-inside", "backup-inside", "ancestor-link"):
            with self.subTest(relationship=relationship):
                root = self.root / relationship
                root.mkdir()
                modern = root / "modern"
                modern.mkdir()
                if relationship == "same":
                    staging = modern
                elif relationship in ("staging-inside", "ancestor-link"):
                    staging = modern / "staging"
                    staging.mkdir()
                    if relationship == "ancestor-link":
                        (root / "alias").symlink_to(modern, target_is_directory=True)
                        staging = root / "alias/staging"
                else:
                    staging = root
                paper, candidate, proof = (root / name for name in ("paper.jar", "candidate.jar", "proof.json"))
                for path in (paper, candidate, proof):
                    path.write_bytes(b"fixture")
                bootstrap = root / "bootstrap"
                bootstrap.mkdir()
                (modern / "world.dat").write_bytes(b"verified recovery bytes")
                before = restore.fingerprint(modern)
                with (
                    patch.object(restore.subprocess, "run") as java,
                    self.assertRaisesRegex(ValueError, "independent staging"),
                ):
                    restore.prepare_resources(staging, paper, bootstrap, candidate, modern, proof)
                java.assert_not_called()
                self.assertEqual(restore.fingerprint(modern), before)
                self.assertFalse((staging / "resource-bootstrap").exists())

    def test_database_preparation_locks_the_historical_data_root(self):
        staging = self.root / "staging"
        historical = staging / "heritage-preserved-layout/world"
        historical.mkdir(parents=True)
        (historical / "level.dat").write_bytes(b"historical")
        (historical / "session.lock").write_bytes(b"lock")
        modern = self.root / "modern"
        (modern / "world").mkdir(parents=True)
        (modern / "world/level.dat").write_bytes(b"modern")
        (modern / "world/session.lock").write_bytes(b"lock")
        paper, candidate, backup = (self.root / name for name in ("paper.jar", "TheStorm.jar", "backup.json"))
        for path in (paper, candidate, backup):
            path.write_bytes(b"fixture")
        bootstrap = self.root / "bootstrap"
        bootstrap.mkdir()
        restore.save_json(staging / "heritage-preserved-layout-files.json", restore.fingerprint(historical))
        restore.save_json(
            staging / restore.JOURNAL,
            {
                "phase": "ARENAS_PRESERVED",
                "archiveSha256": restore.ARCHIVE_SHA256,
                "arenaTransplantInputs": {
                    backup.name: restore.digest(backup),
                    candidate.name: restore.digest(candidate),
                },
            },
        )
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore, "verified_backup", side_effect=ValueError("backup verification reached")) as verify,
            self.assertRaisesRegex(ValueError, "backup verification reached"),
        ):
            restore.prepare_database(staging, paper, bootstrap, candidate, modern, backup)
        verify.assert_called_once_with(modern.resolve(), backup.resolve())
        self.assertFalse((staging / "restoration-database").exists())

    def test_resource_preparation_rejects_native_tool_changed_during_generation(self):
        staging, paper, bootstrap, candidate, modern, proof = self.activation_fixture()
        tool_root = self.root / "operator"
        (tool_root / "conversion").mkdir(parents=True)
        tool = tool_root / "conversion/NativeResourceBootstrap.java"
        tool.write_bytes(b"original source")
        restore.save_json(proof, {"schemaVersion": 2, "requestId": "fixture-request"})
        receipt = staging / "activation-layout-receipt.json"
        restore.save_json(
            receipt,
            {"candidateJarSha256": restore.digest(candidate), "backupProofSha256": restore.digest(proof)},
        )
        restore.save_json(
            staging / restore.JOURNAL,
            {
                "phase": "ACTIVATION_LAYOUT_READY",
                "requestId": "fixture-request",
                "activationReceiptSha256": restore.digest(receipt),
            },
        )
        before = restore.fingerprint(modern)
        with (
            patch.object(restore, "__file__", str(tool_root / "world-restore.py")),
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore, "verified_backup", return_value=before),
            patch.object(restore.subprocess, "run", side_effect=lambda *a, **kw: tool.write_bytes(b"changed source")),
            self.assertRaisesRegex(ValueError, "tool changed"),
        ):
            restore.prepare_resources(staging, paper, bootstrap, candidate, modern, proof)
        self.assertEqual(restore.fingerprint(modern), before)
        self.assertFalse((staging / "resource-bootstrap/receipt.json").exists())
        self.assertNotIn("resourceReceiptSha256", json.loads((staging / restore.JOURNAL).read_text()))

    def test_headers_preserve_negative_coordinates_and_reject_overlap(self):
        region = self.root / "region"
        region.mkdir()
        block = bytearray(12288)
        struct.pack_into(">I", block, 31 * 4, (2 << 8) | 1)
        struct.pack_into(">I", block, 8192, 2)
        block[8196:8198] = b"\x02x"
        target = region / "r.-1.0.mca"
        target.write_bytes(block)
        self.assertEqual(restore.chunk_inventory(region), {"-1,0": 2})
        struct.pack_into(">I", block, 30 * 4, (2 << 8) | 1)
        target.write_bytes(block)
        with self.assertRaisesRegex(ValueError, "Overlapping"):
            restore.chunk_inventory(region)

    def test_independent_copy_receipt_and_corruption(self):
        original = self.root / "original"
        (original / "world").mkdir(parents=True)
        (original / "world/level.dat").write_bytes(b"world")
        (original / "world/session.lock").write_bytes(b"lock")
        restored = self.root / "restored"
        shutil.copytree(original, restored)
        receipt = self.root / "verified.json"
        restore.verify_copy(original, restored, receipt)
        self.assertEqual(json.loads(receipt.read_text())["status"], "VERIFIED")
        (restored / "world/level.dat").write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "differs in 1 files"):
            restore.verify_copy(original, restored, self.root / "failed.json")
        self.assertFalse((self.root / "failed.json").exists())

    def test_same_copy_and_nested_receipts_are_not_backup_evidence(self):
        original = self.root / "original"
        (original / "world").mkdir(parents=True)
        (original / "world/level.dat").write_bytes(b"world")
        restored = self.root / "restored"
        shutil.copytree(original, restored)
        with self.assertRaises(ValueError):
            restore.verify_copy(original, original, self.root / "same.json")
        with self.assertRaises(ValueError):
            restore.verify_copy(original, restored, original / "receipt.json")

    def test_hardlinked_restore_and_root_symlinks_are_not_independent_backup_evidence(self):
        original = self.root / "original"
        (original / "world").mkdir(parents=True)
        (original / "world/level.dat").write_bytes(b"world")
        restored = self.root / "restored"
        (restored / "world").mkdir(parents=True)
        (restored / "world/level.dat").hardlink_to(original / "world/level.dat")
        proof = self.root / "proof.json"
        with self.assertRaisesRegex(ValueError, "hard-linked"):
            restore.verify_copy(original, restored, proof)
        alias = self.root / "alias"
        alias.symlink_to(original)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            restore.verify_copy(alias, restored, proof)
        self.assertFalse(proof.exists())

    def test_database_inventory_reports_counts_without_private_values(self):
        database = self.root / "storm.db"
        with closing(sqlite3.connect(database)) as connection:
            connection.execute("CREATE TABLE ticket (id TEXT, private_content TEXT)")
            connection.execute("INSERT INTO ticket VALUES ('operator', 'private-fixture-value')")
            connection.commit()
        output = self.root / "inventory.json"
        restore.database_inventory(database, output)
        text = output.read_text()
        self.assertNotIn("private-fixture-value", text)
        self.assertEqual(json.loads(text)["tables"]["ticket"]["rows"], 1)

    def test_verified_backup_requires_the_complete_volume_and_unchanged_readback(self):
        original = self.root / "original"
        (original / "world").mkdir(parents=True)
        (original / "plugins/TheStorm").mkdir(parents=True)
        (original / "world/level.dat").write_bytes(b"world")
        (original / "plugins/TheStorm/the-storm.db").write_bytes(b"identity")
        restored = self.root / "restored"
        shutil.copytree(original, restored)
        proof = self.root / "verified.json"
        restore.verify_copy(original, restored, proof)
        self.assertEqual(restore.verified_backup(restored, proof), restore.fingerprint(original))
        (restored / "plugins/TheStorm/the-storm.db").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed after verification"):
            restore.verified_backup(restored, proof)
        self.assertEqual((original / "plugins/TheStorm/the-storm.db").read_bytes(), b"identity")

    def test_partial_backup_and_unverified_receipt_cannot_supply_arenas(self):
        data = self.root / "data"
        data.mkdir()
        (data / "arena.dat").write_bytes(b"fixture")
        proof = self.root / "proof.json"
        restore.save_json(proof, {"schemaVersion": 1, "status": "VERIFIED", "files": restore.fingerprint(data)})
        with self.assertRaisesRegex(ValueError, "whole Storm data volume"):
            restore.verified_backup(data, proof)
        restore.save_json(proof, {"schemaVersion": 1, "status": "Completed", "files": restore.fingerprint(data)})
        with self.assertRaisesRegex(ValueError, "verified independent"):
            restore.verified_backup(data, proof)
        link = self.root / "alias"
        link.symlink_to(data)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            restore.verified_backup(link, proof)

    def test_verified_selective_export_requires_complete_selection_and_sealed_whole_volume_proof(self):
        data = self.root / "native-data"
        (data / "world/dimensions/minecraft/rwf/region").mkdir(parents=True)
        (data / "plugins/TheStorm").mkdir(parents=True)
        for name in (
            "world/level.dat",
            "world/dimensions/minecraft/rwf/region/r.0.0.mca",
            "plugins/TheStorm/the-storm.db",
        ):
            (data / name).write_bytes(b"fixture")
        hashes = restore.fingerprint(data)
        whole = self.root / "whole.json"
        identities = {
            "requestId": "request",
            "backupUid": "backup",
            "sourceVolumeUid": "original",
            "restoredVolumeUid": "independent",
        }
        restore.save_json(
            whole,
            {
                "schemaVersion": 1,
                "status": "VERIFIED",
                **identities,
                "files": {**hashes, "server.properties": "a" * 64},
            },
        )
        proof = self.root / "export.json"
        receipt = {
            "schemaVersion": 2,
            "status": "VERIFIED_EXPORT",
            **identities,
            "wholeVolumeProofPath": str(whole),
            "wholeVolumeProofSha256": restore.digest(whole),
            "files": hashes,
        }
        restore.save_json(proof, receipt)
        self.assertEqual(restore.verified_backup(data, proof), hashes)
        for change in ("partial", "different-volume", "altered-whole-proof", "unrelated-local-file"):
            with self.subTest(change=change):
                altered = dict(receipt)
                if change == "partial":
                    altered["files"] = {name: value for name, value in hashes.items() if "rwf" not in name}
                elif change == "different-volume":
                    altered["restoredVolumeUid"] = "original"
                elif change == "altered-whole-proof":
                    altered["wholeVolumeProofSha256"] = "f" * 64
                else:
                    (data / "server.properties").write_bytes(b"unrequested file")
                restore.save_json(proof, altered)
                with self.assertRaises(ValueError):
                    restore.verified_backup(data, proof)

    def test_export_selection_excludes_credentials_player_progression_and_unsupported_paths(self):
        allowed = (
            "world/level.dat",
            "plugins/TheStorm/the-storm.db",
            "plugins/TheStorm/the-storm.db-wal",
            "world/data/minecraft/maps/last_id.dat",
            "world/dimensions/minecraft/rwf/poi/r.-1.0.mca",
            "world/dimensions/minecraft/settlement/region/c.1.-2.mcc",
        )
        excluded = (
            "server.properties",
            "plugins/TheStorm/config.yml",
            "plugins/floodgate/key.pem",
            "world/players/data/modern-player.dat",
            "world/dimensions/minecraft/rwf/paper-world.yml",
            "world/datapacks/config.json",
        )
        files = {name: "a" * 64 for name in (*allowed, *excluded)}
        self.assertEqual(set(restore.backup_contract.selected_files(files)), set(allowed))
        for name, checksum in (
            ("../outside", "a" * 64),
            ("/absolute", "a" * 64),
            ("world//level.dat", "a" * 64),
            ("world/level.dat", "bad"),
            ("world/level.dat", 12),
            ("world/dimensions/minecraft/unknown/region/r.0.0.mca", "a" * 64),
        ):
            with self.subTest(name=name, checksum=checksum), self.assertRaises(ValueError):
                restore.backup_contract.selected_files({**files, name: checksum})

    def activation_fixture(self):
        staging, modern = self.root / "stage", self.root / "modern"
        source = staging / "arena-preserved-layout/world"
        (source / "dimensions/minecraft/overworld/region").mkdir(parents=True)
        (source / "level.dat").write_bytes(b"historical metadata")
        (source / "dimensions/minecraft/overworld/region/r.0.0.mca").write_bytes(b"protected terrain")
        restore.save_json(staging / "arena-preserved-layout-files.json", restore.fingerprint(source))
        (modern / "world").mkdir(parents=True)
        (modern / "world/level.dat").write_bytes(b"modern metadata")
        (modern / "plugins/TheStorm").mkdir(parents=True)
        (modern / "plugins/TheStorm/the-storm.db").write_bytes(b"modern identity")
        for name in ("settlement", "rustworks", "rwf", "wilds", "peaks", "mining"):
            dimension = modern / "world/dimensions/minecraft" / name
            (dimension / "data/paper").mkdir(parents=True)
            (dimension / "region").mkdir()
            (dimension / "data/paper/metadata.dat").write_bytes(name.encode())
            (dimension / "region/r.0.0.mca").write_bytes((name + " terrain").encode())
        proof = self.root / "backup.json"
        restore.save_json(proof, {"schemaVersion": 1, "status": "VERIFIED", "files": restore.fingerprint(modern)})
        candidate, paper, bootstrap = self.root / "candidate.jar", self.root / "paper.jar", self.root / "bootstrap"
        candidate.write_bytes(b"candidate")
        paper.write_bytes(b"paper")
        bootstrap.mkdir()
        database_root = staging / "restoration-database"
        database_root.mkdir()
        database_proof = lock_fixture(staging, database_root / "the-storm.db", "fixture-request")
        restore.save_json(
            database_root / "receipt.json",
            {
                **database_proof,
                "townImport": "VERIFIED",
                "databaseSha256": restore.digest(database_root / "the-storm.db"),
            },
        )
        inputs = {candidate.name: restore.digest(candidate), proof.name: restore.digest(proof)}
        receipt = {
            "phase": "IDENTITY_DATABASE_READY",
            "archiveSha256": restore.ARCHIVE_SHA256,
            "requestId": "fixture-request",
            "arenaTransplantInputs": inputs,
            "databaseInputs": inputs,
            "databaseReceiptSha256": restore.digest(database_root / "receipt.json"),
        }
        restore.save_json(staging / restore.JOURNAL, receipt)
        return staging, paper, bootstrap, candidate, modern, proof

    def test_native_layout_fork_keeps_original_receipts_and_exact_unticked_bytes(self):
        original, new = self.root / "old", self.root / "new"
        world = original / "native-layout-rehearsal/world"
        world.mkdir(parents=True)
        (world / "level.dat").write_bytes(b"unticked converted archive")
        restore.save_json(original / "native-layout-rehearsal-files.json", restore.fingerprint(world))
        restore.save_json(original / "native-layout-metadata-receipt.json", {"worldTicks": 0})
        restore.save_json(original / "source-chunks.json", {"0,0": 2})
        restore.save_json(
            original / restore.JOURNAL,
            {
                "phase": "ACTIVATION_LAYOUT_READY",
                "archiveSha256": restore.ARCHIVE_SHA256,
                "requestId": "fixture-request",
                "nativeLayoutReceiptSha256": restore.digest(original / "native-layout-metadata-receipt.json"),
                "arenaRetentionMode": "old",
                "activationReceiptSha256": "old",
            },
        )
        before = restore.fingerprint(original)
        restore.fork_native_layout(original, new)
        self.assertEqual(restore.fingerprint(original), before)
        self.assertEqual(restore.fingerprint(new / "native-layout-rehearsal/world"), restore.fingerprint(world))
        journal = JsonObject.parse((new / restore.JOURNAL).read_bytes())
        self.assertEqual(journal["phase"], "NATIVE_LAYOUT_REHEARSED")
        self.assertNotIn("arenaRetentionMode", journal)
        self.assertNotIn("activationReceiptSha256", journal)
        with self.assertRaises(ValueError):
            restore.fork_native_layout(original, new)
        (world / "level.dat").write_bytes(b"corruption")
        with self.assertRaises(ValueError):
            restore.fork_native_layout(original, self.root / "refused")
        self.assertFalse((self.root / "refused").exists())

    def test_separate_arena_retention_and_activation_never_overlay_the_main_world(self):
        arguments = self.activation_fixture()
        staging, _, _, candidate, modern, proof = arguments
        (staging / "arena-preserved-layout").rename(staging / "heritage-preserved-layout")
        (staging / "arena-preserved-layout-files.json").rename(staging / "heritage-preserved-layout-files.json")
        journal = JsonObject.parse((staging / restore.JOURNAL).read_bytes())
        journal["phase"] = "NATIVE_HERITAGE_PRESERVED"
        converter = Path(__file__).parent / "conversion/NativePreservationCheckpoint.java"
        journal["preservationInputs"] = {"catalog": "f" * 64, "converter": restore.digest(converter)}
        preserved = staging / "heritage-preservation-receipt.json"
        restore.save_json(
            preserved,
            {"preservedChunks": restore.EXPECTED_CHUNKS, "dataVersion": 4903, "terrainChanged": False, "worldTicks": 0},
        )
        journal["preservationReceiptSha256"] = restore.digest(preserved)
        restore.save_json(staging / restore.JOURNAL, journal)
        before = restore.fingerprint(modern)
        restore.retain_arena_worlds(staging, candidate, modern, proof)
        journal = JsonObject.parse((staging / restore.JOURNAL).read_bytes())
        self.assertEqual(journal["arenaRetentionMode"], "SEPARATE_WORLDS")
        journal["phase"] = "IDENTITY_DATABASE_READY"
        restore.save_json(staging / restore.JOURNAL, journal)
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(
                restore, "repair_animal_identities", return_value=JsonObject({"beforeFiles": {}, "afterFiles": {}})
            ),
            patch.object(restore, "run_activation_check", return_value={"status": "VERIFIED"}),
        ):
            restore.prepare_activation(*arguments)
        self.assertEqual(
            (staging / "activation-layout/world/dimensions/minecraft/overworld/region/r.0.0.mca").read_bytes(),
            b"protected terrain",
        )
        self.assertEqual(restore.fingerprint(modern), before)
        facts = JsonObject.parse((staging / "activation-layout-receipt.json").read_bytes())
        self.assertIs(facts["overworldOverlay"], False)
        for name in ("settlement", "rustworks", "rwf"):
            self.assertEqual(
                restore.fingerprint(staging / "activation-layout/world/dimensions/minecraft" / name),
                restore.fingerprint(modern / "world/dimensions/minecraft" / name),
            )

    def test_activation_assembly_preserves_arena_dimensions_and_historical_data_without_modern_resource_worlds(self):
        arguments = self.activation_fixture()
        staging, _, _, _, modern, _ = arguments
        before = restore.fingerprint(modern)
        native = {
            "status": "VERIFIED",
            "dataVersion": 4903,
            "entityUuidCollisions": [],
            "terrainGeneration": False,
            "worldTicks": 0,
        }
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(
                restore, "repair_animal_identities", return_value=JsonObject({"beforeFiles": {}, "afterFiles": {}})
            ),
            patch.object(restore, "run_activation_check", return_value=native) as verification,
        ):
            restore.prepare_activation(*arguments)
        verification.assert_called_once()
        assembled = staging / "activation-layout"
        self.assertEqual((assembled / "world/level.dat").read_bytes(), b"historical metadata")
        self.assertEqual(
            (assembled / "plugins/TheStorm/the-storm.db").read_bytes(),
            (staging / "restoration-database/the-storm.db").read_bytes(),
        )
        for name in ("settlement", "rustworks", "rwf"):
            self.assertEqual(
                restore.fingerprint(assembled / "world/dimensions/minecraft" / name),
                restore.fingerprint(modern / "world/dimensions/minecraft" / name),
            )
        for name in ("wilds", "peaks", "mining"):
            self.assertFalse((assembled / "world/dimensions/minecraft" / name).exists())
        self.assertEqual(restore.fingerprint(modern), before)
        journal = json.loads((staging / restore.JOURNAL).read_text())
        self.assertEqual(journal["phase"], "ACTIVATION_LAYOUT_READY")
        self.assertEqual(journal["activationReceiptSha256"], restore.digest(staging / "activation-layout-receipt.json"))
        self.assertEqual(
            restore.fingerprint(assembled), json.loads((staging / "activation-layout-files.json").read_text())
        )

    def test_activation_assembly_keeps_a_failed_private_layout_and_never_marks_it_ready(self):
        arguments = self.activation_fixture()
        staging = arguments[0]
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(
                restore, "repair_animal_identities", return_value=JsonObject({"beforeFiles": {}, "afterFiles": {}})
            ),
            patch.object(restore, "run_activation_check", side_effect=ValueError("entity UUID collision")),
            self.assertRaisesRegex(ValueError, "UUID collision"),
        ):
            restore.prepare_activation(*arguments)
        self.assertTrue((staging / "activation-layout/world").is_dir())
        self.assertEqual(json.loads((staging / restore.JOURNAL).read_text())["phase"], "ACTIVATION_PREPARATION_FAILED")
        self.assertFalse((staging / "activation-layout-receipt.json").exists())

    def test_activation_records_only_verified_animal_region_changes(self):
        arguments = self.activation_fixture()
        staging = arguments[0]
        native = {"status": "VERIFIED", "dataVersion": 4903, "entityUuidCollisions": []}

        def repair(world: Path, _modern: Path, _root: Path, _classpath: str) -> JsonObject:
            region = world / "dimensions/minecraft/overworld/region/r.0.0.mca"
            original = restore.digest(region)
            region.write_bytes(b"same terrain with a repaired duplicate animal identity")
            return JsonObject(
                {"beforeFiles": {region.name: original}, "afterFiles": {region.name: restore.digest(region)}}
            )

        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore, "repair_animal_identities", side_effect=repair),
            patch.object(restore, "run_activation_check", return_value=native),
        ):
            restore.prepare_activation(*arguments)
        self.assertEqual(
            (staging / "arena-preserved-layout/world/dimensions/minecraft/overworld/region/r.0.0.mca").read_bytes(),
            b"protected terrain",
        )
        proof = json.loads((staging / "activation-layout-receipt.json").read_text())
        self.assertEqual(set(proof["animalIdentityRepair"]["beforeFiles"]), {"r.0.0.mca"})

    def test_activation_refuses_unsealed_or_unrelated_animal_repair_changes(self):
        for change in ("wrong-baseline", "wrong-readback", "unrelated-data", "unsafe-owned-animal"):
            with self.subTest(change=change):
                original_root = self.root
                self.root = original_root / change
                self.root.mkdir()
                try:
                    arguments = self.activation_fixture()

                    def repair(
                        world: Path, _modern: Path, _root: Path, _classpath: str, change: str = change
                    ) -> JsonObject:
                        if change == "unsafe-owned-animal":
                            raise ValueError("Review animal ownership")
                        region = world / "dimensions/minecraft/overworld/region/r.0.0.mca"
                        baseline = restore.digest(region)
                        region.write_bytes(b"repaired identity")
                        if change == "unrelated-data":
                            (world / "level.dat").write_bytes(b"unrelated change")
                        return JsonObject(
                            {
                                "beforeFiles": {region.name: "f" * 64 if change == "wrong-baseline" else baseline},
                                "afterFiles": {
                                    region.name: "f" * 64 if change == "wrong-readback" else restore.digest(region)
                                },
                            }
                        )

                    with (
                        patch.object(restore, "conversion_classpath", return_value="fixture"),
                        patch.object(restore, "repair_animal_identities", side_effect=repair),
                        patch.object(restore, "run_activation_check", return_value={"status": "VERIFIED"}),
                        self.assertRaises(ValueError),
                    ):
                        restore.prepare_activation(*arguments)
                    journal = json.loads((arguments[0] / restore.JOURNAL).read_text())
                    self.assertEqual(journal["phase"], "ACTIVATION_PREPARATION_FAILED")
                    self.assertFalse((arguments[0] / "activation-layout-receipt.json").exists())
                finally:
                    self.root = original_root

    def test_activation_refuses_missing_dimensions_candidate_database_and_checkpoint_drift_before_writing(self):
        for change in ("candidate", "database", "terrain", "phase", "missing-rwf"):
            with self.subTest(change=change):
                original_root = self.root
                self.root = original_root / change
                self.root.mkdir()
                try:
                    arguments = self.activation_fixture()
                    staging, _, _, candidate, modern, proof = arguments
                    if change == "candidate":
                        candidate.write_bytes(b"different candidate")
                    elif change == "database":
                        (staging / "restoration-database/the-storm.db").write_bytes(b"corruption")
                    elif change == "terrain":
                        (staging / "arena-preserved-layout/world/level.dat").write_bytes(b"corruption")
                    else:
                        journal = json.loads((staging / restore.JOURNAL).read_text())
                        if change == "phase":
                            journal["phase"] = "ARENAS_PRESERVED"
                        else:
                            shutil.rmtree(modern / "world/dimensions/minecraft/rwf")
                            restore.save_json(
                                proof, {"schemaVersion": 1, "status": "VERIFIED", "files": restore.fingerprint(modern)}
                            )
                            for key in ("arenaTransplantInputs", "databaseInputs"):
                                journal[key][proof.name] = restore.digest(proof)
                        restore.save_json(staging / restore.JOURNAL, journal)
                    with (
                        patch.object(restore, "conversion_classpath", return_value="fixture"),
                        self.assertRaises(ValueError),
                    ):
                        restore.prepare_activation(*arguments)
                    self.assertFalse((staging / "activation-layout").exists())
                finally:
                    self.root = original_root

    def converter(self, lines: list[str]):
        script = self.root / "fake-paper.py"
        script.write_text(
            "import sys\n"
            + "\n".join(f"print({line!r}, flush=True)" for line in lines)
            + "\ncommand = sys.stdin.readline()\n"
            + "print('clean stop' if command == 'stop\\n' else 'bad stop', flush=True)\n"
        )
        original = subprocess.Popen

        def process(
            _command: list[str],
            *,
            cwd: Path,
            stdin: int,
            stdout: int,
            stderr: int,
            text: Literal[True],
            bufsize: int,
        ) -> subprocess.Popen[str]:
            return original(
                [sys.executable, str(script)],
                cwd=cwd,
                stdin=stdin,
                stdout=stdout,
                stderr=stderr,
                text=text,
                bufsize=bufsize,
            )

        return patch.object(restore.subprocess, "Popen", side_effect=process)

    def test_converter_requires_frozen_guard_and_clean_shutdown(self):
        lines = [
            "CONVERSION_GUARD_READY: ready",
            'Preparing level "world"',
            "CONVERSION_GUARD_VERIFIED: frozen=true; players=0",
            "Done (1s)!",
        ]
        with self.converter(lines):
            restore.run_converter(self.root, self.root / "paper.jar", self.root / "converter.log", 5)
        self.assertIn("clean stop", (self.root / "converter.log").read_text())

    def test_converter_refuses_missing_guard_before_world_initialization(self):
        with self.converter(['Preparing level "world"']), self.assertRaisesRegex(ValueError, "preceded"):
            restore.run_converter(self.root, self.root / "paper.jar", self.root / "converter.log", 5)

    def test_converter_keeps_error_log_and_stops_the_copy(self):
        with (
            self.converter(["CONVERSION_GUARD_READY: ready", "[server ERROR]: save failed"]),
            self.assertRaisesRegex(ValueError, "conversion error"),
        ):
            restore.run_converter(self.root, self.root / "paper.jar", self.root / "converter.log", 5)
        log = (self.root / "converter.log").read_text()
        self.assertIn("save failed", log)
        self.assertIn("clean stop", log)

    def test_converter_times_out_when_freeze_cannot_be_verified(self):
        with self.converter(["CONVERSION_GUARD_READY: ready", "Done (1s)!"]), self.assertRaises(TimeoutError):
            restore.run_converter(self.root, self.root / "paper.jar", self.root / "converter.log", 0.1)

    def test_converter_configuration_has_no_external_admission_or_gameplay_plugins(self):
        guard = self.root / "guard.jar"
        guard.write_bytes(b"fixture guard")
        restore.conversion_configuration(self.root, guard)
        settings = (self.root / "server.properties").read_text()
        for setting in [
            "server-ip=127.0.0.1",
            "max-players=0",
            "enforce-whitelist=true",
            "enable-rcon=false",
            "enable-query=false",
            "allow-nether=false",
        ]:
            self.assertIn(setting, settings)
        with self.assertRaisesRegex(ValueError, "must be empty"):
            restore.conversion_configuration(self.root, guard)

    def test_all_converters_refuse_the_wrong_checkpoint_without_writing(self):
        paper = self.root / "paper.jar"
        paper.write_bytes(b"fixture")
        guard = self.root / "guard.jar"
        guard.write_bytes(b"fixture")
        bootstrap = self.root / "bootstrap"
        bootstrap.mkdir()
        journal = {"phase": "UNAPPROVED", "archiveSha256": restore.ARCHIVE_SHA256}
        restore.save_json(self.root / restore.JOURNAL, journal)
        operations = [
            (restore.convert_legacy, (self.root, paper, guard)),
            (restore.convert_companions, (self.root, paper)),
            (restore.convert_native_chunks, (self.root, paper, bootstrap)),
            (restore.convert_native_companions, (self.root, paper, bootstrap)),
            (restore.convert_native_auxiliary, (self.root, paper, bootstrap)),
            (restore.rehearse_native_layout, (self.root, paper, bootstrap, guard)),
        ]
        before = restore.fingerprint(self.root)
        for operation, arguments in operations:
            with self.subTest(operation=operation.__name__), self.assertRaises(ValueError):
                operation(*arguments)
        self.assertEqual(restore.fingerprint(self.root), before)

    def test_native_companion_refuses_changed_input_before_starting_java(self):
        paper = self.root / "paper.jar"
        paper.write_bytes(b"fixture")
        bootstrap = self.root / "bootstrap"
        bootstrap.mkdir()
        restore.save_json(
            self.root / restore.JOURNAL, {"phase": "NATIVE_CHUNKS_CONVERTED", "archiveSha256": restore.ARCHIVE_SHA256}
        )
        for directory, manifest in (
            ("source", "source-files.json"),
            ("companion-data-1.21.7", "companion-data-1.21.7-files.json"),
            ("native-chunks-26.2", "native-chunks-26.2-files.json"),
        ):
            root = self.root / directory
            root.mkdir()
            (root / "fixture").write_bytes(b"unchanged")
            restore.save_json(self.root / manifest, restore.fingerprint(root))
        (self.root / "native-chunks-26.2/fixture").write_bytes(b"corrupted")
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore.subprocess, "run") as launching,
            self.assertRaisesRegex(ValueError, "input changed"),
        ):
            restore.convert_native_companions(self.root, paper, bootstrap)
        launching.assert_not_called()
        self.assertEqual(json.loads((self.root / restore.JOURNAL).read_text())["phase"], "NATIVE_CHUNKS_CONVERTED")

    def test_staging_journal_rejects_an_independent_writer(self):
        worker = (
            "import fcntl,pathlib,sys\n"
            "with (pathlib.Path(sys.argv[1])/'.restore-operation.lock').open('w+b') as lock:\n"
            " fcntl.lockf(lock,fcntl.LOCK_EX)\n"
            " print('locked',flush=True)\n"
            " sys.stdin.readline()\n"
        )
        with subprocess.Popen(
            [sys.executable, "-c", worker, str(self.root)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
        ) as process:
            if process.stdout is None:
                self.fail("Fixture lock worker has no output pipe")
            self.assertEqual(process.stdout.readline().strip(), "locked")
            with (
                self.assertRaisesRegex(ValueError, "owns this staging journal"),
                restore.operation_lock(self.root),
            ):
                self.fail("Two independent writers acquired the same journal")
            process.communicate("release\n", timeout=5)
        with restore.operation_lock(self.root):
            self.assertTrue((self.root / ".restore-operation.lock").is_file())

    def test_staging_journal_lock_cannot_follow_a_symlink(self):
        outside = self.root / "outside"
        outside.write_bytes(b"untouched")
        (self.root / ".restore-operation.lock").symlink_to(outside)
        with self.assertRaises(OSError), restore.operation_lock(self.root):
            self.fail("Lock followed a symlink")
        self.assertEqual(outside.read_bytes(), b"untouched")


if __name__ == "__main__":
    unittest.main()

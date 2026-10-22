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
from typing import Any, Literal
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
        for archive_id in restore.ARCHIVES:
            with self.subTest(archive=archive_id), self.assertRaisesRegex(ValueError, "approved source for"):
                restore.prepare(archive, destination, archive_id)
        with self.assertRaisesRegex(ValueError, "Unreviewed archive id"):
            restore.prepare(archive, destination, "main-map3")
        self.assertFalse(destination.exists())

    def region_bytes(self, indices: list[int]) -> bytes:
        block = bytearray(8192 + 4096 * len(indices))
        for sector, index in enumerate(indices, start=2):
            struct.pack_into(">I", block, index * 4, (sector << 8) | 1)
            struct.pack_into(">I", block, sector * 4096, 2)
            block[sector * 4096 + 4 : sector * 4096 + 6] = b"\x02x"
        return bytes(block)

    def terrain_archive(self) -> tuple[Path, Any]:
        """A reviewed terrain-only fixture archive registered for the duration of a test."""
        path = self.root / "map-fixture.zip"
        root = "fixture/world/"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(root + "level.dat", b"legacy level")
            archive.writestr(root + "uid.dat", b"0123456789abcdef")
            archive.writestr(root + "playerdata/00000000-0000-0000-0000-000000000001.dat", b"player")
            archive.writestr(root + "region/r.0.0.mca", self.region_bytes([0, 1]))
            archive.writestr(root + "region/r.-1.-1.mca", self.region_bytes([1023]))
        fixture = restore.Archive("fixture-map", restore.digest(path), root, 3, 1, "fixture")
        patcher = patch.dict(restore.ARCHIVES, {fixture.id: fixture})
        patcher.start()
        self.addCleanup(patcher.stop)
        return path, fixture

    def test_prepare_records_the_selected_archive_and_target_dimension(self):
        path, fixture = self.terrain_archive()
        staging = self.root / "stage"
        restore.prepare(path, staging, fixture.id)
        journal = json.loads((staging / restore.JOURNAL).read_text())
        self.assertEqual(
            {key: journal[key] for key in ("schemaVersion", "phase", "archiveId", "archiveSha256", "targetDimension")},
            {
                "schemaVersion": 2,
                "phase": "PREPARED",
                "archiveId": "fixture-map",
                "archiveSha256": fixture.sha256,
                "targetDimension": "fixture",
            },
        )
        self.assertEqual(set(json.loads((staging / "source-chunks.json").read_text())), {"0,0", "1,0", "-1,-1"})
        self.assertIs(restore.journal_archive(journal), fixture)

    def test_journal_archive_selection_is_explicit_and_hash_bound(self):
        self.assertIs(restore.journal_archive({"archiveSha256": restore.ARCHIVE_SHA256}), restore.PRIMARY)
        map2 = restore.ARCHIVES["main-map2-2016-01-10"]
        selected = {"schemaVersion": 2, "archiveId": map2.id, "archiveSha256": map2.sha256, "targetDimension": "map2"}
        self.assertIs(restore.journal_archive(selected), map2)
        self.assertFalse(map2.primary)
        self.assertEqual(map2.timeout_scale, 3)
        for receipt in (
            {"archiveSha256": map2.sha256},
            {"archiveId": map2.id, "archiveSha256": map2.sha256, "targetDimension": "map2"},
            {**selected, "archiveSha256": restore.ARCHIVE_SHA256},
            {**selected, "targetDimension": "overworld"},
            {**selected, "archiveId": "main-map3"},
        ):
            with self.subTest(receipt=receipt), self.assertRaises(ValueError):
                restore.journal_archive(receipt)

    def terrain_journal(self, phase: str) -> dict[str, Any]:
        map2 = restore.ARCHIVES["main-map2-2016-01-10"]
        journal = {
            "schemaVersion": 2,
            "phase": phase,
            "archiveId": map2.id,
            "archiveSha256": map2.sha256,
            "targetDimension": map2.dimension,
            "requestId": "00000000-0000-0000-0000-000000000002",
        }
        restore.save_json(self.root / restore.JOURNAL, journal)
        return journal

    def test_terrain_only_archive_refuses_primary_player_and_activation_phases(self):
        inputs = Path(tempfile.mkdtemp(dir=self.root.parent))
        self.addCleanup(shutil.rmtree, inputs)
        paper, candidate, proof = inputs / "paper.jar", inputs / "candidate.jar", inputs / "backup.json"
        for path in (paper, candidate, proof):
            path.write_bytes(b"fixture")
        bootstrap = inputs / "bootstrap"
        bootstrap.mkdir()
        operations = [
            ("LEGACY_CHUNKS_CONVERTED", restore.convert_companions, (self.root, paper)),
            ("NATIVE_CHUNKS_CONVERTED", restore.convert_native_companions, (self.root, paper, bootstrap)),
            ("COMPANION_DATA_CONVERTED", restore.convert_native_chunks, (self.root, paper, bootstrap)),
            ("NATIVE_COMPANION_DATA_CONVERTED", restore.convert_native_auxiliary, (self.root, paper, bootstrap)),
            ("NATIVE_HERITAGE_PRESERVED", restore.retain_arena_worlds, (self.root, candidate, bootstrap, proof)),
            ("NATIVE_LAYOUT_REHEARSED", restore.restart_companions, (self.root,)),
        ]
        for phase, operation, arguments in operations:
            self.terrain_journal(phase)
            before = restore.fingerprint(self.root)
            with self.subTest(operation=operation.__name__), self.assertRaisesRegex(ValueError, "requires"):
                operation(*arguments)
            self.assertEqual(restore.fingerprint(self.root), before)

    def test_terrain_only_archive_skips_player_conversion_between_terrain_checkpoints(self):
        paper = self.root / "paper.jar"
        paper.write_bytes(b"fixture")
        bootstrap = self.root / "bootstrap"
        bootstrap.mkdir()
        for phase, operation in (
            ("LEGACY_CHUNKS_CONVERTED", restore.convert_native_chunks),
            ("NATIVE_CHUNKS_CONVERTED", restore.convert_native_auxiliary),
        ):
            self.terrain_journal(phase)
            with self.subTest(phase=phase), self.assertRaisesRegex(ValueError, "exact pinned Paper"):
                operation(self.root, paper, bootstrap)

    def test_chunk_extent_reports_bounding_and_continuous_origin_square(self):
        square = {f"{x},{z}" for x in range(-3, 3) for z in range(-3, 3)}
        self.assertEqual(
            restore.chunk_extent(square),
            {
                "chunks": 36,
                "chunkBounds": {"minX": -3, "maxX": 2, "minZ": -3, "maxZ": 2},
                "boundingRadius": 48,
                "continuousRadius": 48,
                "continuousChunks": 36,
            },
        )
        # A single gap in the third ring stops continuity there; far outliers only move the bounding radius.
        holed = (square - {"2,-1"}) | {"40,0", "-7,-100"}
        extent = restore.chunk_extent(holed)
        self.assertEqual(extent["boundingRadius"], 1600)
        self.assertEqual(extent["continuousRadius"], 32)
        self.assertEqual(extent["continuousChunks"], 16)
        self.assertEqual(restore.chunk_extent({"5,5"})["continuousRadius"], 0)
        with self.assertRaises(ValueError):
            restore.chunk_extent([])

    def test_circular_extent_measures_from_the_origin_corner_to_chunk_edges(self):
        square = {f"{x},{z}" for x in range(-3, 3) for z in range(-3, 3)}
        # The nearest missing chunk, 3,0, starts 48 blocks east; the farthest corner is 48*sqrt(2).
        self.assertEqual(
            restore.chunk_extent_circle(square),
            {
                "chunks": 36,
                "continuousRadius": 48,
                "coverage": {share: {"radius": 68, "chunksOutside": 0} for share in ("100%", "99.99%", "99.9%")},
            },
        )
        # A missing corner chunk 2,2 is 32*sqrt(2) away; whole-block radii round inward.
        holed = restore.chunk_extent_circle((square - {"2,2"}) | {"40,0"})
        self.assertEqual(holed["continuousRadius"], 45)
        self.assertEqual(holed["coverage"]["100%"], {"radius": 657, "chunksOutside": 0})
        self.assertEqual(restore.chunk_extent_circle({"5,5"})["continuousRadius"], 0)
        with self.assertRaises(ValueError):
            restore.chunk_extent_circle([])

    def test_circular_coverage_reports_outliers_outside_each_share(self):
        field = {f"{x},{z}" for x in range(-50, 50) for z in range(-50, 50)} | {"400,0"}
        extent = restore.chunk_extent_circle(field)
        self.assertEqual(extent["chunks"], 10_001)
        self.assertEqual(extent["continuousRadius"], 800)
        self.assertEqual(
            extent["coverage"],
            {
                "100%": {"radius": 6417, "chunksOutside": 0},
                "99.99%": {"radius": 1132, "chunksOutside": 1},
                "99.9%": {"radius": 1121, "chunksOutside": 5},
            },
        )

    def test_archive_chunk_extent_reads_headers_without_extracting(self):
        path, fixture = self.terrain_archive()
        before = set(self.root.iterdir())
        inventory = restore.archive_chunk_inventory(path, fixture.id)
        self.assertEqual(set(inventory), {"0,0", "1,0", "-1,-1"})
        self.assertEqual(restore.chunk_extent(inventory)["continuousRadius"], 0)
        self.assertEqual(set(self.root.iterdir()), before)
        path.write_bytes(path.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "approved source"):
            restore.archive_chunk_inventory(path, fixture.id)

    def dimension_fixture(self) -> Path:
        staging = self.root / "stage"
        world = staging / "heritage-preserved-layout/world"
        dimension = world / "dimensions/minecraft/overworld"
        for name in (
            "region/r.0.0.mca",
            "entities/r.0.0.mca",
            "poi/r.0.0.mca",
        ):
            (dimension / name).parent.mkdir(parents=True, exist_ok=True)
            (dimension / name).write_bytes(self.region_bytes([0, 1]))
        for name in (
            "data/paper/metadata.dat",
            "data/paper/level_overrides.dat",
            "data/minecraft/world_gen_settings.dat",
            "data/minecraft/game_rules.dat",
        ):
            (dimension / name).parent.mkdir(parents=True, exist_ok=True)
            (dimension / name).write_bytes(name.encode())
        (dimension / "paper-world.yml").write_text("server configuration\n")
        (world / "level.dat").write_bytes(b"terrain-only level")
        restore.save_json(staging / "heritage-preserved-layout-files.json", restore.fingerprint(world))
        restore.save_json(staging / "source-chunks.json", {"0,0": 2, "1,0": 2})
        restore.save_json(
            staging / "heritage-preservation-receipt.json", {"catalogSha256": "c" * 64, "protectedChunks": 1}
        )
        restore.save_json(
            staging / "native-layout-metadata-receipt.json",
            {"worldUuid": "97cc8be1-4b81-42c4-bc90-9b8bcf7f2423", "seed": 1, "spawn": {"x": 0.5}},
        )
        return staging

    def test_dimension_export_contains_only_native_terrain_and_dimension_metadata(self):
        staging = self.dimension_fixture()
        fixture = restore.Archive("fixture-map", "f" * 64, "fixture/world/", 2, 1, "fixture")
        patcher = patch.dict(restore.ARCHIVES, {fixture.id: fixture})
        patcher.start()
        self.addCleanup(patcher.stop)
        journal = {
            "schemaVersion": 2,
            "phase": "NATIVE_HERITAGE_PRESERVED",
            "archiveId": fixture.id,
            "archiveSha256": fixture.sha256,
            "targetDimension": "fixture",
            "requestId": "fixture-request",
            "preservationReceiptSha256": restore.digest(staging / "heritage-preservation-receipt.json"),
            "nativeLayoutReceiptSha256": restore.digest(staging / "native-layout-metadata-receipt.json"),
        }
        restore.save_json(staging / restore.JOURNAL, journal)
        source = staging / "heritage-preserved-layout/world/dimensions/minecraft/overworld"
        before = restore.fingerprint(staging / "heritage-preserved-layout")
        restore.export_dimension(staging)
        exported = staging / "dimension-export/world/dimensions/minecraft/fixture"
        expected = {name: value for name, value in restore.fingerprint(source).items() if name != "paper-world.yml"}
        self.assertEqual(restore.fingerprint(exported), expected)
        self.assertEqual(restore.fingerprint(staging / "heritage-preserved-layout"), before)
        receipt = json.loads((staging / "dimension-export-receipt.json").read_text())
        self.assertEqual(
            {key: receipt[key] for key in ("status", "dimension", "installPath", "chunks", "playersImported")},
            {
                "status": "VERIFIED",
                "dimension": "fixture",
                "installPath": "world/dimensions/minecraft/fixture",
                "chunks": 2,
                "playersImported": False,
            },
        )
        journal = json.loads((staging / restore.JOURNAL).read_text())
        self.assertEqual(journal["phase"], "DIMENSION_EXPORT_READY")
        self.assertEqual(
            journal["dimensionExportReceiptSha256"], restore.digest(staging / "dimension-export-receipt.json")
        )
        with self.assertRaisesRegex(ValueError, "requires"):
            restore.export_dimension(staging)

    def dimension_lock_fixture(self) -> tuple[Path, Path, Path, Path, Path]:
        staging = self.root / "stage"
        dimension = staging / "dimension-export/world/dimensions/minecraft/map2"
        (dimension / "region").mkdir(parents=True)
        (dimension / "region/r.0.0.mca").write_bytes(self.region_bytes([0]))
        restore.save_json(staging / "dimension-export-files.json", restore.fingerprint(dimension))
        (staging / "source/world/playerdata").mkdir(parents=True)
        (staging / "source/world/playerdata/player.dat").write_bytes(b"archived name")
        restore.save_json(staging / "source-files.json", restore.fingerprint(staging / "source"))
        restore.save_json(staging / "dimension-export-receipt.json", {"status": "VERIFIED"})
        journal = self.terrain_journal("DIMENSION_EXPORT_READY")
        journal["dimensionExportReceiptSha256"] = restore.digest(staging / "dimension-export-receipt.json")
        restore.save_json(staging / restore.JOURNAL, journal)
        inputs = self.root / "inputs"
        inputs.mkdir()
        paper, candidate, database = inputs / "paper.jar", inputs / "candidate.jar", inputs / "the-storm.db"
        paper.write_bytes(b"paper")
        candidate.write_bytes(b"candidate")
        (inputs / "bootstrap").mkdir()
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript(
                "CREATE TABLE towns_town(id TEXT PRIMARY KEY, name TEXT, created_at INT, governor_level INT);"
                "CREATE TABLE towns_member(player_id TEXT PRIMARY KEY, town_id TEXT, role TEXT);"
                "INSERT INTO towns_town VALUES('live-town','Livetown',0,0);"
                "INSERT INTO towns_member VALUES('owner','live-town','OWNER');"
                "CREATE TABLE towns_lock(id TEXT PRIMARY KEY, owner_id TEXT);"
                "CREATE TABLE towns_lock_block(world TEXT, x INT, lock_id TEXT);"
                "CREATE TABLE towns_lock_restoration(lock_id TEXT, request_id TEXT);"
                "CREATE TABLE towns_lock_historical_owner(lock_id TEXT, player_id TEXT);"
                "CREATE TABLE towns_lock_trust(lock_id TEXT);"
                "CREATE TABLE economy_balance(player TEXT, balance INT);"
                "INSERT INTO towns_lock VALUES('live','owner');"
                "INSERT INTO towns_lock_block VALUES('world',1,'live');"
                "INSERT INTO economy_balance VALUES('owner',500);"
            )
            connection.commit()
        return staging, paper, inputs / "bootstrap", candidate, database

    def fake_lock_import(self, mutate_other: bool = False):
        def run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            if "additional-towns" in command:
                catalog, world = Path(command[7]), command[9]
                with closing(sqlite3.connect(command[6])) as connection:
                    for town, name, mayor in restore.restoration_regions.active_towns(catalog, world):
                        connection.execute("INSERT INTO towns_town VALUES(?,?,0,0)", (town, name))
                        connection.execute("INSERT INTO towns_member VALUES(?,?,'OWNER')", (mayor, town))
                    connection.commit()
            elif "NativeHistoricalLocks" in command:
                output, request, receipt = Path(command[9]), command[13], Path(command[14])
                with closing(sqlite3.connect(output)) as connection:
                    connection.execute("INSERT INTO towns_lock VALUES('restored','custody')")
                    connection.execute("INSERT INTO towns_lock_block VALUES('map2',2,'restored')")
                    connection.execute("INSERT INTO towns_lock_restoration VALUES('restored',?)", (request,))
                    connection.execute("INSERT INTO towns_lock_historical_owner VALUES('restored','custody')")
                    if mutate_other:
                        connection.execute("UPDATE economy_balance SET balance = 0")
                    connection.commit()
                restore.save_json(
                    receipt,
                    {
                        "requestId": request,
                        "world": "map2",
                        "importMode": "ADDITIONAL",
                        "databaseReadback": "VERIFIED",
                        "worldTicks": 0,
                        "terrainChanged": False,
                        "containerContentsChanged": False,
                        "locks": 1,
                        "containerBlocks": 1,
                        "historicalOwners": 1,
                    },
                )
            return subprocess.CompletedProcess(command, 0)

        return run

    def test_dimension_locks_append_only_the_restored_world_to_a_private_database_copy(self):
        staging, paper, bootstrap, candidate, database = self.dimension_lock_fixture()
        before = database.read_bytes()
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore.subprocess, "run", side_effect=self.fake_lock_import()) as launching,
        ):
            restore.prepare_dimension_locks(staging, paper, bootstrap, candidate, database)
        command = launching.call_args_list[-1].args[0]
        staging = staging.resolve()
        self.assertEqual(
            command[5:10],
            [
                str(staging / "dimension-export/world/dimensions/minecraft/map2"),
                str(staging / "source/world/playerdata"),
                "map2",
                "additional",
                str(staging / "dimension-locks/the-storm.db"),
            ],
        )
        self.assertEqual(database.read_bytes(), before)
        receipt = json.loads((staging / "dimension-locks/receipt.json").read_text())
        self.assertEqual(receipt["addedRows"]["towns_lock_block"], 1)
        self.assertEqual(receipt["databaseSha256"], restore.digest(staging / "dimension-locks/the-storm.db"))
        journal = json.loads((staging / restore.JOURNAL).read_text())
        self.assertEqual(journal["phase"], "DIMENSION_LOCKS_READY")

    def test_export_pruning_supersedes_unpruned_locks_and_feeds_the_pruned_manifest(self):
        staging, paper, bootstrap, candidate, database = self.dimension_lock_fixture()
        region = staging / "dimension-export/world/dimensions/minecraft/map2/region"
        (region / "r.30.0.mca").write_bytes(self.region_bytes([0]))
        restore.save_json(staging / "dimension-export-files.json", restore.fingerprint(region.parent))
        journal = json.loads((staging / restore.JOURNAL).read_text())
        (staging / "dimension-locks").mkdir()
        (staging / "dimension-locks/receipt.json").write_text("{}")
        journal.update(
            phase="DIMENSION_LOCKS_READY",
            dimensionLockInputs={},
            dimensionLockRequestId="old",
            dimensionLocksReceiptSha256="old",
        )
        restore.save_json(staging / restore.JOURNAL, journal)
        restore.prune_export(staging, 12000)
        journal = json.loads((staging / restore.JOURNAL).read_text())
        self.assertEqual(journal["phase"], "DIMENSION_EXPORT_PRUNED")
        self.assertNotIn("dimensionLocksReceiptSha256", journal)
        self.assertTrue((staging / journal["supersededAttempts"][0] / "dimension-locks/receipt.json").is_file())
        self.assertFalse((region / "r.30.0.mca").exists())
        pruned = json.loads((staging / "dimension-pruned-files.json").read_text())
        self.assertEqual(pruned, restore.fingerprint(region.parent))
        proof = json.loads((staging / "dimension-prune-receipt.json").read_text())
        self.assertEqual(proof["result"]["region"]["removedRegionFiles"], ["r.30.0.mca"])
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore.subprocess, "run", side_effect=self.fake_lock_import()),
        ):
            restore.prepare_dimension_locks(staging, paper, bootstrap, candidate, database)
        self.assertEqual(json.loads((staging / restore.JOURNAL).read_text())["phase"], "DIMENSION_LOCKS_READY")
        with self.assertRaisesRegex(ValueError, "unpruned"):
            restore.prune_export(staging, 12000)

    def test_dimension_town_ids_match_the_towns_domain_and_refuse_missing_towns(self):
        # Java: UUID.nameUUIDFromBytes("the-storm:heritage-town:v1:map2-karthil")
        catalog = Path(__file__).with_name("owned") / "plugins/TheStorm/heritage.yml"
        towns = {name: (town, mayor) for town, name, mayor in restore.restoration_regions.active_towns(catalog, "map2")}
        self.assertEqual(towns["Karthil"][0], "6a17bca5-7c95-3df1-b833-e19c5557ed3f")
        staging, paper, bootstrap, candidate, database = self.dimension_lock_fixture()
        locks_only = self.fake_lock_import()

        def without_towns(command: list[str], **options: object) -> subprocess.CompletedProcess[str]:
            if "additional-towns" in command:
                return subprocess.CompletedProcess(command, 0)
            return locks_only(command, **options)

        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore.subprocess, "run", side_effect=without_towns),
            self.assertRaisesRegex(ValueError, "changed other data"),
        ):
            restore.prepare_dimension_locks(staging, paper, bootstrap, candidate, database)

    def test_dimension_locks_refuse_changes_to_other_live_rows(self):
        staging, paper, bootstrap, candidate, database = self.dimension_lock_fixture()
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore.subprocess, "run", side_effect=self.fake_lock_import(mutate_other=True)),
            self.assertRaisesRegex(ValueError, "changed other data"),
        ):
            restore.prepare_dimension_locks(staging, paper, bootstrap, candidate, database)
        self.assertEqual(json.loads((staging / restore.JOURNAL).read_text())["phase"], "DIMENSION_LOCKS_FAILED")
        self.assertFalse((staging / "dimension-locks/receipt.json").exists())

    def test_dimension_export_refuses_player_data_and_the_primary_archive(self):
        staging = self.dimension_fixture()
        world = staging / "heritage-preserved-layout/world"
        (world / "dimensions/minecraft/overworld/players").mkdir()
        (world / "dimensions/minecraft/overworld/players/player.dat").write_bytes(b"player")
        restore.save_json(staging / "heritage-preserved-layout-files.json", restore.fingerprint(world))
        journal = self.terrain_journal("NATIVE_HERITAGE_PRESERVED")
        journal.update(
            preservationReceiptSha256=restore.digest(staging / "heritage-preservation-receipt.json"),
            nativeLayoutReceiptSha256=restore.digest(staging / "native-layout-metadata-receipt.json"),
        )
        restore.save_json(staging / restore.JOURNAL, journal)
        with self.assertRaisesRegex(ValueError, "unexpected or missing"):
            restore.export_dimension(staging)
        self.assertFalse((staging / "dimension-export").exists())
        restore.save_json(
            staging / restore.JOURNAL, {"phase": "NATIVE_HERITAGE_PRESERVED", "archiveSha256": restore.ARCHIVE_SHA256}
        )
        with self.assertRaisesRegex(ValueError, "terrain-only"):
            restore.export_dimension(staging)

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
        for name in (
            "world/level.dat",
            "world/dimensions/minecraft/rwf/region/r.0.0.mca",
            "world/dimensions/minecraft/rwf_lobby/region/r.0.0.mca",
            "world/dimensions/minecraft/rwf_lobby/entities/r.0.0.mca",
            "world/dimensions/minecraft/rwf_lobby/poi/r.0.0.mca",
            "plugins/TheStorm/the-storm.db",
        ):
            (data / name).parent.mkdir(parents=True, exist_ok=True)
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

    def failed_arena_fixture(self):
        staging, modern = self.root / "stage", self.root / "modern"
        source = staging / "heritage-preserved-layout/world"
        source.mkdir(parents=True)
        (source / "level.dat").write_bytes(b"historical fixture")
        restore.save_json(staging / "heritage-preserved-layout-files.json", restore.fingerprint(source))
        shutil.copytree(source, staging / "arena-preserved-layout/world")
        (staging / "arena-transplant.log").write_text("failed before writes\n")
        (modern / "world").mkdir(parents=True)
        (modern / "plugins/TheStorm").mkdir(parents=True)
        (modern / "world/level.dat").write_bytes(b"modern fixture")
        (modern / "plugins/TheStorm/the-storm.db").write_bytes(b"identity fixture")
        proof, candidate = self.root / "backup.json", self.root / "candidate.jar"
        candidate.write_bytes(b"candidate")
        hashes = restore.fingerprint(modern)
        whole = self.root / "whole.json"
        identities = {
            "requestId": "fixture",
            "backupUid": "backup",
            "sourceVolumeUid": "source",
            "restoredVolumeUid": "restored",
        }
        restore.save_json(whole, {"schemaVersion": 1, "status": "VERIFIED", **identities, "files": hashes})
        restore.save_json(
            proof,
            {
                "schemaVersion": 2,
                "status": "VERIFIED_EXPORT",
                **identities,
                "files": hashes,
                "wholeVolumeProofPath": str(whole),
                "wholeVolumeProofSha256": restore.digest(whole),
            },
        )
        assert restore.__file__ is not None
        catalog = Path(restore.__file__).parent / "owned/plugins/TheStorm/heritage.yml"
        restore.save_json(
            staging / restore.JOURNAL,
            {
                "phase": "ARENA_TRANSPLANT_FAILED",
                "archiveSha256": restore.ARCHIVE_SHA256,
                "arenaTransplantInputs": {p.name: restore.digest(p) for p in (candidate, proof, catalog)},
            },
        )
        return staging, candidate, modern, proof

    def test_restart_arenas_archives_untouched_failed_output_and_preserves_inputs(self):
        staging, candidate, modern, proof = self.failed_arena_fixture()
        source = staging / "heritage-preserved-layout/world"
        historical, current = restore.fingerprint(source), restore.fingerprint(modern)
        original = (staging / restore.JOURNAL).read_bytes()
        restore.restart_arenas(staging, candidate, modern, proof)
        receipt = json.loads((staging / restore.JOURNAL).read_text())
        self.assertEqual(receipt["phase"], "NATIVE_HERITAGE_PRESERVED")
        self.assertNotIn("arenaTransplantInputs", receipt)
        archive = staging / receipt["arenaTransplantRestarts"][0]["archive"]
        self.assertEqual((archive / "failed-journal.json").read_bytes(), original)
        self.assertEqual(
            restore.digest(archive / "failed-journal.json"), receipt["arenaTransplantRestarts"][0]["journalSha256"]
        )
        self.assertEqual((archive / "transplant.log").read_text(), "failed before writes\n")
        self.assertEqual(restore.fingerprint(archive / "world"), historical)
        self.assertEqual(restore.fingerprint(source), historical)
        self.assertEqual(restore.fingerprint(modern), current)
        self.assertFalse((staging / "arena-preserved-layout").exists())
        self.assertFalse((staging / "arena-transplant.log").exists())
        with self.assertRaisesRegex(ValueError, "failed private"):
            restore.restart_arenas(staging, candidate, modern, proof)

    def test_restart_arenas_refuses_partially_written_output(self):
        staging, candidate, modern, proof = self.failed_arena_fixture()
        target = staging / "arena-preserved-layout/world/level.dat"
        target.write_bytes(b"partial write")
        original = (staging / restore.JOURNAL).read_bytes()
        with self.assertRaisesRegex(ValueError, "partially written"):
            restore.restart_arenas(staging, candidate, modern, proof)
        self.assertEqual((staging / restore.JOURNAL).read_bytes(), original)
        self.assertEqual(target.read_bytes(), b"partial write")
        self.assertFalse(list(staging.glob("arena-transplant-failed-*")))

    def test_restart_arenas_refuses_changed_candidate_and_backup(self):
        staging, candidate, modern, proof = self.failed_arena_fixture()
        candidate.write_bytes(b"different candidate")
        with self.assertRaisesRegex(ValueError, "candidate, catalog or backup proof"):
            restore.restart_arenas(staging, candidate, modern, proof)
        candidate.write_bytes(b"candidate")
        (modern / "world/level.dat").write_bytes(b"changed backup")
        with self.assertRaisesRegex(ValueError, "changed after verification"):
            restore.restart_arenas(staging, candidate, modern, proof)
        self.assertTrue((staging / "arena-preserved-layout").is_dir())

    def test_restart_arenas_refuses_linked_output(self):
        staging, candidate, modern, proof = self.failed_arena_fixture()
        failed = staging / "arena-preserved-layout"
        renamed = staging / "linked-target"
        failed.rename(renamed)
        failed.symlink_to(renamed)
        with self.assertRaisesRegex(ValueError, "regular checkpoint"):
            restore.restart_arenas(staging, candidate, modern, proof)
        self.assertTrue(failed.is_symlink())

    def test_restart_arenas_resumes_after_each_archival_interruption(self):
        parent = self.root
        real_rename, real_save = Path.rename, restore.save_json
        for point in ("journal", "copy", "log", "receipt"):
            with self.subTest(point=point):
                self.root = parent / point
                self.root.mkdir()
                staging, candidate, modern, proof = self.failed_arena_fixture()
                original = (staging / restore.JOURNAL).read_bytes()

                def interrupt_rename(path: Path, target: Path, failure_point: str = point):
                    result = real_rename(path, target)
                    if (failure_point == "copy" and path.name == "arena-preserved-layout") or (
                        failure_point == "log" and path.name == "arena-transplant.log"
                    ):
                        raise OSError("fixture interrupted after rename")
                    return result

                def interrupt_save(path: Path, value: dict[str, object], failure_point: str = point):
                    real_save(path, value)
                    if (failure_point == "journal" and value.get("phase") == "ARENA_TRANSPLANT_RESTARTING") or (
                        failure_point == "receipt" and path.name == "failed-journal.json"
                    ):
                        raise OSError("fixture interrupted after save")

                with (
                    patch.object(Path, "rename", interrupt_rename),
                    patch.object(restore, "save_json", interrupt_save),
                    self.assertRaisesRegex(OSError, "fixture interrupted"),
                ):
                    restore.restart_arenas(staging, candidate, modern, proof)
                pending = json.loads((staging / restore.JOURNAL).read_text())
                self.assertEqual(pending["phase"], "ARENA_TRANSPLANT_RESTARTING")
                restore.restart_arenas(staging, candidate, modern, proof)
                completed = json.loads((staging / restore.JOURNAL).read_text())
                self.assertEqual(completed["phase"], "NATIVE_HERITAGE_PRESERVED")
                self.assertNotIn("arenaRestart", completed)
                self.assertEqual(len(completed["arenaTransplantRestarts"]), 1)
                archive = staging / completed["arenaTransplantRestarts"][0]["archive"]
                self.assertEqual((archive / "failed-journal.json").read_bytes(), original)
                self.assertEqual((archive / "transplant.log").read_text(), "failed before writes\n")

    def test_restart_arenas_resumes_after_receipt_write_before_atomic_replace(self):
        parent = self.root
        real_replace = Path.replace
        for point in ("initial-journal", "failure-receipt", "final-journal"):
            with self.subTest(point=point):
                self.root = parent / point
                self.root.mkdir()
                staging, candidate, modern, proof = self.failed_arena_fixture()
                original = (staging / restore.JOURNAL).read_bytes()
                historical = restore.fingerprint(staging / "heritage-preserved-layout/world")
                current = restore.fingerprint(modern)
                abandoned: list[Path] = []

                def interrupt_replace(
                    path: Path, target: Path, failure_point: str = point, leftovers: list[Path] = abandoned
                ):
                    value = json.loads(path.read_text())
                    if (
                        (failure_point == "initial-journal" and value.get("phase") == "ARENA_TRANSPLANT_RESTARTING")
                        or (failure_point == "failure-receipt" and target.name == "failed-journal.json")
                        or (failure_point == "final-journal" and value.get("phase") == "NATIVE_HERITAGE_PRESERVED")
                    ):
                        leftovers.append(path)
                        raise OSError("fixture interrupted before atomic replace")
                    return real_replace(path, target)

                with (
                    patch.object(Path, "replace", interrupt_replace),
                    self.assertRaisesRegex(OSError, "fixture interrupted"),
                ):
                    restore.restart_arenas(staging, candidate, modern, proof)
                self.assertEqual(len(abandoned), 1)
                partial = abandoned[0].read_bytes()
                restore.restart_arenas(staging, candidate, modern, proof)
                completed = json.loads((staging / restore.JOURNAL).read_text())
                self.assertEqual(completed["phase"], "NATIVE_HERITAGE_PRESERVED")
                self.assertEqual(len(completed["arenaTransplantRestarts"]), 1)
                archive = staging / completed["arenaTransplantRestarts"][0]["archive"]
                self.assertEqual((archive / "failed-journal.json").read_bytes(), original)
                self.assertEqual(abandoned[0].read_bytes(), partial)
                self.assertEqual(restore.fingerprint(archive / "world"), historical)
                self.assertEqual(restore.fingerprint(staging / "heritage-preserved-layout/world"), historical)
                self.assertEqual(restore.fingerprint(modern), current)

    def test_restart_arenas_ignores_legacy_abandoned_receipt_temporary(self):
        staging, candidate, modern, proof = self.failed_arena_fixture()
        temporary = staging / (restore.JOURNAL + ".tmp")
        temporary.write_bytes(b'{"partial":')
        restore.restart_arenas(staging, candidate, modern, proof)
        completed = json.loads((staging / restore.JOURNAL).read_text())
        self.assertEqual(completed["phase"], "NATIVE_HERITAGE_PRESERVED")
        self.assertEqual(temporary.read_bytes(), b'{"partial":')

    def test_database_snapshots_refuse_changes_still_in_a_write_ahead_log(self):
        database = self.root / "the-storm.db"
        with closing(sqlite3.connect(database)) as connection:
            connection.execute("CREATE TABLE towns_town(id TEXT PRIMARY KEY)")
            connection.commit()
        writer = sqlite3.connect(database)
        try:
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("PRAGMA wal_autocheckpoint=0")
            writer.execute("INSERT INTO towns_town VALUES('late')")
            writer.commit()
            with self.assertRaisesRegex(ValueError, "the-storm.db-wal holds uncheckpointed changes"):
                restore.table_rows(database)
        finally:
            writer.close()
        self.assertEqual(restore.table_rows(database)["towns_town"], {("late",)})

    def activation_fixture(self, extra=()):
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
        for name in ("settlement", "rustworks", "rwf", *extra):
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

    def test_activation_refuses_a_backup_holding_worlds_it_would_drop(self):
        arguments = self.activation_fixture(extra=("wilds", "peaks", "map2"))
        staging, _, _, _, modern, _ = arguments
        before, journal = restore.fingerprint(modern), (staging / restore.JOURNAL).read_bytes()
        with (
            patch.object(restore, "conversion_classpath", return_value="fixture"),
            patch.object(restore, "run_activation_check") as verification,
            self.assertRaisesRegex(ValueError, "would drop worlds the modern backup holds: map2, peaks, wilds"),
        ):
            restore.prepare_activation(*arguments)
        verification.assert_not_called()
        self.assertFalse((staging / "activation-layout").exists())
        self.assertEqual((staging / restore.JOURNAL).read_bytes(), journal)
        self.assertEqual(restore.fingerprint(modern), before)

    def test_activation_assembly_preserves_arena_dimensions_and_historical_data(self):
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

    def test_activation_check_verifies_layout_metadata_against_the_primary_archive(self):
        calls: list[list[str]] = []
        receipt = {
            "status": "VERIFIED",
            "dataVersion": 4903,
            "entityUuidCollisions": [],
            "terrainGeneration": False,
            "worldTicks": 0,
        }

        def run(command: list[str], **_: object) -> subprocess.CompletedProcess[bytes]:
            calls.append(command)
            (self.root / "native-receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
            return subprocess.CompletedProcess(command, 0)

        with patch.object(restore.subprocess, "run", side_effect=run):
            restore.run_activation_check(self.root / "world", self.root / "modern", self.root, "fixture")
        layout = next(call for call in calls if call[4].endswith("NativeLayoutMetadata.java"))
        self.assertEqual(
            layout[5:],
            ["verify", "main-map1-2015-07-09", str(self.root / "world"), str(self.root / "metadata-receipt.json")],
        )

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

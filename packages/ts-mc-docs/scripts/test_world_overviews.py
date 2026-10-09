"""Conversion, archive preservation and static publication boundary tests."""

import fcntl
import gzip
import io
import json
import struct
import subprocess
import tempfile
import unittest
import zipfile
import zlib
from argparse import Namespace
from pathlib import Path
from typing import TextIO
from unittest.mock import Mock, patch

from overview_types import OverviewPublication, PublishedOverview
from test_world_previews import level
from world_archive import ORIGIN, PACKAGE, document, listed_worlds, load_catalog, sha256
from world_overviews import (
    asset_inventory,
    certify_render_states,
    certify_terrain,
    extract_world,
    native_version,
    publish_asset,
    run,
    tool_config,
    upgrade_regions,
    upgrade_world,
    validate_publication,
    world_format,
    write_configs,
)


def region_file(path: Path, indices: list[int], version: int = 2730) -> None:
    payload = zlib.compress(b"\x0a\0\0\x03\0\x0bDataVersion" + struct.pack(">i", version) + b"\0")
    header = bytearray(8192)
    sectors = []
    for sector, index in enumerate(indices, start=2):
        struct.pack_into(">I", header, index * 4, sector << 8 | 1)
        block = struct.pack(">I", len(payload) + 1) + b"\x02" + payload
        sectors.append(block.ljust(4096, b"\0"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + b"".join(sectors))


def publication() -> OverviewPublication:
    tools = tool_config()
    downloads = json.loads((PACKAGE / "archive/published.json").read_text())
    worlds: dict[str, PublishedOverview] = {}
    for world in listed_worlds(load_catalog()):
        identifier = world["id"]
        entry = downloads["worlds"][identifier]
        worlds[identifier] = {
            "sourceSha256": entry["sourceSha256"],
            "url": (
                f"{ORIGIN}/world-archive/{downloads['release']}/overviews/{tools['release']}/{identifier}/index.html"
            ),
            "bytes": 5,
            "objects": 1,
            "renderMinecraft": "1.17.1",
            "chunks": 1,
            "generatedChunksRemoved": 0,
            "assets": [{"path": "index.html", "bytes": 5, "sha256": "a" * 64}],
        }
    return {
        "archiveRelease": downloads["release"],
        "overviewRelease": tools["release"],
        "tools": tools,
        "worlds": worlds,
    }


class OverviewTests(unittest.TestCase):
    def test_offline_converter_requires_completion_and_rejects_server_startup(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            for text, error in (
                ("STORM_ARCHIVE_CONVERSION_COMPLETE\n", None),
                ("World optimizaton finished\n", "Upgrade failed"),
                ("STORM_ARCHIVE_CONVERSION_COMPLETE\nDone (1.0s)!\n", "unexpectedly started"),
                ("STORM_ARCHIVE_CONVERSION_COMPLETE\nERROR unreadable chunk\n", "conversion failure"),
            ):
                with self.subTest(log=text):

                    def process(
                        _command: list[str], *, stdout: TextIO, log_text: str = text, **_options: object
                    ) -> Mock:
                        stdout.write(log_text)
                        stdout.flush()
                        return Mock(returncode=0, poll=lambda: 0)

                    with patch("world_overviews.subprocess.Popen", side_effect=process):
                        if error is None:
                            upgrade_world(work, Path("server.jar"), "image")
                        else:
                            with self.assertRaisesRegex(RuntimeError, error):
                                upgrade_world(work, Path("server.jar"), "image")

    def test_anvil_storage_metadata_distinguishes_obsolete_mcregion_files(self):
        raw = gzip.decompress(level(0, 0))
        tag = b"\x03\0\x07version" + struct.pack(">i", 19133)
        self.assertEqual(world_format(gzip.compress(raw[:-2] + tag + b"\0\0")), 19133)
        with self.assertRaisesRegex(ValueError, "storage format"):
            world_format(level(0, 0))

    def test_public_payload_excludes_render_checkpoints_and_sql_helper(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "maps/test/rstate").mkdir(parents=True)
            (root / "maps/test/rstate/chunks.dat").write_bytes(b"internal")
            (root / "sql.php").write_text("internal")
            (root / "index.html").write_text("viewer")
            self.assertEqual([a["path"] for a in asset_inventory(root)], ["index.html"])

    def test_scratch_ownership_and_exclusive_run_protect_resume_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, scratch = root / "source", root / "scratch"
            source.mkdir()
            scratch.mkdir()
            (scratch / "unrelated").write_text("preserve")
            args = Namespace(source=source, scratch=scratch, dry_run=False)
            with self.assertRaisesRegex(ValueError, "unowned"):
                run(args)
            (scratch / ".overview-scratch-owner").write_text("owned")
            with (scratch / ".run.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError, "Another overview run"):
                    run(args)
            with patch("world_overviews.run_locked") as execute:
                run(args)
            execute.assert_called_once_with(args)

    def test_extraction_preserves_original_bytes_and_excludes_player_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, work = root / "source", root / "work"
            source.mkdir()
            work.mkdir()
            region = root / "region/r.-1.0.mca"
            region_file(region, [0, 1023])
            archive_path = source / "world.zip"
            raw_metadata = gzip.decompress(level(-16, 8))
            version = b"\x03\0\x07version" + struct.pack(">i", 19133)
            metadata = gzip.compress(raw_metadata[:-2] + version + b"\0\0")
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("nested/level.dat", metadata + b"known-trailing-junk")
                archive.writestr("nested/region/r.-1.0.mca", region.read_bytes())
                archive.writestr("nested/region/r.0.0.mca", b"")
                archive.writestr("nested/region/r.-1.0.mcr", b"obsolete-mcregion-backup")
                archive.writestr("nested/playerdata/player.dat", b"historical-player")
            original = sha256(archive_path)
            with patch("world_overviews.require_space"):
                inventory, spawn = extract_world(source, {"id": "test", "file": "world.zip", "root": "nested"}, work)
            self.assertEqual(inventory, {"r.-1.0.mca": [0, 1023]})
            self.assertEqual(spawn, (-16, 8))
            self.assertEqual(sha256(archive_path), original)
            self.assertFalse((work / "world/playerdata").exists())
            self.assertFalse((work / "world/region/r.-1.0.mcr").exists())
            self.assertEqual(gzip.decompress((work / "world/level.dat").read_bytes()), gzip.decompress(metadata))

    def test_conversion_retains_original_chunks_and_removes_only_new_terrain(self):
        with tempfile.TemporaryDirectory() as temporary:
            world = Path(temporary)
            region_file(world / "region/r.-1.0.mca", [0, 1, 1023])
            region_file(world / "region/r.2.3.mca", [17])
            (world / "region/r.4.5.mca").write_bytes(b"")
            removed = certify_terrain(world, {"r.-1.0.mca": [0, 1023]}, converted=True)
            self.assertEqual(removed, 2)
            self.assertFalse((world / "region/r.2.3.mca").exists())
            self.assertFalse((world / "region/r.4.5.mca").exists())
            self.assertEqual(certify_terrain(world, {"r.-1.0.mca": [0, 1023]}, converted=True), 0)

    def test_partitioned_conversion_merges_only_original_regions_and_resumes(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            inventory = {f"r.{index}.0.mca": [0, 1023] for index in range(4)}
            for name, indices in inventory.items():
                region_file(work / "world/region" / name, indices, version=1976)
            (work / "world/level.dat").write_bytes(b"original metadata")
            (work / "inventory.json").write_text(json.dumps(inventory))

            def convert(part: Path, _jar: Path, _image: str) -> None:
                for path in (part / "world/region").glob("*.mca"):
                    region_file(path, inventory[path.name])
                region_file(part / "world/region/r.100.100.mca", [17])
                (part / "world/level.dat").write_bytes(b"converted metadata")

            with (
                patch("world_overviews.subprocess.check_output", return_value=f"12 {32 * 1024**3}"),
                patch("world_overviews.upgrade_world", side_effect=convert) as upgrade,
            ):
                self.assertEqual(upgrade_regions(work, Path("server.jar"), "image", 2), 2)
                self.assertEqual(upgrade.call_count, 2)
                self.assertEqual(certify_terrain(work / "world", inventory, converted=True), 0)
                self.assertEqual((work / "world/level.dat").read_bytes(), b"converted metadata")
                self.assertEqual(upgrade_regions(work, Path("server.jar"), "image", 2), 2)
                self.assertEqual(upgrade.call_count, 2)
                with self.assertRaisesRegex(ValueError, "partition plan changed"):
                    upgrade_regions(work, Path("server.jar"), "image", 4)

    def test_missing_and_unconverted_chunks_block_certification(self):
        with tempfile.TemporaryDirectory() as temporary:
            world = Path(temporary)
            region_file(world / "region/r.0.0.mca", [0], version=1976)
            with self.assertRaisesRegex(ValueError, "lost chunks"):
                certify_terrain(world, {"r.0.0.mca": [0, 1]}, converted=True)
            with self.assertRaisesRegex(ValueError, "not converted"):
                certify_terrain(world, {"r.0.0.mca": [0]}, converted=True)
            self.assertEqual(certify_terrain(world, {"r.0.0.mca": [0]}, converted=False), 0)
            (world / "region/r.0.0.mca").write_bytes(b"")
            with self.assertRaisesRegex(ValueError, "Truncated"):
                certify_terrain(world, {"r.0.0.mca": [0]}, converted=True)

    def test_corrupt_chunk_payload_is_not_silently_omitted(self):
        with tempfile.TemporaryDirectory() as temporary:
            world = Path(temporary)
            path = world / "region/r.0.0.mca"
            region_file(path, [0])
            data = bytearray(path.read_bytes())
            data[8196] = 127
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "compression"):
                certify_terrain(world, {"r.0.0.mca": [0]}, converted=True)

    def test_render_states_reject_silent_light_omissions_and_tile_failures(self):
        def string(value: str) -> bytes:
            return struct.pack(">H", len(value)) + value.encode()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "maps/test/rstate/x0/z0.tiles.dat"
            path.parent.mkdir(parents=True)
            for state in ("rendered", "not-generated", "missing-light", "render-error", "chunk-error"):
                payload = b"\x0a\0\0\x0a" + string("tile-states")
                payload += b"\x09" + string("palette") + b"\x08" + struct.pack(">i", 1)
                payload += string(f"bluemap:{state}")
                payload += b"\x07" + string("data") + struct.pack(">i", 1024) + b"\0" * 1024 + b"\0\0"
                path.write_bytes(gzip.compress(payload))
                if state == "not-generated":
                    # A completed scan is insufficient when the renderer skipped
                    # an allocated chunk that can still contain saved blocks.
                    certify_render_states(root)
                    with self.assertRaisesRegex(ValueError, "no rendered overview tile"):
                        certify_render_states(root, {"r.0.0.mca": [0]})
                elif state == "rendered":
                    certify_render_states(root)
                    (root / "maps/test/settings.json").write_text(
                        json.dumps(
                            {
                                "hires": {"tileSize": [32, 32], "scale": [1, 1], "translate": [2, 2]},
                            }
                        )
                    )
                    certify_render_states(root, {"r.0.0.mca": [0, 1023]})
                    distant = root / "maps/test/rstate/x-1/9/9/z-2/0/4.tiles.dat"
                    distant.parent.mkdir(parents=True)
                    distant.write_bytes(gzip.compress(payload))
                    x, z = -199, -204
                    certify_render_states(root, {f"r.{2 * x}.{2 * z}.mca": [0, 1023]})
                    with self.assertRaisesRegex(ValueError, "no rendered overview tile"):
                        certify_render_states(root, {"r.2.0.mca": [0]})
                else:
                    with self.assertRaisesRegex(ValueError, "omitted or failed"):
                        certify_render_states(root)

    def test_legacy_versions_upgrade_and_supported_worlds_render_natively(self):
        for value in ("2012 Anvil format (use 1.3.2)", "1.8-era (use 1.8.9)"):
            self.assertIsNone(native_version({"minecraft": value}))
        self.assertIsNone(native_version({"minecraft": "1.14.4"}))
        self.assertIsNone(native_version({"minecraft": "1.16.5"}))
        self.assertEqual(native_version({"minecraft": "1.17.1"}), "1.17.1")
        self.assertEqual(native_version({"minecraft": "1.19.2"}), "1.19.2")

    def test_low_resolution_static_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_configs(root, {"id": "legacy", "title": "Historical world"}, (-16, 8), 2)
            map_config = (root / "config/maps/legacy.conf").read_text()
            self.assertIn("enable-hires: false", map_config)
            self.assertIn("enable-free-flight-view: false", map_config)
            self.assertIn("enable-perspective-view: false", map_config)
            self.assertIn("ignore-missing-light-data: true", map_config)
            self.assertNotIn("render-mask", map_config)
            self.assertIn("client-decompression: true", (root / "config/webapp.conf").read_text())

    def test_resume_certifies_existing_assets_without_uploading_them_again(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "index.html").write_bytes(b"hello")
            asset = asset_inventory(root)[0]
            existing = subprocess.CompletedProcess([], 0, json.dumps({"Contents": [{"Key": "prefix/index.html"}]}))
            with (
                patch("world_overviews.aws", return_value=existing) as aws,
                patch("world_overviews.verify_checkpoint") as certificate,
                patch("world_overviews.verify_url"),
            ):
                publish_asset("test", root, "prefix", asset)
            self.assertEqual(aws.call_count, 1)
            certificate.assert_called_once_with("test", f"{ORIGIN}/prefix/index.html", 5, asset["sha256"])

    def test_compressed_assets_keep_raw_gzip_bytes_for_client_decompression(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = gzip.compress(b'{"textures": []}')
            (root / "textures.json.gz").write_bytes(payload)
            asset = asset_inventory(root)[0]
            empty = subprocess.CompletedProcess([], 0, "{}")
            with (
                patch("world_overviews.aws", return_value=empty) as aws,
                patch("world_overviews.verify_url"),
                patch("world_overviews.subprocess.Popen") as popen,
            ):
                process = popen.return_value.__enter__.return_value
                process.stdout = io.BytesIO(payload)
                process.wait.return_value = 0
                publish_asset("test", root, "prefix", asset)
            upload = aws.call_args.args[1]
            self.assertIn("application/gzip", upload)
            self.assertNotIn("--content-encoding", upload)

    def test_partial_foreign_and_malformed_manifests_cannot_generate_page_links(self):
        state = publication()
        validate_publication(state, complete=True)
        identifier = next(iter(state["worlds"]))
        state["worlds"][identifier]["assets"][0]["path"] = "../private"
        with self.assertRaisesRegex(ValueError, "Unsafe archive path"):
            validate_publication(state, complete=True)
        state = publication()
        del state["worlds"][identifier]
        with self.assertRaisesRegex(ValueError, "required worlds"):
            validate_publication(state, complete=True)
        state = publication()
        state["worlds"]["main-map1-upgraded-2023-06-18"] = state["worlds"][identifier]
        with self.assertRaisesRegex(ValueError, "required worlds"):
            validate_publication(state, complete=True)
        state = publication()
        state["worlds"][identifier]["sourceSha256"] = "different"
        with self.assertRaisesRegex(ValueError, "certified archive"):
            validate_publication(state, complete=True)

    def test_generated_page_adds_links_and_keeps_downloads_and_previews(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "src/content/docs").mkdir(parents=True)
            (package / "archive").mkdir()
            manifest = package / "archive/overviews.json"
            state = publication()
            manifest.write_text(json.dumps(state))
            archive = json.loads((PACKAGE / "archive/published.json").read_text())
            with patch("world_archive.PACKAGE", package):
                document(PACKAGE / "archive/published.json", manifest)
                explicit = (package / "src/content/docs/world_downloads.md").read_text()
                document(PACKAGE / "archive/published.json")
            page = (package / "src/content/docs/world_downloads.md").read_text()
            self.assertEqual(page, explicit)
            self.assertEqual(page.count("[Explore map]"), 8)
            self.assertEqual(page.count("[Download ZIP]"), 8)
            self.assertNotIn("Main Map 1 — upgraded copy", page)
            retained = json.loads((package / "archive/published.json").read_text())
            self.assertEqual(retained, archive)
            self.assertIn("main-map1-upgraded-2023-06-18", retained["worlds"])
            for identifier, world in state["worlds"].items():
                self.assertIn(
                    f"[Download ZIP]({archive['worlds'][identifier]['download']}) · [Explore map]({world['url']})", page
                )
                self.assertIn(archive["worlds"][identifier]["sha256"], page)
                self.assertIn(archive["worlds"][identifier]["previews"][0]["url"], page)


if __name__ == "__main__":
    unittest.main()

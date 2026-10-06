import gzip
import json
import shutil
import struct
import subprocess
import tempfile
import unittest
import zipfile
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from world_archive import Catalog, extract_preview, run, upload_download, verify_checkpoint
from world_previews import level_metadata, png_dimensions, preview_areas


def level(x: int, z: int) -> bytes:
    def name(value: str) -> bytes:
        return struct.pack(">H", len(value)) + value.encode()

    data = b"\x0a\0\0\x0a" + name("Data")
    data += b"\x03" + name("SpawnX") + struct.pack(">i", x)
    data += b"\x08" + name("LevelName") + name("Historical world")
    data += b"\x03" + name("SpawnZ") + struct.pack(">i", z) + b"\0\0"
    return gzip.compress(data)


class PreviewTests(unittest.TestCase):
    def test_fresh_upload_refuses_to_replace_a_published_object_with_different_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "world.zip"
            path.write_bytes(b"new archive")
            key = "world-archive/test/downloads/world.zip"
            listed = subprocess.CompletedProcess([], 0, json.dumps({"Contents": [{"Key": key}]}))
            with (
                patch("world_archive.aws", return_value=listed) as aws,
                patch("world_archive.verify_checkpoint", side_effect=RuntimeError("Checkpoint object changed")),
                self.assertRaisesRegex(RuntimeError, "Checkpoint object changed"),
            ):
                upload_download("test", path, key, "new-digest")
            self.assertEqual(aws.call_count, 1)
            self.assertEqual(aws.call_args.args[1][0], "s3api")

    def test_resume_checks_remote_certificate_and_does_not_accept_deleted_objects(self):
        url = "https://docs.ts-mc.net/world-archive/test/downloads/world.zip"
        for header in ("sha256", "Sha256"):
            valid = subprocess.CompletedProcess([], 0, json.dumps({"ContentLength": 123, "Metadata": {header: "abc"}}))
            with patch("world_archive.aws", return_value=valid):
                verify_checkpoint("test", url, 123, "abc")
                with self.assertRaisesRegex(RuntimeError, "Checkpoint object changed"):
                    verify_checkpoint("test", url, 124, "abc")
                with self.assertRaisesRegex(RuntimeError, "Checkpoint object changed"):
                    verify_checkpoint("test", url, 123, "different")
        missing = subprocess.CalledProcessError(254, ["aws", "s3api", "head-object"])
        with patch("world_archive.aws", side_effect=missing), self.assertRaises(subprocess.CalledProcessError):
            verify_checkpoint("test", url, 123, "abc")

    def test_metadata_preserves_valid_stream_and_reads_negative_spawn(self):
        original = level(-17, 31)
        self.assertEqual(level_metadata(original + b"junk"), (original, (-17, 31)))
        with self.assertRaises(ValueError):
            level_metadata(original[:-8])

    def test_selection_handles_negative_regions_and_excludes_other_dimensions(self):
        overview, closeup = preview_areas((0, 0))
        self.assertTrue(overview.includes(Path("region/r.-3.0.mca")))
        self.assertFalse(overview.includes(Path("region/r.-4.0.mca")))
        self.assertFalse(overview.includes(Path("DIM-1/region/r.0.0.mca")))
        self.assertEqual(closeup.pixels, 1024)
        self.assertEqual(overview.argument, "b(-1024,-1024,2048,2048)")

    def test_extracts_only_preview_terrain_and_sanitizes_only_preview_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, work = root / "source", root / "work"
            source.mkdir()
            work.mkdir()
            original = level(0, 0)
            with zipfile.ZipFile(source / "world.zip", "w") as archive:
                archive.writestr("nested/level.dat", original + b"junk")
                archive.writestr("nested/region/r.0.0.mca", b"nearby")
                archive.writestr("nested/region/r.90.90.mca", b"distant")
                archive.writestr("nested/playerdata/player.dat", b"private-player-state")
            extract_preview(source, {"id": "test", "file": "world.zip", "root": "nested"}, work)
            self.assertEqual((work / "world/level.dat").read_bytes(), original)
            self.assertEqual((work / "world/region/r.0.0.mca").read_bytes(), b"nearby")
            self.assertFalse((work / "world/region/r.90.90.mca").exists())
            self.assertFalse((work / "world/playerdata").exists())
            with zipfile.ZipFile(source / "world.zip") as archive:
                self.assertEqual(archive.read("nested/level.dat"), original + b"junk")

    def test_png_contract_rejects_html_or_truncated_headers(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "preview.png"
            path.write_bytes(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" + struct.pack(">II", 2048, 1024))
            self.assertEqual(png_dimensions(path), (2048, 1024))
            path.write_bytes(b"<html>404</html>")
            with self.assertRaises(ValueError):
                png_dimensions(path)

    def test_failed_preview_keeps_download_checkpoint_and_retry_does_not_reupload_zip(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, scratch = root / "source", root / "scratch"
            source.mkdir()
            with zipfile.ZipFile(source / "world.zip", "w") as archive:
                archive.writestr("nested/level.dat", level(0, 0))
                archive.writestr("nested/region/r.0.0.mca", b"terrain")
            catalog: Catalog = {
                "release": "test-v1",
                "rendererUrl": "unused",
                "rendererSha256": "unused",
                "worlds": [
                    {
                        "id": "test",
                        "file": "world.zip",
                        "root": "nested",
                        "title": "Test",
                        "date": "2026-01-01",
                        "minecraft": "1.8.9",
                        "credit": "Community",
                        "description": "Test",
                    }
                ],
                "schematics": [],
            }
            args = Namespace(source=source, scratch=scratch, only="test", dry_run=False, profile="test", workers=2)
            with (
                patch("world_archive.load_catalog", return_value=catalog),
                patch("world_archive.aws"),
                patch("world_archive.renderer", return_value=root / "renderer"),
                patch("world_archive.upload_download") as upload,
                patch("world_archive.render_preview", side_effect=RuntimeError("render failed")),
                self.assertRaisesRegex(RuntimeError, "render failed"),
            ):
                run(args)
            self.assertEqual(upload.call_count, 1)
            state = json.loads((scratch / "published.json").read_text())
            self.assertIn("test", state["downloads"])
            self.assertNotIn("test", state["worlds"])
            shutil.rmtree(scratch / "test")
            with (
                patch("world_archive.load_catalog", return_value=catalog),
                patch("world_archive.aws"),
                patch("world_archive.renderer", return_value=root / "renderer"),
                patch("world_archive.verify_checkpoint"),
                patch("world_archive.prepare", side_effect=AssertionError("must reuse certified ZIP")),
                patch("world_archive.render_preview", side_effect=RuntimeError("render failed again")),
                self.assertRaisesRegex(RuntimeError, "render failed again"),
            ):
                run(args)


if __name__ == "__main__":
    unittest.main()

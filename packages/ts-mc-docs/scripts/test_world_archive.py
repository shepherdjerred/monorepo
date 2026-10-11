"""Archive contract tests using disposable, deliberately nested world ZIPs."""

import json
import tempfile
import unittest
import zipfile
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from world_archive import (
    CATALOG,
    PACKAGE,
    listed_worlds,
    load_catalog,
    prepare,
    retained_path,
    retire_world_checkpoints,
    run,
)


class ArchiveTests(unittest.TestCase):
    def test_retirement_is_release_specific_and_preserves_unknown_checkpoints(self):
        worlds = {"new-world-test-2022-11-20": {}, "unrelated": {"preserve": True}}
        self.assertFalse(retire_world_checkpoints("another-release", worlds))
        self.assertIn("new-world-test-2022-11-20", worlds)
        self.assertTrue(retire_world_checkpoints("2026-10-04-v1", worlds))
        self.assertEqual(worlds, {"unrelated": {"preserve": True}})
        self.assertFalse(retire_world_checkpoints("2026-10-04-v1", worlds))

    def test_resume_migrates_retired_downloads_and_worlds_before_publishing_checksums(self):
        catalog = load_catalog()
        expected = json.loads((PACKAGE / "archive/published.json").read_text())
        state = json.loads(json.dumps(expected))
        state["downloads"] = {
            key: {k: v for k, v in world.items() if k != "previews"} for key, world in state["worlds"].items()
        }
        for identifier in ("new-world-test-2022-11-20", "main-map1-upgraded-2023-06-18"):
            state["worlds"][identifier] = {"retired": True}
            state["downloads"][identifier] = {"retired": True}
        hashes = {world["file"]: expected["worlds"][world["id"]]["sourceSha256"] for world in catalog["worlds"]}
        hashes.update({name: entry["sha256"] for name, entry in expected["schematics"].items()})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, scratch = root / "source", root / "scratch"
            source.mkdir()
            scratch.mkdir()
            for name in hashes:
                (source / name).write_bytes(b"fixture")
            (scratch / "published.json").write_text(json.dumps(state))
            args = Namespace(source=source, scratch=scratch, dry_run=False, only=None, profile="test", workers=1)
            with (
                patch("world_archive.require_space"),
                patch("world_archive.renderer"),
                patch("world_archive.aws"),
                patch("world_archive.verify_checkpoint"),
                patch("world_archive.sha256", side_effect=lambda path: hashes[path.name]),
            ):
                run(args)
            self.assertEqual(json.loads((scratch / "checksums.json").read_text()), expected)
            migrated = json.loads((scratch / "published.json").read_text())
            self.assertEqual(migrated["worlds"], expected["worlds"])
            self.assertEqual(set(migrated["downloads"]), set(expected["worlds"]))

    def test_catalog_preserves_the_seven_historical_worlds(self):
        catalog = load_catalog()
        expected = {
            "main-map2-2016-01-10",
            "main-map1-2015-07-09",
            "skylands-map2-2016-01-10",
            "skylands-map1-2015-07-09",
            "creative-2016-01-10",
            "asterism-2016-02",
            "kargeth-2012-09-11",
        }
        self.assertEqual({world["id"] for world in catalog["worlds"]}, expected)
        self.assertEqual({world["id"] for world in listed_worlds(catalog)}, expected)

    def test_listing_defaults_to_visible_and_rejects_non_boolean_metadata(self):
        catalog = json.loads(CATALOG.read_text())
        catalog["worlds"] = catalog["worlds"][:3]
        catalog["worlds"][1]["listed"] = False
        catalog["worlds"][2]["listed"] = True
        self.assertEqual(listed_worlds(catalog), [catalog["worlds"][0], catalog["worlds"][2]])
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "catalog.json"
            for value in ("false", 0, None):
                with self.subTest(listed=value):
                    catalog["worlds"][0]["listed"] = value
                    path.write_text(json.dumps(catalog))
                    with patch("world_archive.CATALOG", path), self.assertRaisesRegex(ValueError, "boolean"):
                        load_catalog()

    def test_normalized_zip_preserves_world_and_player_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            work = root / "work"
            source.mkdir()
            work.mkdir()
            contents = {
                "level.dat": b"original-level-with-player-state",
                "playerdata/player.dat": b"original-inventory",
                "stats/player.json": b'{"stat":42}',
                "DIM-1/region/r.0.0.mca": b"nether-terrain",
            }
            with zipfile.ZipFile(source / "legacy.zip", "w") as zipped:
                for path, data in contents.items():
                    member = zipfile.ZipInfo(f"home/server/world/{path}", date_time=(2016, 1, 10, 12, 34, 56))
                    member.create_system = 3
                    member.external_attr = 0o100644 << 16
                    zipped.writestr(member, data)
                zipped.writestr("home/server/world/session.lock", b"stale")
                zipped.writestr("home/server/world/.DS_Store", b"junk")
            with patch("world_archive.require_space"):
                output, metadata = prepare(
                    source, {"id": "legacy", "file": "legacy.zip", "root": "home/server/world"}, work
                )
            with zipfile.ZipFile(output) as normalized:
                self.assertEqual(set(normalized.namelist()), {f"legacy/{p}" for p in contents})
                for path, data in contents.items():
                    self.assertEqual(normalized.read(f"legacy/{path}"), data)
                    member = normalized.getinfo(f"legacy/{path}")
                    self.assertEqual(member.date_time, (1980, 1, 1, 0, 0, 0))
                    self.assertEqual(member.external_attr, 0o600 << 16)
                    self.assertEqual(member.create_system, 3)
            repeat = root / "repeat"
            repeat.mkdir()
            with patch("world_archive.require_space"):
                _, repeated_metadata = prepare(
                    source, {"id": "legacy", "file": "legacy.zip", "root": "home/server/world"}, repeat
                )
            self.assertEqual(repeated_metadata, metadata)
            self.assertFalse((work / "world").exists())
            self.assertEqual(metadata["files"], len(contents))
            self.assertEqual(metadata["bytes"], output.stat().st_size)
            self.assertEqual(len(metadata["sha256"]), 64)

    def test_paths_cannot_escape_the_world_or_include_server_files(self):
        for name in [
            "../secret",
            "/etc/passwd",
            "home/server/world/../secret",
            "home/server/server.properties",
            "home\\server\\world\\level.dat",
        ]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                retained_path(zipfile.ZipInfo(name), "home/server/world")


if __name__ == "__main__":
    unittest.main()

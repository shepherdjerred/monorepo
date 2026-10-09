"""Archive contract tests using disposable, deliberately nested world ZIPs."""

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from world_archive import CATALOG, listed_worlds, load_catalog, prepare, retained_path


class ArchiveTests(unittest.TestCase):
    def test_listing_defaults_to_visible_and_rejects_non_boolean_metadata(self):
        catalog = json.loads(CATALOG.read_text())
        self.assertEqual(len(listed_worlds(catalog)), 8)
        self.assertEqual(len(catalog["worlds"]), 9)
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

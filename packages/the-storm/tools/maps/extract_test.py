"""The archive boundary rejects unsafe content before creating an output copy."""

import hashlib
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from extract import extract


class ExtractionTest(unittest.TestCase):
    def test_preserves_source_and_extracts_only_a_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "map.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("config.yml", "Name: Map")
                archive.writestr("level.dat", b"legacy world")
                region = bytearray(12288)
                struct.pack_into(">I", region, 0, 2 << 8 | 1)
                archive.writestr("region/r.-1.0.mca", region)
            original = source.read_bytes()
            output = root / "import"
            report = extract(source, output)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual((output / "source.zip").read_bytes(), original)
            self.assertEqual(report["sha256"], hashlib.sha256(original).hexdigest())
            self.assertEqual((output / "world/region/r.-1.0.mca").read_bytes(), region)
            self.assertEqual(report["savedChunks"], [{"x": -32, "z": 0}])
            with self.assertRaises(FileExistsError):
                extract(source, output)

    def test_rejects_traversal_unknown_entries_and_missing_content(self):
        for entry in ("../escape", "region/../../escape", "/escape", "plugins/code.jar", ""):
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "map.zip"
                with zipfile.ZipFile(source, "w") as archive:
                    archive.writestr("level.dat", b"world")
                    if entry:
                        archive.writestr(entry, b"unsafe")
                with self.assertRaises(ValueError):
                    extract(source, root / "import")
                self.assertFalse((root / "import").exists())


if __name__ == "__main__":
    unittest.main()

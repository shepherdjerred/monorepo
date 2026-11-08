import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from maintenance import skylands_stream as stream


class SkylandsStreamTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.data = Path(temporary.name)
        names = [
            *stream.ROOT_FILES,
            stream.DIMENSION + "/data/minecraft/world_gen_settings.dat",
            stream.DIMENSION + "/region/r.0.0.mca",
            stream.DIMENSION + "/entities/r.0.0.mca",
            "world/playerdata/player.dat",
            "plugins/TheStorm/the-storm.db",
        ]
        for name in names:
            path = self.data / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"native save fixture")

    def test_archive_contains_complete_dimension_and_a_verified_manifest(self):
        output = io.BytesIO()
        stream.archive(self.data, output)
        output.seek(0)
        with tarfile.open(fileobj=output) as archive:
            names = archive.getnames()
            self.assertFalse(any("playerdata" in name or name.endswith(".db") for name in names))
            entry = archive.extractfile("export.json")
            self.assertIsNotNone(entry)
            if entry is None:
                raise AssertionError("Export receipt is missing from the archive")
            self.assertEqual(json.load(entry), {"schemaVersion": 1, "files": stream.snapshot(self.data)})
            self.assertIn("payload/" + stream.DIMENSION + "/entities/r.0.0.mca", names)

    def test_changed_source_never_receives_a_valid_export_receipt(self):
        original = tarfile.TarFile.add

        def changed(archive: tarfile.TarFile, name: str | Path, *args: Any, **kwargs: Any) -> None:
            original(archive, name, *args, **kwargs)
            if str(name).endswith("r.0.0.mca"):
                Path(name).write_bytes(b"changed while streaming")

        output = io.BytesIO()
        with patch.object(tarfile.TarFile, "add", changed), self.assertRaisesRegex(ValueError, "changed"):
            stream.archive(self.data, output)

    def test_linked_files_are_rejected(self):
        path = self.data / stream.DIMENSION / "region/link.mca"
        path.symlink_to(self.data / "world/level.dat")
        with self.assertRaisesRegex(ValueError, "linked"):
            stream.archive(self.data, io.BytesIO())

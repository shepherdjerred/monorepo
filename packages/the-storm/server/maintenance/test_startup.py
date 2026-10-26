import json
import tempfile
import unittest
from pathlib import Path

from maintenance import startup


class StartupTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.data = Path(directory.name)

    def test_existing_world_is_refused_without_writing_preparation(self):
        (self.data / "world").mkdir()
        world = self.data / "world/level.dat"
        world.write_bytes(b"existing native world")
        with self.assertRaisesRegex(ValueError, "requires verified world retirement"):
            startup.require_preparation(self.data)
        self.assertEqual(world.read_bytes(), b"existing native world")
        self.assertFalse((self.data / startup.MARKER).exists())

    def test_new_server_initializes_once_and_requires_no_historical_relocation(self):
        startup.require_preparation(self.data)
        marker = self.data / startup.MARKER
        original = marker.read_bytes()
        startup.require_preparation(self.data)
        self.assertEqual(marker.read_bytes(), original)

    def test_a_recreated_retired_world_is_refused_even_with_a_complete_marker(self):
        startup.require_preparation(self.data)
        retired = self.data / "world/dimensions/minecraft/wilds"
        retired.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, "stopped-volume retirement"):
            startup.require_preparation(self.data)
        self.assertTrue(retired.is_dir())

    def test_linked_or_incomplete_marker_is_refused(self):
        marker = self.data / startup.MARKER
        marker.write_text(json.dumps({"schemaVersion": 1, "status": "PREPARED"}))
        with self.assertRaisesRegex(ValueError, "incomplete"):
            startup.require_preparation(self.data)
        marker.unlink()
        marker.symlink_to(self.data / "absent")
        with self.assertRaisesRegex(ValueError, "cannot be linked"):
            startup.require_preparation(self.data)


if __name__ == "__main__":
    unittest.main()

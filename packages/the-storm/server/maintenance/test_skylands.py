import json
import tempfile
import unittest
from pathlib import Path

from maintenance import skylands

SHIPPED = Path(__file__).resolve().parents[1] / "owned/plugins/TheStorm/skylands.json"


class SkylandsStartupTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.data = Path(directory.name)
        self.dimension = self.data / "world/dimensions/minecraft/skylands"
        self.marker = self.data / skylands.MARKER

    def test_fresh_world_records_identity_without_precreating_the_dimension(self):
        skylands.require_generation(self.data, SHIPPED)
        self.assertEqual(json.loads(self.marker.read_bytes()), skylands.identity(SHIPPED))
        self.assertFalse(self.dimension.exists())
        original = self.marker.read_bytes()
        self.dimension.mkdir(parents=True)
        skylands.require_generation(self.data, SHIPPED)
        self.assertEqual(self.marker.read_bytes(), original)

    def test_classic_world_is_refused_without_changing_existing_data(self):
        self.dimension.mkdir(parents=True)
        saved = self.dimension / "native-sentinel"
        saved.write_bytes(b"existing skylands")
        with self.assertRaisesRegex(ValueError, "finish offline replacement"):
            skylands.require_generation(self.data, SHIPPED)
        self.assertFalse(self.marker.exists())
        self.assertEqual(saved.read_bytes(), b"existing skylands")

    def test_different_seed_world_or_format_is_refused(self):
        for key, value in (("seed", 90210), ("world", "other")):
            with self.subTest(key=key):
                marker = skylands.identity(SHIPPED) | {key: value}
                self.marker.write_text(json.dumps(marker))
                with self.assertRaisesRegex(ValueError, "identity changed"):
                    skylands.require_generation(self.data, SHIPPED)
                self.assertEqual(json.loads(self.marker.read_bytes()), marker)

    def test_corrupt_or_unknown_marker_is_refused(self):
        for value in (b"truncated", b"[]", b'{"world":"skylands","seed":1731.0,"format":"layered-v1"}'):
            with self.subTest(value=value):
                self.marker.write_bytes(value)
                with self.assertRaises(ValueError):
                    skylands.require_generation(self.data, SHIPPED)
                self.assertEqual(self.marker.read_bytes(), value)

    def test_legacy_world_or_linked_paths_are_refused(self):
        legacy = self.data / "skylands"
        legacy.mkdir()
        with self.assertRaisesRegex(ValueError, "Legacy Skylands"):
            skylands.require_generation(self.data, SHIPPED)
        legacy.rmdir()
        for path in (self.data / "world", self.marker):
            with self.subTest(path=path):
                path.symlink_to(self.data / "absent")
                with self.assertRaisesRegex(ValueError, "regular"):
                    skylands.require_generation(self.data, SHIPPED)
                path.unlink()

    def test_invalid_boot_identity_cannot_create_a_marker(self):
        config = self.data / "invalid.json"
        for change in ({"seed": True}, {"seed": 2**63}, {"world": "../skylands"}, {"format": "classic"}, {"extra": 1}):
            with self.subTest(change=change):
                config.write_text(json.dumps(skylands.identity(SHIPPED) | change))
                with self.assertRaisesRegex(ValueError, "Skylands requires"):
                    skylands.require_generation(self.data, config)
                self.assertFalse(self.marker.exists())


if __name__ == "__main__":
    unittest.main()

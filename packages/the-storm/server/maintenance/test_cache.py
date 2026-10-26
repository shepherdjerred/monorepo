import importlib.util
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from maintenance import cache
from maintenance import files as storage
from maintenance.values import JsonObject


class CacheRetirementTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.data, self.cache = root / "data", root / "cache"
        (self.data / "world").mkdir(parents=True)
        (self.data / "world/level.dat").write_bytes(b"retained world")
        (self.data / "bluemap").mkdir()
        (self.data / "bluemap/tile.gz").write_bytes(b"expensive old render")
        self.cache.mkdir()
        self.jar = root / "candidate.jar"
        self.jar.write_bytes(b"unchanged published plugin")
        source = Path(__file__).resolve().parents[3] / "homelab/src/cdk8s/src/misc/minecraft/bluemap-storage/bluemap.py"
        specification = importlib.util.spec_from_file_location("bluemap_storage_test_asset", source)
        if specification is None or specification.loader is None:
            raise RuntimeError("BlueMap storage test asset is missing")
        self.asset = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.asset)
        mocked_mounts = patch.object(self.asset, "mounts")
        mocked_mounts.start()
        self.addCleanup(mocked_mounts.stop)
        asset = patch.object(cache, "load_asset", return_value=self.asset)
        asset.start()
        self.addCleanup(asset.stop)
        copy = self.asset.copy(self.data, self.cache)
        self.plan = JsonObject(
            {
                "scope": "bluemap-storage",
                "requestId": str(uuid.uuid4()),
                "candidateJarSha256": storage.digest(self.jar),
                "manifestSha256": copy["manifestSha256"],
            }
        )

    def test_removes_only_the_accepted_original_and_preserves_new_renders_and_world(self):
        (self.cache / "tile.gz").write_bytes(b"new render after startup")
        result = cache.retire(self.data, self.cache, self.plan, self.jar)
        self.assertEqual(result["phase"], "INSTALLED")
        self.assertEqual(result["unrelatedFiles"], "UNCHANGED")
        self.assertFalse((self.data / "bluemap").exists())
        self.assertEqual((self.data / "world/level.dat").read_bytes(), b"retained world")
        self.assertEqual((self.cache / "tile.gz").read_bytes(), b"new render after startup")
        self.assertEqual(cache.retire(self.data, self.cache, self.plan, self.jar), result)

    def test_world_drift_after_partial_cleanup_prevents_resume(self):
        with patch.object(self.asset, "retire_source", side_effect=OSError("interrupted")), self.assertRaises(OSError):
            cache.retire(self.data, self.cache, self.plan, self.jar)
        (self.data / "world/level.dat").write_bytes(b"unexpected world writer")
        with self.assertRaisesRegex(ValueError, "unrelated world data"):
            cache.retire(self.data, self.cache, self.plan, self.jar)
        self.assertTrue((self.data / "bluemap/tile.gz").exists())


if __name__ == "__main__":
    unittest.main()

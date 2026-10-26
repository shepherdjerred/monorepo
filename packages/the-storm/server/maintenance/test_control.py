import base64
import tempfile
import unittest
from pathlib import Path

from maintenance import control
from maintenance import files as storage


class MaintenanceControlTest(unittest.TestCase):
    def test_offline_plan_seals_source_and_inputs_without_cluster_or_backup_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            (data / "world").mkdir(parents=True)
            (data / "world/level.dat").write_bytes(b"native metadata")
            candidate, native, evidence = (root / name for name in ("candidate.jar", "native.class", "sites.json"))
            candidate.write_bytes(b"reviewed plugin")
            native.write_bytes(b"reviewed class")
            storage.save(evidence, {
                "region": {"world": "world", "min": {"x": 71, "y": 68, "z": 67},
                           "size": {"x": 1, "y": 3, "z": 1},
                           "palette": ["minecraft:stone", "minecraft:air"],
                           "blocks": base64.b64encode(bytes.fromhex("000000000100000001000000")).decode()},
                "sites": [{"world": "world", "x": 71, "y": 69, "z": 67}],
            })
            output = root / "plan.json"
            original = storage.files(data)
            plan = control.seal(data, output, candidate, evidence, native, "published-image")
            self.assertEqual(plan.strings("files"), original)
            self.assertEqual(storage.files(data), original)
            self.assertEqual(plan.string("nativeClassSha256"), storage.digest(native))
            self.assertEqual(plan.objects("graveSites")[0]["y"], 69)
            self.assertEqual(len(plan.objects("borders")), 7)
            with self.assertRaisesRegex(ValueError, "must be new"):
                control.seal(data, output, candidate, evidence, native, "published-image")

    def test_recovery_site_requires_captured_solid_ground(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / "sites.json"
            storage.save(evidence, {
                "region": {"world": "world", "min": {"x": 0, "y": 68, "z": 0},
                           "size": {"x": 1, "y": 3, "z": 1}, "palette": ["minecraft:air"],
                           "blocks": base64.b64encode(bytes(12)).decode()},
                "sites": [{"world": "world", "x": 0, "y": 69, "z": 0}],
            })
            with self.assertRaisesRegex(ValueError, "verified solid ground"):
                control.sites(evidence)


if __name__ == "__main__":
    unittest.main()

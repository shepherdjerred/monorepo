import copy
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import restoration_files as storage
import restoration_install
import restoration_resources as resources
import test_restoration_install as fixtures
from restoration_json import JsonObject


class RestorationResourceTest(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.RestorationInstallTest()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.data, self.jar = fixture.data, fixture.jar
        restoration_install.install(self.data, fixture.payload, fixture.plan, self.jar)
        self.payload = self.data.parent / "fresh-resources"
        self.payload.mkdir()
        for name in resources.PATHS:
            path = self.payload / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
        (self.data / "world/dimensions/minecraft/overworld/data").mkdir(parents=True)
        self.prepared = JsonObject(
            {
                **{
                    key: fixture.plan[key] for key in ("requestId", "candidateImage", "candidateJarSha256", "backupUid")
                },
                "receiptSha256": "c" * 64,
                "installationFiles": storage.files(self.payload),
            }
        )
        self.before = storage.files(self.data, exclude_workspace=True)

    def install(self):
        return resources.install(self.data, self.payload, self.prepared, self.jar)

    def test_only_nine_metadata_files_added_and_exact_repetition_is_safe(self):
        result = self.install()
        self.assertEqual(result["phase"], "VERIFIED")
        self.assertEqual(result["files"], 9)
        for dimension in resources.DIMENSIONS:
            self.assertEqual(list((self.data / f"world/dimensions/minecraft/{dimension}/region").iterdir()), [])
        self.assertEqual(
            storage.files(self.data, exclude_workspace=True),
            {
                **self.before,
                **self.prepared.strings("installationFiles"),
            },
        )
        self.assertEqual(self.install(), result)

    def test_existing_resource_terrain_and_linked_parent_refused(self):
        root = self.data / "world/dimensions/minecraft/wilds"
        root.mkdir()
        (root / "old-terrain.mca").write_bytes(b"do not overwrite")
        with self.assertRaisesRegex(ValueError, "existing terrain"):
            self.install()
        (root / "old-terrain.mca").unlink()
        root.rmdir()
        root.symlink_to(self.payload, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "linked"):
            self.install()

    def test_wrong_plugin_and_extra_payload_refused_before_changes(self):
        self.jar.write_bytes(b"foreign jar")
        with self.assertRaisesRegex(ValueError, "exact published"):
            self.install()
        self.assertEqual(storage.files(self.data, exclude_workspace=True), self.before)
        self.prepared["candidateJarSha256"] = storage.digest(self.jar)
        (self.payload / "extra").write_bytes(b"not allowed")
        with self.assertRaisesRegex(ValueError, "sealed metadata"):
            self.install()

    def test_interrupted_atomic_copy_resumes_but_retained_world_change_refuses(self):
        replace = type(self.data).replace
        calls = 0

        def fail(source: Path, destination: Path):
            nonlocal calls
            if source.name == "resource-copy.writing":
                calls += 1
                if calls == 3:
                    raise OSError("interrupted")
            return replace(source, destination)

        with patch("pathlib.Path.replace", fail), self.assertRaisesRegex(OSError, "interrupted"):
            self.install()
        result = self.install()
        self.assertEqual(result["files"], 9)
        (self.data / "world/level.dat").write_bytes(b"foreign writer")
        with self.assertRaisesRegex(ValueError, "retained data changed"):
            self.install()

    def test_manifest_cannot_target_any_other_world_or_container_database(self):
        manifest = copy.deepcopy(self.prepared.strings("installationFiles"))
        manifest[storage.DATABASE] = "d" * 64
        with self.assertRaisesRegex(ValueError, "only nine"):
            resources.validate_files(manifest)

    def test_retry_normalizes_permissions_after_copy_completed_before_parent_normalization(self):
        chown = os.chown
        copied = None

        def interrupted(path: Path, uid: int, gid: int) -> None:
            nonlocal copied
            path = Path(path)
            if path.is_file() and path.name != "resource-copy.writing":
                copied = path
                path.chmod(0o600)
                path.parent.chmod(0o700)
                raise OSError("interrupted after atomic replacement")
            return chown(path, uid, gid)

        with patch.object(resources.os, "chown", side_effect=interrupted), self.assertRaisesRegex(OSError, "atomic"):
            self.install()
        self.assertIsNotNone(copied)
        result = self.install()
        self.assertEqual(result["phase"], "VERIFIED")
        for name in resources.PATHS:
            destination = self.data / name
            self.assertEqual(destination.stat().st_mode & 0o777, 0o660)
            self.assertEqual(destination.parent.stat().st_mode & 0o777, 0o770)

    def test_receipt_and_payload_cannot_be_changed_together_after_native_preparation(self):
        staging = self.data.parent / "staging"
        root = staging / "resource-bootstrap"
        root.mkdir(parents=True)
        receipt = root / "receipt.json"
        receipt.write_text(json.dumps({"files": self.prepared["installationFiles"]}))
        (staging / "restore-journal.json").write_text(json.dumps({"resourceReceiptSha256": storage.digest(receipt)}))
        changed = next(iter(resources.PATHS))
        (self.payload / changed).write_bytes(b"replaced native metadata")
        receipt.write_text(json.dumps({"files": storage.files(self.payload)}))
        with self.assertRaisesRegex(ValueError, "changed after native preparation"):
            resources.plan(staging, JsonObject({}), self.jar)


if __name__ == "__main__":
    unittest.main()

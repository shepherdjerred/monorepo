"""Exercise the render migration without Paper, Kubernetes, or mounted test volumes."""

import json
import tempfile
import unittest
from pathlib import Path
from typing import BinaryIO
from unittest.mock import patch

import bluemap as storage


class BlueMapStorageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.data = root / "data"
        self.cache = root / "cache"
        self.source = self.data / "bluemap"
        self.source.mkdir(parents=True)
        self.cache.mkdir()
        (self.data / "world").mkdir()
        (self.data / "world/level.dat").write_bytes(b"world must survive")
        (self.source / "web/maps/frontier").mkdir(parents=True)
        (self.source / "web/maps/frontier/tile.gz").write_bytes(bytes(range(256)))
        (self.source / "pluginState.json").write_text('{"maps":{}}', encoding="utf-8")
        # Only mount discovery is mocked; checksums, copies and cleanup use real files.
        self.mounts = patch.object(storage, "mounts")
        self.mounts.start()
        self.addCleanup(self.mounts.stop)

    def test_complete_copy_preserves_original_and_all_render_bytes(self) -> None:
        expected = storage.inventory(self.source)
        result = storage.copy(self.data, self.cache)
        self.assertEqual(result["phase"], "VERIFIED")
        self.assertEqual(storage.inventory(self.cache), expected)
        self.assertEqual(storage.inventory(self.source), expected)
        self.assertEqual(result["manifestSha256"], storage.manifest_digest(expected))

    def test_same_filesystem_is_refused_without_mount_mock(self) -> None:
        self.mounts.stop()
        with self.assertRaisesRegex(ValueError, "separate mounted filesystem"):
            storage.copy(self.data, self.cache)
        self.assertFalse((self.cache / storage.RECEIPT).exists())

    def test_subsequent_boot_does_not_replace_new_renders_with_old_cache(self) -> None:
        storage.copy(self.data, self.cache)
        tile = self.cache / "web/maps/frontier/tile.gz"
        tile.write_bytes(b"new render after cutover")
        result = storage.copy(self.data, self.cache)
        self.assertTrue(result["reused"])
        self.assertEqual(tile.read_bytes(), b"new render after cutover")

    def test_interrupted_copy_resumes_and_replaces_partial_file(self) -> None:
        def interrupted(source: BinaryIO, destination: BinaryIO, **_arguments: object) -> None:
            destination.write(source.read(2))
            raise OSError("interrupted write")

        with (patch.object(storage.shutil, "copyfileobj", side_effect=interrupted),
              self.assertRaisesRegex(OSError, "interrupted write")):
            storage.copy(self.data, self.cache)
        self.assertEqual(storage.read_receipt(self.cache)["phase"], "COPYING")
        storage.copy(self.data, self.cache)
        self.assertEqual(storage.inventory(self.cache), storage.inventory(self.source))

    def test_changed_original_is_refused_on_resume(self) -> None:
        with (patch.object(storage.shutil, "copyfileobj", side_effect=OSError("interrupted")),
              self.assertRaises(OSError)):
            storage.copy(self.data, self.cache)
        (self.source / "pluginState.json").write_bytes(b"unexpected writer")
        with self.assertRaisesRegex(ValueError, "changed during migration"):
            storage.copy(self.data, self.cache)

    def test_unowned_nonempty_destination_is_preserved(self) -> None:
        unexpected = self.cache / "unrelated"
        unexpected.write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "no migration receipt"):
            storage.copy(self.data, self.cache)
        self.assertEqual(unexpected.read_bytes(), b"keep")

    def test_links_and_unsafe_manifests_are_refused(self) -> None:
        (self.source / "linked").symlink_to(self.data / "world/level.dat")
        with self.assertRaisesRegex(ValueError, "linked or special"):
            storage.copy(self.data, self.cache)
        for name in ("../world/level.dat", "/world/level.dat", "web/../level.dat", "./tile", ""):
            with self.subTest(name=name), self.assertRaises(ValueError):
                storage.checked_manifest({name: "a" * 64})

    def test_retirement_requires_exact_acceptance_and_preserves_world_and_new_cache(self) -> None:
        result = storage.copy(self.data, self.cache)
        with self.assertRaisesRegex(ValueError, "different BlueMap manifest"):
            storage.retire_source(self.data, self.cache, "a" * 64)
        current = self.cache / "pluginState.json"
        current.write_bytes(b"state updated by BlueMap")
        storage.retire_source(self.data, self.cache, str(result["manifestSha256"]))
        self.assertFalse(self.source.exists())
        self.assertEqual(current.read_bytes(), b"state updated by BlueMap")
        self.assertEqual((self.data / "world/level.dat").read_bytes(), b"world must survive")
        self.assertEqual(storage.read_receipt(self.cache)["phase"], "SOURCE_REMOVED")
        self.assertTrue(storage.copy(self.data, self.cache)["reused"])

    def test_retirement_refuses_changed_original(self) -> None:
        result = storage.copy(self.data, self.cache)
        (self.source / "pluginState.json").write_bytes(b"unreviewed")
        with self.assertRaisesRegex(ValueError, "changed since verified"):
            storage.retire_source(self.data, self.cache, str(result["manifestSha256"]))
        self.assertTrue(self.source.is_dir())

    def test_restored_world_initializes_a_fresh_cache(self) -> None:
        import shutil

        shutil.rmtree(self.source)
        result = storage.copy(self.data, self.cache)
        self.assertEqual(result["phase"], "NEW_CACHE")
        self.assertEqual(storage.inventory(self.cache), {})

    def test_receipt_cannot_authorize_deleting_outside_original_cache(self) -> None:
        result = storage.copy(self.data, self.cache)
        receipt = storage.read_receipt(self.cache)
        receipt["files"] = {"../world/level.dat": "a" * 64}
        (self.cache / storage.RECEIPT).write_text(json.dumps(receipt), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unsafe BlueMap manifest"):
            storage.retire_source(self.data, self.cache, str(result["manifestSha256"]))
        self.assertEqual((self.data / "world/level.dat").read_bytes(), b"world must survive")


if __name__ == "__main__":
    unittest.main()

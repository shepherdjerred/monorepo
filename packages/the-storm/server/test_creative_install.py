import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import creative_install
import restoration_files as storage
from restoration_json import JsonObject


class CreativeInstallationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data, self.payload = self.root / "data", self.root / "payload"
        self.jar = self.root / "TheStorm.jar"
        self.jar.write_bytes(b"exact candidate")
        for name, contents in {
            "world/level.dat": b"survival terrain",
            "world/playerdata/player.dat": b"survival inventory",
            "plugins/TheStorm/the-storm.db": b"live identities",
            creative_install.REGISTRY: b"existing worlds",
        }.items():
            target = self.data / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
        for name, contents in {
            "creative/level.dat": b"creative metadata",
            "creative/region/r.0.-1.mca": b"recovered terrain",
            creative_install.REGISTRY: b"existing worlds plus creative",
        }.items():
            target = self.payload / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
        self.plan = JsonObject(
            {
                "status": "VERIFIED_CREATIVE_INSTALLATION_PLAN",
                "requestId": "3e5117f2-3f1b-46f6-a41c-2d9fb22026dc",
                "candidateJarSha256": storage.digest(self.jar),
                "originalFiles": storage.files(self.data),
                "files": storage.files(self.payload),
            }
        )
        self.metadata = patch.object(creative_install.os, "chown")
        self.metadata.start()
        self.addCleanup(self.metadata.stop)

    def install(self):
        return creative_install.install(self.data, self.payload, self.plan, self.jar)

    def test_addition_preserves_all_original_player_and_survival_files(self):
        self.assertEqual(self.install()["phase"], "INSTALLED")
        self.assertEqual(self.install()["phase"], "INSTALLED")
        for name, checksum in self.plan.strings("originalFiles").items():
            if name != creative_install.REGISTRY:
                self.assertEqual(storage.digest(self.data / name), checksum)
        retained = self.data / storage.WORKSPACE / self.plan.string("requestId") / "creative-install/worlds-before.yml"
        self.assertEqual(retained.read_bytes(), b"existing worlds")

    def test_old_player_import_and_survival_replacement_are_refused(self):
        for name in ("creative/playerdata/old.dat", "world/level.dat", "plugins/TheStorm/the-storm.db"):
            with self.subTest(name=name):
                plan = JsonObject({**self.plan, "files": {**self.plan.strings("files"), name: "a" * 64}})
                with self.assertRaises(ValueError):
                    creative_install.installation_files(plan)

    def test_existing_creative_and_backup_drift_are_refused(self):
        (self.data / "creative").mkdir()
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.install()
        (self.data / "creative").rmdir()
        (self.data / "plugins/TheStorm/the-storm.db").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed since"):
            self.install()

    def test_resume_after_world_rename_preserves_original_registry(self):
        rename = Path.rename

        def interrupted(source: Path, target: Path) -> Path:
            result = rename(source, target)
            if source.name == "creative":
                raise OSError("interrupted after owned world rename")
            return result

        with patch.object(Path, "rename", interrupted), self.assertRaises(OSError):
            self.install()
        self.assertEqual((self.data / creative_install.REGISTRY).read_bytes(), b"existing worlds")
        self.assertEqual(self.install()["phase"], "INSTALLED")

    def test_changed_jar_and_linked_payload_cannot_authorize_a_write(self):
        self.jar.write_bytes(b"different image")
        with self.assertRaisesRegex(ValueError, "inputs"):
            self.install()
        self.assertFalse((self.data / storage.WORKSPACE).exists())
        self.jar.write_bytes(b"exact candidate")
        target = self.payload / "creative/level.dat"
        target.unlink()
        target.symlink_to(self.jar)
        with self.assertRaisesRegex(ValueError, "linked"):
            self.install()
        self.assertFalse((self.data / storage.WORKSPACE).exists())


if __name__ == "__main__":
    unittest.main()

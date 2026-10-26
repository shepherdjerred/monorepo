import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import restoration_files as storage
from restoration_json import JsonObject

from maintenance import retire


class RetirementTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.request = str(uuid.uuid4())
        for name, value in {
            "world/level.dat": b"unchanged level metadata",
            "world/players/data/00000000-0000-0000-0000-000000000001.dat": b"old player",
            "world/dimensions/minecraft/wilds/region/r.0.0.mca": b"retired Wilds",
            "world/dimensions/minecraft/peaks/region/r.0.0.mca": b"retired Peaks",
            "world/dimensions/minecraft/creative/region/r.20.20.mca": b"outside circle retained",
            "world/dimensions/minecraft/skylands/region/r.0.0.mca": b"retained skylands",
            "plugins/Chunky/tasks/frontier.properties": b"old square task",
            "plugins/Chunky/tasks/map2.properties": b"unrelated task",
            retire.REGISTRY: b"old registry",
            storage.DATABASE: b"old database",
            ".storm-restoration/previous-request/original/players.dat": b"recovery archive",
        }.items():
            path = self.data / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
        self.original = storage.files(self.data)
        self.proof = self.root / "proof.json"
        storage.save(
            self.proof,
            {
                "schemaVersion": 1,
                "status": "VERIFIED",
                "requestId": self.request,
                "backupUid": "backup",
                "sourceVolumeUid": "source",
                "restoredVolumeUid": "independent-restore",
                "files": self.original,
            },
        )
        self.jar = self.root / "plugin.jar"
        self.jar.write_bytes(b"published candidate plugin")
        self.plan = JsonObject(
            {
                "scope": "circular-worlds",
                "requestId": self.request,
                "backupUid": "backup",
                "sourceVolumeUid": "source",
                "restoredVolumeUid": "independent-restore",
                "candidateJarSha256": storage.digest(self.jar),
                "backupProofSha256": storage.digest(self.proof),
            }
        )

    def prepared(
        self, data: Path, root: Path, plan: JsonObject, original: dict[str, str], operator: Path
    ) -> JsonObject:
        expected = {}
        for name in (retire.REGISTRY, storage.DATABASE, "world/players/data/00000000-0000-0000-0000-000000000001.dat"):
            path = root / "payload" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"verified replacement for " + name.encode())
            expected[name] = storage.digest(path)
        return JsonObject(
            {
                "phase": "PREPARED",
                "plan": plan,
                "files": expected,
                "native": {"inventoriesPreserved": True},
                "database": {"itemsAndProgression": "UNCHANGED"},
            }
        )

    def install(self):
        with patch.object(retire, "prepare", side_effect=self.prepared):
            return retire.install(self.data, self.proof, self.plan, self.root, self.jar)

    def test_only_retired_worlds_and_affected_tasks_are_deleted(self):
        receipt = self.install()
        self.assertEqual(receipt["phase"], "INSTALLED")
        self.assertEqual(receipt["unrelatedFiles"], "UNCHANGED")
        for name in self.original:
            if name.startswith(retire.PREFIXES) or name in retire.TASKS:
                self.assertFalse((self.data / name).exists())
            elif name not in receipt.strings("files"):
                self.assertEqual(storage.digest(self.data / name), self.original[name])
        for name in ("wilds", "peaks"):
            self.assertFalse((self.data / "world/dimensions/minecraft" / name).exists())
        self.assertEqual(self.install(), receipt)

    def test_source_drift_or_aliased_restore_refused_before_writes(self):
        self.plan["restoredVolumeUid"] = "source"
        with self.assertRaisesRegex(ValueError, "independently verified"):
            self.install()
        self.assertEqual(storage.files(self.data), self.original)

    def test_foreign_file_during_installation_prevents_retirement(self):
        def foreign(data: Path, root: Path, plan: JsonObject, original: dict[str, str], operator: Path) -> JsonObject:
            result = self.prepared(data, root, plan, original, operator)
            path = self.data / "world/dimensions/minecraft/wilds/foreign.dat"
            path.write_bytes(b"unexpected write")
            return result

        with (
            patch.object(retire, "prepare", side_effect=foreign),
            self.assertRaisesRegex(ValueError, "Unrelated terrain"),
        ):
            retire.install(self.data, self.proof, self.plan, self.root, self.jar)
        self.assertTrue((self.data / "world/dimensions/minecraft/wilds/region/r.0.0.mca").exists())

    def test_resume_after_one_atomic_replacement(self):
        copy = retire.shutil.copyfile
        calls = 0

        def interrupted(source: Path, target: Path) -> Path:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("interrupted after first replacement")
            return copy(source, target)

        with (
            patch.object(retire.shutil, "copyfile", side_effect=interrupted),
            self.assertRaisesRegex(OSError, "interrupted"),
        ):
            self.install()
        self.assertTrue((self.data / "world/dimensions/minecraft/wilds/region/r.0.0.mca").exists())
        self.assertEqual(self.install()["phase"], "INSTALLED")

    def test_unapproved_payload_cannot_replace_terrain(self):
        with self.assertRaisesRegex(ValueError, "may replace only"):
            retire.installation_files(
                {retire.REGISTRY: "a" * 64, storage.DATABASE: "b" * 64, "world/level.dat": "c" * 64}
            )


if __name__ == "__main__":
    unittest.main()

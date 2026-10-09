import shutil
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import restoration_files as storage
import restoration_install
import restoration_maps
import test_restoration_install as fixtures


class RestorationMapsTest(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.RestorationInstallTest()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.data = fixture.data
        self.request = fixture.plan.string("requestId")
        self.sha = storage.digest(fixture.jar)
        restoration_install.install(self.data, fixture.payload, fixture.plan, fixture.jar)
        jar = self.data / "plugins/TheStorm.jar"
        shutil.copyfile(fixture.jar, jar)
        self.config = self.data / "plugins/BlueMap/maps/world.conf"
        self.config.parent.mkdir(parents=True)
        self.config.write_text(
            'world: "world"\ndimension: "minecraft:overworld"\n'
            "ignore-missing-light-data: false\nmin-inhabited-time: 0\nambient-light: 0.1\n"
        )
        self.before = storage.files(self.data, exclude_workspace=True)

    def repair(self):
        return restoration_maps.render_unlit(self.data, self.request, self.sha)

    def test_only_renderer_lighting_changes_and_repetition_is_exact(self):
        result = self.repair()
        self.assertEqual(result["phase"], "VERIFIED")
        self.assertEqual(result["worldTicks"], 0)
        after = storage.files(self.data, exclude_workspace=True)
        self.assertEqual(
            [name for name in self.before if self.before[name] != after[name]], ["plugins/BlueMap/maps/world.conf"]
        )
        self.assertEqual(self.repair(), result)
        self.assertIn("ambient-light: 1\n", self.config.read_text())

    def test_previous_missing_light_repair_upgrades_from_recorded_original(self):
        original = self.config.read_text()
        self.config.write_text(original.replace("ignore-missing-light-data: false", "ignore-missing-light-data: true"))
        storage.save(self.data / storage.WORKSPACE / self.request / "bluemap-render.json", {
            "requestId": self.request, "candidateJarSha256": self.sha, "original": original,
            "phase": "VERIFIED", "configSha256": storage.digest(self.config), "worldTicks": 0,
        })
        result = self.repair()
        self.assertEqual(result["configSha256"], storage.digest(self.config))
        self.assertIn("ambient-light: 1\n", self.config.read_text())
        self.assertEqual(self.repair(), result)

    def test_unrecognized_original_ambient_light_refused(self):
        original = self.config.read_text().replace("ambient-light: 0.1", "ambient-light: 0.4")
        self.config.write_text(original)
        with self.assertRaisesRegex(ValueError, "main-overworld"):
            self.repair()
        self.assertEqual(self.config.read_text(), original)

    def test_atomic_replacement_interruption_resumes_from_recorded_original(self):
        replace = Path.replace

        def interrupted(source: Path, destination: Path):
            value = replace(source, destination)
            if destination.name == "world.conf":
                raise OSError("interrupted after config replacement")
            return value

        with patch.object(Path, "replace", interrupted), self.assertRaisesRegex(OSError, "interrupted"):
            self.repair()
        self.assertEqual(self.repair()["phase"], "VERIFIED")

    def test_exclusive_staging_refuses_links_without_changing_the_target(self):
        identifier = uuid.UUID("00000000-0000-0000-0000-000000000001")
        staging = self.data / storage.WORKSPACE / self.request / f"bluemap-config-{identifier}.writing"
        target = self.data / "untouched"
        target.write_bytes(b"preserved unrelated content")
        before = target.stat()
        original = self.config.read_bytes()
        staging.symlink_to(target)
        with patch.object(restoration_maps.uuid, "uuid4", return_value=identifier), self.assertRaises(FileExistsError):
            self.repair()
        self.assertEqual(target.read_bytes(), b"preserved unrelated content")
        self.assertEqual((target.stat().st_uid, target.stat().st_gid, target.stat().st_mode),
                         (before.st_uid, before.st_gid, before.st_mode))
        self.assertEqual(self.config.read_bytes(), original)
        self.assertTrue(staging.is_symlink())

    def test_atomic_copy_preserves_original_permissions(self):
        self.config.chmod(0o640)
        before = self.config.stat()
        self.repair()
        after = self.config.stat()
        self.assertEqual((after.st_uid, after.st_gid, after.st_mode), (before.st_uid, before.st_gid, before.st_mode))

    def test_foreign_config_wrong_plugin_and_changed_receipt_refused(self):
        self.repair()
        changed = self.config.read_text() + "enable-hires: false\n"
        self.config.write_text(changed)
        with self.assertRaisesRegex(ValueError, "outside the bounded"):
            self.repair()
        self.assertEqual(self.config.read_text(), changed)
        (self.data / "plugins/TheStorm.jar").write_bytes(b"different candidate")
        with self.assertRaisesRegex(ValueError, "this installed candidate"):
            self.repair()

    def test_linked_map_and_other_dimension_refused_before_changes(self):
        original = self.config.read_text()
        self.config.write_text(original.replace("minecraft:overworld", "minecraft:the_nether"))
        with self.assertRaisesRegex(ValueError, "main-overworld"):
            self.repair()
        self.config.unlink()
        self.config.symlink_to(self.data / "plugins/TheStorm.jar")
        with self.assertRaisesRegex(ValueError, "linked"):
            self.repair()


if __name__ == "__main__":
    unittest.main()

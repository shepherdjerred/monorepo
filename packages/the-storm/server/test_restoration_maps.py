import shutil
import unittest
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
            "ignore-missing-light-data: false\nmin-inhabited-time: 0\n"
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

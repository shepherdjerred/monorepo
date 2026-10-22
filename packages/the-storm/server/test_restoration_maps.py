import shutil
import unittest
from pathlib import Path

import restoration_files as storage
import restoration_install
import restoration_maps
import test_restoration_install as fixtures

OWNED = Path(__file__).resolve().parent / "owned/plugins/BlueMap/maps"


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
        self.maps = self.data / "plugins/BlueMap/maps"
        self.maps.mkdir(parents=True)
        for name in restoration_maps.ARCHIVE_MAPS:
            shutil.copyfile(OWNED / name, self.maps / name)
        self.before = storage.files(self.data, exclude_workspace=True)

    def verify(self):
        return restoration_maps.render_unlit(self.data, self.request, self.sha)

    def test_shipped_archive_maps_render_converted_chunks_without_changing_the_volume(self):
        result = self.verify()
        self.assertEqual(result["phase"], "VERIFIED")
        self.assertEqual(result["worldTicks"], 0)
        self.assertEqual(result["configSha256"], storage.digest(OWNED / "world.conf"))
        self.assertEqual(storage.files(self.data, exclude_workspace=True), self.before)
        self.assertEqual(self.verify(), result)

    def test_generated_dark_or_missing_light_settings_are_refused_without_repair(self):
        for name, old, new in (
            ("world.conf", "ambient-light: 1\n", "ambient-light: 0.1\n"),
            ("map2.conf", "ignore-missing-light-data: true\n", "ignore-missing-light-data: false\n"),
            ("map2.conf", 'dimension: "minecraft:map2"', 'dimension: "minecraft:overworld"'),
        ):
            with self.subTest(name=name, setting=new.strip()):
                config = self.maps / name
                original = config.read_text()
                config.write_text(original.replace(old, new))
                changed = config.read_text()
                with self.assertRaisesRegex(ValueError, "lacks converted-chunk lighting: " + name):
                    self.verify()
                self.assertEqual(config.read_text(), changed)
                config.write_text(original)

    def test_missing_or_linked_map_and_wrong_plugin_refused(self):
        (self.maps / "map2.conf").unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()
        (self.maps / "map2.conf").symlink_to(self.data / "plugins/TheStorm.jar")
        with self.assertRaisesRegex(ValueError, "linked"):
            self.verify()
        (self.maps / "map2.conf").unlink()
        shutil.copyfile(OWNED / "map2.conf", self.maps / "map2.conf")
        (self.data / "plugins/TheStorm.jar").write_bytes(b"different candidate")
        with self.assertRaisesRegex(ValueError, "this installed candidate"):
            self.verify()


if __name__ == "__main__":
    unittest.main()

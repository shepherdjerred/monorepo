import importlib.util
import json
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
SOURCE = PACKAGE / "tools/skylands/towers/protection.py"
SPEC = importlib.util.spec_from_file_location("skylands_protection", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Protection generator is missing")
PROTECTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROTECTION)


class SkylandsProtectionTest(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads((PACKAGE / "server/owned/plugins/TheStorm/skytravel.json").read_text())
        self.layout = json.loads((SOURCE.parent / "approaches.json").read_text())

    def test_uncommissioned_sites_never_reserve_bare_terrain(self):
        for tower in self.catalog["towers"]:
            tower["commissioned"] = False
        generated = PROTECTION.generated(self.catalog, self.layout)
        self.assertEqual(generated, PROTECTION.START + "\n" + PROTECTION.END + "\n")
        self.assertNotIn("id: skylands-towers", generated)

    def test_only_commissioned_sites_receive_aprons_and_approaches(self):
        for tower in self.catalog["towers"]:
            tower["commissioned"] = tower["id"] == "H"
        generated = PROTECTION.generated(self.catalog, self.layout)
        self.assertIn("# H apron.", generated)
        self.assertIn("# H approach:", generated)
        self.assertNotIn("# I1 apron.", generated)
        self.assertIn("from: { x: -38, y: 149, z: 26 }", generated)
        self.assertIn("to: { x: 58, y: 319, z: 122 }", generated)

    def test_shipped_regions_match_the_catalog_and_reviewed_routes(self):
        towns = (PACKAGE / "server/owned/plugins/TheStorm/towns.yml").read_text()
        expected = PROTECTION.generated(self.catalog, self.layout)
        self.assertEqual(PROTECTION.replace_owned(towns, expected), towns)
        self.assertEqual(expected.count(" apron."), 19)

    def test_malformed_boundaries_and_unrelated_suffix_are_refused(self):
        with self.assertRaisesRegex(ValueError, "Malformed"):
            PROTECTION.replace_owned(PROTECTION.START, "replacement")
        with self.assertRaisesRegex(ValueError, "standalone"):
            PROTECTION.replace_owned(
                PROTECTION.LEGACY + "\n  - id: skylands-towers\n  - id: unrelated\n", "replacement"
            )


if __name__ == "__main__":
    unittest.main()

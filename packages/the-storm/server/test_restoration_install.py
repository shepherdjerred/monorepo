import copy
import unittest

import restoration_files
import restoration_install
import test_restoration_files as fixtures
from restoration_json import JsonObject


class RestorationInstallTest(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.RestorationFilesTest()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.data, self.payload = fixture.data, fixture.payload
        self.manifest, self.original = fixture.manifest, fixture.original
        # The writer receives only deployable inputs, never converter evidence.
        (self.payload / "native-verification.log").unlink()
        self.manifest.pop("native-verification.log")
        self.jar = fixture.root / "candidate.jar"
        self.jar.write_bytes(b"candidate")
        self.plan = JsonObject(
            {
                "status": "VERIFIED_INSTALLATION_PLAN",
                "requestId": fixtures.REQUEST,
                "candidateImage": fixtures.IMAGE,
                "candidateJarSha256": restoration_files.digest(self.jar),
                "backupUid": "backup-uid",
                "installationFiles": self.manifest,
                "originalFiles": self.original,
            }
        )

    def test_install_checks_image_and_payload_then_can_resume_the_exact_transaction(self):
        result = restoration_install.install(self.data, self.payload, self.plan, self.jar)
        self.assertEqual(result["phase"], "INSTALLED")
        self.assertEqual(result["coreProtectEpoch"], fixtures.REQUEST)
        self.assertEqual(result["files"], len(self.manifest))
        self.assertEqual(restoration_install.install(self.data, self.payload, self.plan, self.jar), result)

    def test_wrong_baked_plugin_refuses_before_changing_the_volume(self):
        plan = copy.deepcopy(self.plan)
        plan["candidateJarSha256"] = fixtures.JAR
        with self.assertRaisesRegex(ValueError, "exact verified candidate"):
            restoration_install.install(self.data, self.payload, plan, self.jar)
        self.assertEqual(restoration_files.files(self.data), self.original)

    def test_changed_uploaded_payload_refuses_before_changing_the_volume(self):
        (self.payload / "world/level.dat").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "payload changed"):
            restoration_install.install(self.data, self.payload, self.plan, self.jar)
        self.assertEqual(restoration_files.files(self.data), self.original)


if __name__ == "__main__":
    unittest.main()

import copy
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def revision(self):
        restoration_install.install(self.data, self.payload, self.plan, self.jar)
        prior = copy.deepcopy(self.plan)
        (self.payload / "world/region/r.0.0.mca").write_bytes(b"pristine historical terrain without arena overlay")
        self.jar.write_bytes(b"replacement candidate")
        self.plan["candidateImage"] = fixtures.IMAGE.replace("fixture", "replacement")
        self.plan["candidateJarSha256"] = restoration_files.digest(self.jar)
        self.plan["installationFiles"] = restoration_files.files(self.payload)
        self.plan["revisionOf"] = {
            key: prior[key] for key in ("candidateImage", "candidateJarSha256", "installationFiles")
        }
        return self.data / restoration_files.WORKSPACE / fixtures.REQUEST

    def test_revision_preserves_original_and_superseded_installation_and_can_resume(self):
        root = self.revision()
        result = restoration_install.install(self.data, self.payload, self.plan, self.jar)
        self.assertEqual(result["phase"], "INSTALLED")
        self.assertEqual((root / "revision/previous/world/region/r.0.0.mca").read_bytes(), b"historical terrain")
        self.assertEqual((root / "original/world/region/r.0.0.mca").read_bytes(), b"modern terrain")
        self.assertEqual(
            (self.data / "world/region/r.0.0.mca").read_bytes(), b"pristine historical terrain without arena overlay"
        )
        self.assertEqual(restoration_install.install(self.data, self.payload, self.plan, self.jar), result)
        self.assertEqual((self.data / "plugins/CoreProtect/config.yml").read_bytes(), b"logging config")
        self.assertFalse((self.data / "plugins/CoreProtect/database.db").exists())

    def test_revision_rename_interruption_resumes_with_both_versions_intact(self):
        root = self.revision()
        rename = type(root).rename

        def interrupted(source: Path, destination: Path):
            result = rename(source, destination)
            if source == self.data.resolve() / "world":
                raise OSError("injected crash after world archive")
            return result

        with patch.object(type(root), "rename", interrupted), self.assertRaises(OSError):
            restoration_install.install(self.data, self.payload, self.plan, self.jar)
        result = restoration_install.install(self.data, self.payload, self.plan, self.jar)
        self.assertEqual(result["phase"], "INSTALLED")
        self.assertEqual((root / "revision/previous/world/region/r.0.0.mca").read_bytes(), b"historical terrain")

    def test_revision_refuses_changed_prior_plan_or_unrelated_runtime_bytes(self):
        self.revision()
        (self.data / "server.properties").write_bytes(b"unexpected runtime change")
        with self.assertRaises(ValueError):
            restoration_install.install(self.data, self.payload, self.plan, self.jar)
        self.assertEqual((self.data / "world/region/r.0.0.mca").read_bytes(), b"historical terrain")

    def test_revision_refuses_corrupt_old_archive_and_links(self):
        root = self.revision()
        (root / "original/world/level.dat").write_bytes(b"corrupt rollback")
        with self.assertRaises(ValueError):
            restoration_install.install(self.data, self.payload, self.plan, self.jar)
        self.assertFalse((root / "revision").exists())


if __name__ == "__main__":
    unittest.main()

import json
import tempfile
import unittest
import uuid
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import restoration_files as storage
from restoration_json import JsonObject

from maintenance import control


class MaintenanceControlTest(unittest.TestCase):
    def test_first_install_seals_its_inputs_and_resume_cannot_change_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proof, candidate, evidence = (root / name for name in ("proof.json", "candidate.jar", "sites.json"))
            for path in (proof, candidate, evidence, root / "NativePlayerRetirement.class"):
                path.write_bytes(b"sealed fixture input")
            journal = JsonObject(
                {
                    "requestId": str(uuid.uuid4()),
                    "candidateImage": "published-candidate",
                    "volumeUid": "source",
                    "backup": {"uid": "backup"},
                    "restore": {
                        "byteVerification": "VERIFIED",
                        "volumeUid": "restored",
                        "proofPath": str(proof),
                        "proofSha256": storage.digest(proof),
                    },
                }
            )
            operator = ModuleType("maintenance_test_operator")
            vars(operator).update(
                require_restore=MagicMock(),
                require_offline=MagicMock(),
                save=MagicMock(),
                CONTEXT="fixture",
                NAMESPACE="minecraft-tsmc",
                run=MagicMock(
                    return_value=json.dumps(
                        {
                            "phase": "INSTALLED",
                            "scope": "circular-worlds",
                            "candidateJarSha256": storage.digest(candidate),
                            "unrelatedFiles": "UNCHANGED",
                        }
                    )
                ),
            )
            with (
                patch.object(control, "sites", return_value=([], storage.digest(evidence))),
                patch.object(control, "upload", return_value="request-owned-writer") as upload,
            ):
                control.install(operator, root / "journal.json", journal, root, candidate, evidence)
                prepared = journal.object("installationPlan").integer("preparedAt")
                self.assertEqual(journal.object("installation")["phase"], "INSTALLED")
                control.install(operator, root / "journal.json", journal, root, candidate, evidence)
                self.assertEqual(journal.object("installationPlan").integer("preparedAt"), prepared)
                self.assertEqual(upload.call_count, 2)
                candidate.write_bytes(b"different published input")
                with self.assertRaisesRegex(ValueError, "Sealed world retirement inputs changed"):
                    control.install(operator, root / "journal.json", journal, root, candidate, evidence)
                self.assertEqual(upload.call_count, 2)


if __name__ == "__main__":
    unittest.main()

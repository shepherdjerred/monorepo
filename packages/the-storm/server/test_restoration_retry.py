"""A failed storage copy is retained while renewal targets only an empty managed namespace."""

import copy
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

from restoration_json import JsonObject
from restoration_retry import renew_restore


class RenewalTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "journal.json"
        self.journal = JsonObject(
            {
                "requestId": "request",
                "productionWriteAuthorized": False,
                "backup": {"name": "backup", "uid": "backup-uid"},
                "restore": {"name": "restore", "uid": "restore-uid"},
                "restoreNamespace": "minecraft-tsmc-restore-old",
                "backupAttempt": 1,
                "restoreAttempt": 1,
            }
        )
        self.restore = JsonObject(
            {
                "metadata": {"uid": "restore-uid", "labels": {"lease": "request"}},
                "spec": {"backupName": "backup", "namespaceMapping": {"minecraft-tsmc": "minecraft-tsmc-restore-old"}},
                "status": {"phase": "PartiallyFailed", "completionTimestamp": "now"},
            }
        )
        self.namespace = JsonObject({"metadata": {"uid": "target-uid", "labels": {"validation": "minecraft-tsmc"}}})
        self.control = Mock(
            spec=ModuleType,
            require_offline=Mock(),
            read=Mock(side_effect=[self.restore, self.namespace]),
            backup=Mock(return_value=JsonObject({"status": {"phase": "Completed"}})),
            run=Mock(return_value='{"items":[]}'),
            save=Mock(),
            NAMESPACE="minecraft-tsmc",
            SERVER="minecraft-tsmc",
            LEASE="lease",
            DELIVERY_VALIDATION_LABEL="validation",
            DELIVERY_VALIDATION_NAMESPACE="minecraft-tsmc-delivery-validation",
            restored_namespace="minecraft-tsmc-restore-old",
        )

    def test_renewal_retains_old_identity_and_creates_only_a_new_backup(self):
        original = copy.deepcopy(self.journal)
        self.assertEqual(renew_restore(self.control, self.path, self.journal), "minecraft-tsmc-delivery-validation")
        self.assertEqual(self.journal["backupAttempt"], 2)
        self.assertEqual(self.journal["restoreAttempt"], 2)
        self.assertEqual(self.journal.object("deliveryValidation")["restoreNamespaceUid"], "target-uid")
        retained = self.journal.objects("retainedRestoreAttempts")[0]
        self.assertEqual(retained["backup"], original["backup"])
        self.assertEqual(retained.object("restore")["uid"], "restore-uid")
        self.assertEqual(retained["namespace"], original["restoreNamespace"])
        self.assertNotIn("restore", self.journal)
        self.assertNotIn("backup", self.journal)
        self.assertTrue(self.journal["managedRestoreNamespace"])
        self.assertEqual(self.control.backup.call_count, 2)
        self.control.run.assert_called_once_with(
            ["-n", "minecraft-tsmc-delivery-validation", "get", "pods,pvc", "-o", "json"]
        )

    def test_foreign_or_running_restore_never_seals_a_new_target(self):
        original = copy.deepcopy(self.restore)
        for field, value in (("uid", "foreign"), ("phase", "InProgress"), ("completionTimestamp", "")):
            with self.subTest(field=field):
                self.restore = copy.deepcopy(original)
                if field == "uid":
                    self.restore.object("metadata")[field] = value
                else:
                    self.restore.object("status")[field] = value
                self.control.read.side_effect = [self.restore, self.namespace]
                with self.assertRaisesRegex(ValueError, "exact owned"):
                    renew_restore(self.control, self.path, self.journal)
                self.control.save.assert_not_called()

    def test_occupied_namespace_foreign_owner_and_authorized_writer_are_refused(self):
        self.control.run.return_value = '{"items":[{"metadata":{"uid":"retained-copy"}}]}'
        with self.assertRaisesRegex(ValueError, "existing target"):
            renew_restore(self.control, self.path, self.journal)
        self.control.run.return_value = '{"items":[]}'
        self.control.read.side_effect = [self.restore, self.namespace]
        self.namespace.object("metadata").strings("labels")["validation"] = "foreign"
        with self.assertRaisesRegex(ValueError, "source-owned"):
            renew_restore(self.control, self.path, self.journal)
        self.journal["productionWriteAuthorized"] = True
        with self.assertRaisesRegex(ValueError, "writer"):
            renew_restore(self.control, self.path, self.journal)
        self.control.save.assert_not_called()


if __name__ == "__main__":
    unittest.main()

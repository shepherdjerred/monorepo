"""Stopped acquisition must never infer an empty server from a failed network probe."""

import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from restoration_json import JsonObject

spec = importlib.util.spec_from_file_location("control", Path(__file__).with_name("restoration-control.py"))
assert spec is not None and spec.loader is not None
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class StoppedContainerTest(unittest.TestCase):
    def setUp(self):
        self.server = JsonObject({"metadata": {"uid": "server"}})
        self.pod = JsonObject(
            {
                "metadata": {"ownerReferences": [{"uid": "server", "controller": True}]},
                "spec": {"containers": [{"name": control.SERVER}]},
                "status": {
                    "containerStatuses": [
                        {
                            "name": control.SERVER,
                            "ready": False,
                            "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                            "lastState": {"terminated": {"finishedAt": "2026-10-21T16:58:41Z"}},
                        }
                    ]
                },
            }
        )

    def check(self):
        with patch.object(control, "read", side_effect=[self.server, self.pod]):
            control.assert_container_stopped()

    def test_owned_crash_loop_has_no_running_server(self):
        self.check()

    def test_ready_running_unstarted_and_foreign_processes_are_refused(self):
        original = copy.deepcopy(self.pod)
        for changes in (
            {"ready": True},
            {"state": {"running": {"startedAt": "now"}}},
            {"state": {"waiting": {"reason": "ContainerCreating"}}},
            {"lastState": {}},
            {"name": "foreign"},
        ):
            with self.subTest(changes=changes):
                self.pod = copy.deepcopy(original)
                self.pod.object("status").objects("containerStatuses")[0].update(changes)
                with self.assertRaises(control.MaintenanceBusy):
                    self.check()
        self.pod = copy.deepcopy(original)
        self.pod.object("metadata").objects("ownerReferences")[0]["uid"] = "other-server"
        with self.assertRaises(control.MaintenanceBusy):
            self.check()

    def test_running_init_or_sidecar_is_refused(self):
        original = copy.deepcopy(self.pod)
        self.pod.object("status")["initContainerStatuses"] = [{"state": {"running": {}}}]
        with self.assertRaises(control.MaintenanceBusy):
            self.check()
        self.pod = copy.deepcopy(original)
        self.pod.object("spec").objects("containers").append(JsonObject({"name": "sidecar"}))
        with self.assertRaises(control.MaintenanceBusy):
            self.check()

    def test_restore_target_is_bound_before_creation_and_cannot_change(self):
        journal = JsonObject()
        namespace = "minecraft-tsmc-restore-request"
        control.bind_restore_namespace(journal, namespace)
        control.bind_restore_namespace(journal, namespace)
        self.assertEqual(journal["restoreNamespace"], namespace)
        with self.assertRaisesRegex(ValueError, "original storage target"):
            control.bind_restore_namespace(journal, "minecraft-tsmc-restore-other")

    def test_existing_legacy_restore_and_invalid_names_cannot_be_retargeted(self):
        journal = JsonObject({"restore": {"uid": "existing"}})
        with self.assertRaisesRegex(ValueError, "original storage target"):
            control.bind_restore_namespace(journal, "minecraft-tsmc-restore-new")
        control.bind_restore_namespace(journal, "minecraft-tsmc-restore")
        for name in ("kube-system", "minecraft-tsmc-restore-../other", "minecraft-tsmc-restore-" + "a" * 33):
            with self.subTest(name=name), self.assertRaises(ValueError):
                control.bind_restore_namespace(JsonObject(), name)


class BackupRetryTest(unittest.TestCase):
    def setUp(self):
        self.journal = JsonObject(
            {
                "requestId": "3e5117f2-3f1b-46f6-a41c-2d9fb22026dc",
                "productionWriteAuthorized": False,
                "backup": {"name": "original", "uid": "backup-uid"},
            }
        )
        self.resource = JsonObject(
            {
                "metadata": {"uid": "backup-uid", "labels": {control.LEASE: self.journal["requestId"]}},
                "status": {"phase": "PartiallyFailed", "completionTimestamp": "2026-10-21T17:18:41Z"},
            }
        )
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "journal.json"

    def retry(self):
        with (
            patch.object(control, "require_offline"),
            patch.object(control, "read", return_value=self.resource),
            patch.object(control, "backup") as fresh,
        ):
            control.retry_backup(self.path, self.journal)
            return fresh

    def test_failed_identity_is_retained_before_a_fresh_request(self):
        fresh = self.retry()
        fresh.assert_called_once_with(self.path, self.journal)
        self.assertEqual(self.journal["backupAttempt"], 1)
        self.assertEqual(
            self.journal["failedBackups"],
            [
                {
                    "name": "original",
                    "uid": "backup-uid",
                    "phase": "PartiallyFailed",
                }
            ],
        )
        self.assertNotIn("backup", self.journal)

    def test_incomplete_or_replaced_backups_cannot_be_retried(self):
        original = copy.deepcopy(self.resource)
        for mutation in ("active", "unfinished", "uid", "owner"):
            with self.subTest(mutation=mutation):
                self.resource = copy.deepcopy(original)
                if mutation == "active":
                    self.resource.object("status")["phase"] = "InProgress"
                elif mutation == "unfinished":
                    self.resource.object("status").pop("completionTimestamp")
                elif mutation == "uid":
                    self.resource.object("metadata")["uid"] = "replacement"
                else:
                    self.resource.object("metadata").strings("labels")[control.LEASE] = "foreign"
                with self.assertRaisesRegex(ValueError, "terminal failed"):
                    self.retry()
                self.assertFalse(self.path.exists())

    def test_writer_or_existing_independent_restore_prevents_new_backup(self):
        self.journal["productionWriteAuthorized"] = True
        with self.assertRaisesRegex(ValueError, "no writer"):
            self.retry()
        self.journal["productionWriteAuthorized"] = False
        self.journal["restore"] = {"uid": "existing-restore"}
        with self.assertRaisesRegex(ValueError, "no writer"):
            self.retry()


if __name__ == "__main__":
    unittest.main()

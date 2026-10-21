"""Stopped acquisition must never infer an empty server from a failed network probe."""

import copy
import importlib.util
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
                self.pod["status"]["containerStatuses"][0].update(changes)
                with self.assertRaises(control.MaintenanceBusy):
                    self.check()
        self.pod = copy.deepcopy(original)
        self.pod["metadata"]["ownerReferences"][0]["uid"] = "other-server"
        with self.assertRaises(control.MaintenanceBusy):
            self.check()

    def test_running_init_or_sidecar_is_refused(self):
        original = copy.deepcopy(self.pod)
        self.pod["status"]["initContainerStatuses"] = [{"state": {"running": {}}}]
        with self.assertRaises(control.MaintenanceBusy):
            self.check()
        self.pod = copy.deepcopy(original)
        self.pod["spec"]["containers"].append({"name": "sidecar"})
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


if __name__ == "__main__":
    unittest.main()

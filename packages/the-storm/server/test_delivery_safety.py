"""Native identities and late-join safety, without Paper or cluster access."""

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import delivery_admission
import delivery_cleanup
import delivery_validation
from restoration_json import JsonObject
from test_restoration_control import IMAGE, REQUEST, Cluster


class BusyAdmissionTest(unittest.TestCase):
    def test_real_late_join_reopens_owned_routes_and_never_stops_players(self) -> None:
        control = delivery_validation.load_control()
        cluster = Cluster()
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(control, "read", side_effect=cluster.read),
            patch.object(control, "run", side_effect=cluster.run),
            patch.object(control, "assert_denied"),
        ):
            path = Path(directory) / "journal.json"
            journal = control.initialize(path, REQUEST, IMAGE)
            cluster.late_join = True
            with self.assertRaises(control.MaintenanceBusy):
                control.acquire(path, journal)
            self.assertEqual(journal["phase"], "ADMISSION_CLOSED")
            result = delivery_admission.reopen_unstopped(control, path, journal, wait=True)
            self.assertEqual(result, {"status": "waiting", "reason": "players-online", "originalReopened": True})
            self.assertEqual(journal["phase"], "PREPARED")
            self.assertEqual(cluster.server.object("spec")["replicas"], 1)
            self.assertNotIn("statefulset", [kind for kind, _ in cluster.mutations])
            for name in control.SERVICES:
                service = cluster.read("service", name)
                self.assertNotIn(control.LEASE, service.object("metadata").strings("annotations"))
                self.assertEqual(service.object("spec")["selector"], {"app": control.SERVER})

    def test_ambiguous_stop_cannot_be_reclassified_as_safe_waiting(self) -> None:
        control = delivery_validation.load_control()
        cluster = Cluster()
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(control, "read", side_effect=cluster.read),
            patch.object(control, "run", side_effect=cluster.run),
            patch.object(control, "assert_denied"),
        ):
            path = Path(directory) / "journal.json"
            journal = control.initialize(path, REQUEST, IMAGE)
            journal["phase"] = "ADMISSION_CLOSED"
            cluster.server.object("spec")["replicas"] = 0
            cluster.server.object("status")["replicas"] = 0
            with self.assertRaisesRegex(ValueError, "unchanged running original"):
                delivery_admission.reopen_unstopped(control, path, journal, wait=True)
            self.assertEqual(cluster.mutations, [])
            self.assertEqual(journal["phase"], "ADMISSION_CLOSED")


class SourceNamespaceTest(unittest.TestCase):
    def test_delivery_reader_reuses_source_namespace_and_registry_item_without_creating_either(self) -> None:
        control = delivery_validation.load_control()
        control.__dict__["RESTORED_NAMESPACE"] = control.DELIVERY_VALIDATION_NAMESPACE
        journal = JsonObject(
            {
                "requestId": REQUEST,
                "rollbackImage": IMAGE,
                "candidateImage": IMAGE,
                "managedRestoreNamespace": True,
                "deliveryValidation": {"restoreNamespaceUid": "namespace-uid"},
            }
        )
        namespace = JsonObject(
            {"metadata": {"uid": "namespace-uid", "labels": {control.DELIVERY_VALIDATION_LABEL: control.SERVER}}}
        )
        item = JsonObject(
            {"type": "kubernetes.io/dockerconfigjson", "spec": {"itemPath": "vaults/test/items/registry-reader"}}
        )
        created: list[str] = []

        def ensure(manifest: object) -> JsonObject:
            value = JsonObject.require(manifest)
            created.append(value.string("kind"))
            return value

        with (
            patch.object(control, "read", side_effect=[item, namespace, item]),
            patch.object(control, "ensure_resource", side_effect=ensure),
            patch.object(control, "run"),
        ):
            result = control.ensure_reader(journal, control.RESTORED_NAMESPACE)
        self.assertEqual(created, ["Pod"])
        self.assertEqual(result["kind"], "Pod")
        security = result.object("spec").object("securityContext")
        self.assertIs(security["runAsNonRoot"], True)
        self.assertEqual(security["seccompProfile"], {"type": "RuntimeDefault"})
        self.assertIs(control.writer_manifest(journal).object("spec").object("securityContext")["runAsNonRoot"], False)

    def test_namespace_replacement_and_unreviewed_target_fail_closed(self) -> None:
        control = delivery_validation.load_control()
        journal = JsonObject(
            {"managedRestoreNamespace": True, "deliveryValidation": {"restoreNamespaceUid": "namespace-uid"}}
        )
        with self.assertRaisesRegex(ValueError, "reviewed Delivery target"):
            control.assert_managed_restore_namespace(journal)
        control.__dict__["RESTORED_NAMESPACE"] = control.DELIVERY_VALIDATION_NAMESPACE
        with (
            patch.object(
                control,
                "read",
                return_value=JsonObject(
                    {"metadata": {"uid": "replacement", "labels": {control.DELIVERY_VALIDATION_LABEL: control.SERVER}}}
                ),
            ),
            self.assertRaisesRegex(ValueError, "replaced"),
        ):
            control.assert_managed_restore_namespace(journal)


class CopyCleanupTest(unittest.TestCase):
    def fixture(self):
        control = delivery_validation.load_control()
        state = JsonObject(
            {
                "phase": "REOPENED",
                "productionWriteAuthorized": False,
                "claimUid": "original-claim",
                "volumeName": "original-pv",
                "volumeUid": "original-pv-uid",
                "volumeSource": {"driver": "zfs", "volumeHandle": "original-handle"},
                "restore": {
                    "name": "storm-verify-" + REQUEST,
                    "claimUid": "copy-claim",
                    "volumeName": "copy-pv",
                    "volumeUid": "copy-pv-uid",
                    "volumeSource": {"driver": "zfs", "volumeHandle": "copy-handle"},
                },
                "deliveryValidation": {},
            }
        )
        original_claim = JsonObject({"metadata": {"uid": "original-claim"}, "spec": {"volumeName": "original-pv"}})
        original = JsonObject(
            {
                "metadata": {"uid": "original-pv-uid"},
                "spec": {"csi": {"driver": "zfs", "volumeHandle": "original-handle"}},
            }
        )
        claim = JsonObject(
            {
                "metadata": {
                    "uid": "copy-claim",
                    "resourceVersion": "42",
                    "labels": {"velero.io/restore-name": "storm-verify-" + REQUEST},
                },
                "spec": {"volumeName": "copy-pv"},
            }
        )
        volume = JsonObject(
            {"metadata": {"uid": "copy-pv-uid"}, "spec": {"csi": {"driver": "zfs", "volumeHandle": "copy-handle"}}}
        )
        return control, state, original_claim, original, claim, volume

    def test_cleanup_deletes_only_recorded_claim_with_uid_and_resource_version(self) -> None:
        control, state, original_claim, original, claim, volume = self.fixture()
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(control, "assert_managed_restore_namespace"),
            patch.object(control, "read", side_effect=[original_claim, original, volume]),
            patch.object(control, "run", side_effect=[json.dumps(claim), '{"items":[]}', ""]),
            patch.object(delivery_cleanup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as delete,
        ):
            delivery_cleanup.cleanup_copy(control, Path(directory) / "journal.json", state)
        options = json.loads(delete.call_args.kwargs["input"])
        self.assertEqual(options["preconditions"], {"uid": "copy-claim", "resourceVersion": "42"})
        self.assertNotIn("original-pv", " ".join(delete.call_args.args[0]))
        self.assertTrue(state.object("deliveryValidation")["copyRemoved"])

    def test_foreign_copy_identity_never_reaches_deletion(self) -> None:
        control, state, original_claim, original, claim, volume = self.fixture()
        unsafe = copy.deepcopy(volume)
        unsafe.object("spec").object("csi")["volumeHandle"] = "original-handle"
        with (
            patch.object(control, "assert_managed_restore_namespace"),
            patch.object(control, "read", side_effect=[original_claim, original, unsafe]),
            patch.object(control, "run", return_value=json.dumps(claim)),
            patch.object(delivery_cleanup.subprocess, "run") as delete,
            self.assertRaisesRegex(ValueError, "exact independent"),
        ):
            delivery_cleanup.cleanup_copy(control, Path("unused"), state)
        delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()

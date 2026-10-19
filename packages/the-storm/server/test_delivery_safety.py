"""Native identities and late-join safety, without Paper or cluster access."""

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
        control.__dict__["RESTORED_NAMESPACE"] = control.DELIVERY_VALIDATION_NAMESPACE
        state = JsonObject(
            {
                "phase": "REOPENED",
                "requestId": REQUEST,
                "backup": {"name": "storm-world-" + REQUEST},
                "productionWriteAuthorized": False,
                "claimUid": "original-claim",
                "volumeName": "original-pv",
                "volumeUid": "original-pv-uid",
                "volumeSource": {"driver": "zfs.csi.openebs.io", "volumeHandle": "original-handle"},
                "restore": {
                    "name": "storm-verify-" + REQUEST,
                    "uid": "restore-uid",
                    "claimUid": "copy-claim",
                    "volumeName": "copy-pv",
                    "volumeUid": "copy-pv-uid",
                    "volumeSource": {"driver": "zfs.csi.openebs.io", "volumeHandle": "copy-handle"},
                },
                "deliveryValidation": {},
            }
        )
        original_claim = JsonObject({"metadata": {"uid": "original-claim"}, "spec": {"volumeName": "original-pv"}})
        original = JsonObject(
            {
                "metadata": {"uid": "original-pv-uid"},
                "spec": {"csi": {"driver": "zfs.csi.openebs.io", "volumeHandle": "original-handle"}},
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
                "status": {"phase": "Bound"},
            }
        )
        volume = JsonObject(
            {
                "metadata": {
                    "uid": "copy-pv-uid",
                    "resourceVersion": "52",
                    "labels": {"velero.io/restore-name": "storm-verify-" + REQUEST},
                },
                "spec": {
                    "csi": {"driver": "zfs.csi.openebs.io", "volumeHandle": "copy-handle"},
                    "persistentVolumeReclaimPolicy": "Retain",
                    "claimRef": {"namespace": control.RESTORED_NAMESPACE, "name": control.CLAIM, "uid": "copy-claim"},
                },
            }
        )
        return control, state, original_claim, original, claim, volume

    def exercise(self, *, missing_claim=False, pending=False, attached=False, pod=False, altered=None, reclaim=True):
        control, state, original_claim, original, claim, volume = self.fixture()
        if altered:
            altered(state, claim, volume)
        native = JsonObject(
            {
                "metadata": {
                    "uid": "native-copy-uid",
                    "labels": {"velero.io/namespace": control.RESTORED_NAMESPACE, "velero.io/volname": "original-pv"},
                    "annotations": {"velero.io/backup": "storm-world-" + REQUEST},
                }
            }
        )
        restore = JsonObject(
            {"metadata": {"uid": "restore-uid", "labels": {control.LEASE: REQUEST}}, "status": {"phase": "Completed"}}
        )
        if pending:
            state.object("restore").pop("claimUid")
            claim.object("spec")["volumeName"] = "original-pv"
            claim.object("status")["phase"] = "Pending"
            original.object("spec")["claimRef"] = {"uid": "original-claim"}
            restore.object("status")["phase"] = "Failed"
        if missing_claim:
            state.object("deliveryValidation")["copyCleanupIntent"] = "copy-claim"
        storage = {"claim": not missing_claim, "volume": True, "native": True}
        events = []

        def run(arguments, timeout=30):
            if "patch" in arguments:
                operations = json.loads(arguments[arguments.index("-p") + 1])
                self.assertEqual(
                    operations,
                    [
                        {"op": "test", "path": "/metadata/uid", "value": "copy-pv-uid"},
                        {"op": "test", "path": "/metadata/resourceVersion", "value": "52"},
                        {"op": "test", "path": "/spec", "value": dict(volume.object("spec"))},
                        {"op": "replace", "path": "/spec/persistentVolumeReclaimPolicy", "value": "Delete"},
                    ],
                )
                volume.object("spec")["persistentVolumeReclaimPolicy"] = "Delete"
                events.append("copy-policy-delete")
                if not storage["claim"] and reclaim:
                    storage.update(volume=False, native=False)
                return ""
            if "wait" in arguments:
                if "pvc/" + control.CLAIM in arguments:
                    self.assertFalse(storage["claim"])
                elif "pv/copy-pv" in arguments:
                    if storage["volume"]:
                        raise RuntimeError("CSI reclaim still pending")
                else:
                    self.assertIn("zfsvolume/copy-handle", arguments)
                    self.assertFalse(storage["native"])
                return ""
            kind = arguments[arguments.index("get") + 1]
            if kind == "pvc":
                return json.dumps(claim) if storage["claim"] else ""
            if kind == "pv":
                self.assertEqual(arguments[arguments.index("get") + 2], "copy-pv")
                return json.dumps(volume) if storage["volume"] else ""
            if kind == "zfsvolume":
                self.assertEqual(arguments[arguments.index("get") + 2], "copy-handle")
                return json.dumps(native) if storage["native"] else ""
            if kind == "pods":
                return json.dumps(
                    {
                        "items": [{"spec": {"volumes": [{"persistentVolumeClaim": {"claimName": control.CLAIM}}]}}]
                        if pod
                        else []
                    }
                )
            self.assertEqual(kind, "volumeattachments")
            return json.dumps(
                {"items": [{"spec": {"source": {"persistentVolumeName": "copy-pv"}}}] if attached else []}
            )

        def read(kind, name, namespace=control.NAMESPACE):
            if kind == "pvc":
                return original_claim
            if kind == "pv":
                self.assertEqual(name, "original-pv")
                return original
            self.assertEqual((kind, name, namespace), ("restore.velero.io", "storm-verify-" + REQUEST, "velero"))
            return restore

        def delete(*arguments, **kwargs):
            options = json.loads(kwargs["input"])
            self.assertEqual(options["preconditions"], {"uid": "copy-claim", "resourceVersion": "42"})
            self.assertIn(
                "/api/v1/namespaces/" + control.RESTORED_NAMESPACE + "/persistentvolumeclaims/" + control.CLAIM,
                arguments[0],
            )
            self.assertNotIn("original-pv", " ".join(arguments[0]))
            storage["claim"] = False
            events.append("copy-claim-delete")
            if not pending and reclaim and volume.object("spec")["persistentVolumeReclaimPolicy"] == "Delete":
                storage.update(volume=False, native=False)
            return subprocess.CompletedProcess([], 0)

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(control, "assert_managed_restore_namespace"),
            patch.object(control, "read", side_effect=read),
            patch.object(control, "run", side_effect=run),
            patch.object(delivery_cleanup.subprocess, "run", side_effect=delete),
        ):
            try:
                delivery_cleanup.cleanup_copy(control, Path(directory) / "journal.json", state)
            except (ValueError, RuntimeError):
                self.assertIsNot(state.object("deliveryValidation").get("copyRemoved"), True)
                raise
        return state, storage, events

    def test_retained_copy_reclaims_native_storage_before_marking_removed(self) -> None:
        state, storage, events = self.exercise()
        self.assertEqual(events, ["copy-policy-delete", "copy-claim-delete"])
        self.assertEqual(storage, {"claim": False, "volume": False, "native": False})
        self.assertTrue(state.object("deliveryValidation")["copyRemoved"])

    def test_resume_after_claim_deletion_still_reclaims_retained_pv_and_native_volume(self) -> None:
        state, storage, events = self.exercise(missing_claim=True)
        self.assertEqual(events, ["copy-policy-delete"])
        self.assertFalse(storage["native"])
        self.assertTrue(state.object("deliveryValidation")["copyRemoved"])

    def test_failed_pending_claim_never_reclaims_original_pv_from_its_spec(self) -> None:
        state, storage, events = self.exercise(pending=True)
        self.assertEqual(events, ["copy-claim-delete"])
        self.assertTrue(storage["volume"])
        self.assertTrue(storage["native"])
        self.assertTrue(state.object("deliveryValidation")["copyRemoved"])

    def test_incomplete_csi_reclaim_is_not_success(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "still pending"):
            self.exercise(reclaim=False)

    def test_attached_or_mounted_copy_is_not_mutated(self) -> None:
        for flags in ({"attached": True}, {"pod": True}):
            with self.subTest(flags=flags), self.assertRaisesRegex(ValueError, "Pod|VolumeAttachment"):
                self.exercise(**flags)

    def test_foreign_copy_or_claim_reference_is_rejected(self) -> None:
        for field, value in (("volumeHandle", "original-handle"), ("driver", "foreign")):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "exact independent"):
                self.exercise(
                    altered=lambda state, claim, volume, field=field, value=value: (
                        volume.object("spec").object("csi").update({field: value})
                    )
                )
        with self.assertRaisesRegex(ValueError, "exact independent"):
            self.exercise(
                altered=lambda state, claim, volume: volume.object("spec").object("claimRef").update({"uid": "foreign"})
            )


if __name__ == "__main__":
    unittest.main()

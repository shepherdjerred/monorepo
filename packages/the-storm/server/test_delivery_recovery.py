"""Read-only original-volume recovery proof, using the real restoration fences."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import delivery_recovery
import delivery_validation
from restoration_json import JsonObject
from test_restoration_control import IMAGE, REQUEST, Cluster


class RecoveryReportTest(unittest.TestCase):
    def test_source_digest_matches_shared_cross_language_fixture(self) -> None:
        fixture = JsonObject.parse(
            Path(__file__)
            .resolve()
            .parents[2]
            .joinpath("ops-model/src/fixtures/minecraft-recovery-source.json")
            .read_bytes()
        )
        self.assertEqual(
            json.dumps(fixture.object("source"), sort_keys=True, separators=(",", ":"), ensure_ascii=False),
            fixture.string("canonicalJson"),
        )
        self.assertEqual(delivery_recovery.digest(fixture.object("source")), fixture.string("sha256"))

    def setUp(self) -> None:
        self.control = delivery_validation.load_control()
        self.control.__dict__["restored_namespace"] = self.control.DELIVERY_VALIDATION_NAMESPACE
        self.cluster = Cluster()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "world.json"
        self.addCleanup(patch.stopall)
        patch.object(self.control, "read", side_effect=self.cluster.read).start()
        patch.object(self.control, "assert_denied").start()
        self.command = patch.object(self.control, "run", side_effect=self.kube_run).start()
        for kind, name in (("pvc", self.control.CLAIM), ("pv", "data-volume")):
            self.cluster.objects[kind, name].object("metadata")["resourceVersion"] = "42"
        app = self.cluster.objects["application", self.control.SERVER]
        app["metadata"] = {"uid": "application-original", "resourceVersion": "21"}
        self.cluster.objects["namespace", self.control.restored_namespace] = JsonObject(
            {
                "metadata": {
                    "uid": "validation-original",
                    "labels": {self.control.DELIVERY_VALIDATION_LABEL: self.control.SERVER},
                }
            }
        )
        self.pods = [
            JsonObject(
                {
                    "metadata": {
                        "name": self.control.SERVER + "-0",
                        "uid": "pod-original",
                        "resourceVersion": "12",
                        "ownerReferences": [{"kind": "StatefulSet", "uid": "server-uid", "controller": True}],
                    },
                    "spec": {
                        "volumes": [{"persistentVolumeClaim": {"claimName": self.control.CLAIM}}],
                        "containers": [{"name": self.control.SERVER, "image": IMAGE}],
                    },
                }
            )
        ]
        self.copy = ""
        self.journal = self.control.initialize(self.path, REQUEST, IMAGE)
        self.journal["managedRestoreNamespace"] = True
        self.journal["deliveryValidation"] = {"restoreNamespaceUid": "validation-original"}
        delivery_recovery.capture_source(self.control, self.path, self.journal)
        self.journal["phase"] = "REOPENED"
        self.control.save(self.path, self.journal)

    def kube_run(self, arguments: list[str], timeout: float = 30) -> str:
        namespace, command = arguments[1], arguments[2:]
        if command[:2] == ["get", "pods"]:
            return json.dumps({"items": self.pods if namespace == self.control.NAMESPACE else []})
        if command[:2] == ["get", "pvc"]:
            return self.copy
        return self.cluster.run(arguments, timeout)

    def report(self) -> JsonObject:
        return delivery_recovery.report(self.control, self.path, self.journal)

    def test_fresh_report_reads_twice_without_mutating_the_journal_or_cluster(self) -> None:
        original = self.path.read_bytes()
        result = self.report()
        self.assertEqual(result.object("source")["claimUid"], "claim-uid")
        self.assertEqual(result.objects("pods")[0]["uid"], "pod-original")
        self.assertEqual(result.object("application")["uid"], "application-original")
        self.assertEqual(len(result.objects("routes")), 4)
        self.assertEqual(original, self.path.read_bytes())
        self.assertEqual(self.cluster.mutations, [])
        self.assertTrue(all(call.args[0][2] == "get" for call in self.command.call_args_list))
        delivery_recovery.validate(result)
        with self.assertRaisesRegex(ValueError, "fields"):
            delivery_recovery.validate({**result, "callerSummary": "healthy"})

    def test_sleeping_original_has_no_pod_and_is_not_started_by_inspection(self) -> None:
        self.cluster.server.object("spec")["replicas"] = 0
        self.pods.clear()
        self.assertEqual(self.report().objects("pods"), [])
        self.assertEqual(self.cluster.mutations, [])

    def test_foreign_claim_csi_route_template_pod_or_source_cannot_settle(self) -> None:
        mutations = (
            lambda: self.cluster.objects["pvc", self.control.CLAIM].object("metadata").update(uid="replacement"),
            lambda: (
                self.cluster.objects["pv", "data-volume"]
                .object("spec")
                .object("csi")
                .update(volumeHandle="replacement")
            ),
            lambda: (
                self.cluster.objects["service", self.control.SERVER]
                .object("spec")
                .object("selector")
                .update(app="other")
            ),
            lambda: (
                self.cluster.server.object("spec")
                .object("template")
                .object("spec")
                .objects("containers")[0]
                .update(image="other")
            ),
            lambda: self.pods[0].object("metadata").objects("ownerReferences")[0].update(uid="replacement"),
            lambda: (
                self.cluster.objects["application", self.control.SERVER]
                .object("spec")
                .object("source")
                .update(targetRevision="candidate")
            ),
        )
        original_objects, original_pods = copy.deepcopy(self.cluster.objects), copy.deepcopy(self.pods)
        for mutation in mutations:
            self.cluster.objects, self.pods = copy.deepcopy(original_objects), copy.deepcopy(original_pods)
            mutation()
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.report()
            self.assertEqual(self.cluster.mutations, [])

    def test_retained_copy_helper_and_post_selection_journal_keep_ownership(self) -> None:
        self.copy = '{"metadata":{"uid":"copy-retained"}}'
        with self.assertRaisesRegex(ValueError, "copy"):
            self.report()
        self.copy = ""
        self.pods[0].object("metadata")["labels"] = {self.control.LEASE: REQUEST}
        with self.assertRaisesRegex(ValueError, "reader"):
            self.report()
        self.pods[0].object("metadata")["labels"] = {}
        self.journal["productionWriteAuthorized"] = True
        with self.assertRaisesRegex(ValueError, "authorization"):
            self.report()

    def test_active_argo_or_missing_original_snapshot_is_never_inferred_from_health(self) -> None:
        app = self.cluster.objects["application", self.control.SERVER]
        app["operation"] = {"sync": {}}
        with self.assertRaisesRegex(ValueError, "active"):
            self.report()
        del app["operation"]
        del self.journal.object("deliveryValidation")["sourceApplication"]
        with self.assertRaisesRegex(ValueError, "original Argo source"):
            self.report()

    def test_concurrent_native_replacement_during_readback_fails(self) -> None:
        original = self.cluster.read
        reads = 0

        def read(kind: str, name: str, namespace: str = "minecraft-tsmc") -> JsonObject:
            nonlocal reads
            result = original(kind, name, namespace)
            if kind == "statefulset":
                reads += 1
                if reads > 1:
                    result.object("metadata")["resourceVersion"] = "999"
            return result

        with patch.object(self.control, "read", side_effect=read), self.assertRaisesRegex(ValueError, "changed during"):
            self.report()


if __name__ == "__main__":
    unittest.main()

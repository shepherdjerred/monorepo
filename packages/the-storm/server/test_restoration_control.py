import copy
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from collections.abc import Mapping
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from restoration_json import JsonObject

spec = importlib.util.spec_from_file_location("control", Path(__file__).with_name("restoration-control.py"))
assert spec is not None and spec.loader is not None
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

REQUEST = "6903b19f-f4d2-42a5-91ba-6ce046562c83"
IMAGE = "ghcr.io/shepherdjerred/the-storm-server:fixture@sha256:" + "a" * 64


class Cluster:
    def __init__(self):
        self.objects: dict[tuple[str, str], JsonObject] = {}
        self.mutations: list[tuple[str, str]] = []
        self.players = 0
        self.extra_writer = False
        self.late_join = False
        self.stale_patch = False
        for resource in json.loads(Path(__file__).with_name("restoration-guards.json").read_text()):
            self.objects[resource["kind"].lower(), resource["name"]] = JsonObject({
                "metadata": {"generation": 1},
                "status": {"observedGeneration": 1, "typeChecking": {}},
                "spec": resource["spec"],
            })
        self.objects["statefulset", control.SERVER] = JsonObject(
            {
                "metadata": {"uid": "server-uid", "resourceVersion": "1", "annotations": {}},
                "spec": {"replicas": 1, "template": {"spec": {"containers": [{"image": IMAGE}]}}},
                "status": {"replicas": 1},
            }
        )
        source = {
            "chart": "minecraft",
            "repoURL": "https://itzg.github.io/minecraft-server-charts/",
            "helm": {
                "parameters": [{"name": "image.tag", "value": IMAGE.split(":", 1)[1]}],
                "valuesObject": {"image": {"repository": IMAGE.split(":", 1)[0], "tag": IMAGE.split(":", 1)[1]}},
            },
        }
        destination = {"namespace": control.NAMESPACE, "server": "https://kubernetes.default.svc"}
        self.objects["application", control.SERVER] = JsonObject(
            {
                "spec": {"source": source, "destination": destination},
                "status": {
                    "sync": {
                        "status": "Synced",
                        "comparedTo": {"source": copy.deepcopy(source), "destination": copy.deepcopy(destination)},
                    }
                },
            }
        )
        self.objects["pvc", control.CLAIM] = JsonObject(
            {
                "metadata": {"uid": "claim-uid"},
                "spec": {"volumeName": "data-volume"},
                "status": {"phase": "Bound"},
            }
        )
        self.objects["pv", "data-volume"] = JsonObject(
            {
                "metadata": {"uid": "volume-uid"},
                "spec": {"csi": {"driver": "zfs.csi.openebs.io", "volumeHandle": "source-dataset"}},
            }
        )
        for name in control.SERVICES:
            self.objects["service", name] = JsonObject(
                {
                    "metadata": {"uid": name, "resourceVersion": "1", "annotations": {"tracking": "keep"}},
                    "spec": {"selector": {"app": control.SERVER}},
                }
            )

    @property
    def server(self) -> JsonObject:
        return self.objects["statefulset", control.SERVER]

    def read(self, kind: str, name: str, namespace: str = control.NAMESPACE) -> JsonObject:
        return copy.deepcopy(self.objects[kind, name])

    def run(self, arguments: list[str], timeout: float = 30) -> str:
        command = arguments[2:]
        if command[:2] == ["exec", control.SERVER + "-0"]:
            return f"There are {self.players} of a max of 20 players online:"
        if command[:2] == ["get", "pod"]:
            pod = self.objects.get(("pod", command[2]))
            return json.dumps(pod) if pod is not None and self.server.object("spec").integer("replicas") == 1 else ""
        if command[:2] == ["get", "pvc"]:
            return json.dumps({"items": [{"metadata": {"name": control.CLAIM, "uid": "claim-uid"}}]})
        if command[:2] == ["get", "pods"]:
            items = [
                {
                    "metadata": {"labels": {}},
                    "spec": {"volumes": [{"persistentVolumeClaim": {"claimName": control.CLAIM}}]},
                    "status": {"phase": "Running"},
                }
            ]
            return json.dumps({"items": items if self.extra_writer else []})
        if command[0] != "patch":
            raise AssertionError("Unexpected Kubernetes command: " + str(command))
        resource = self.objects[command[1], command[2]]
        operations = [JsonObject.require(operation) for operation in json.loads(command[-1])]
        if self.stale_patch or operations[0]["value"] != resource.object("metadata").string("resourceVersion"):
            raise RuntimeError("resourceVersion test failed")
        for operation in operations[1:]:
            keys = [key.replace("~1", "/").replace("~0", "~") for key in operation.string("path").split("/")[1:]]
            if keys == ["spec", "template", "spec", "containers", "0", "image"]:
                resource.object("spec").object("template").object("spec").objects("containers")[0]["image"] = operation[
                    "value"
                ]
                continue
            parent = resource
            for key in keys[:-1]:
                parent = parent.object(key)
            parent[keys[-1]] = operation["value"]
        resource.object("metadata")["resourceVersion"] = str(
            int(resource.object("metadata").string("resourceVersion")) + 1
        )
        self.mutations.append((command[1], command[2]))
        if command[1] == "statefulset" and resource.object("spec").integer("replicas") == 0:
            resource.object("status")["replicas"] = 0
        if self.late_join and len(self.mutations) == 4:
            self.players = 1
        return "patched"


class RestorationControlTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "maintenance.json"
        self.cluster = Cluster()
        self.addCleanup(patch.stopall)
        patch.object(
            control, "read",
            side_effect=lambda kind, name, namespace=control.NAMESPACE: self.cluster.read(kind, name, namespace),
        ).start()
        patch.object(
            control, "run", side_effect=lambda arguments, timeout=30: self.cluster.run(arguments, timeout),
        ).start()
        self.guard_probe = control.assert_denied
        self.probes = patch.object(control, "assert_denied").start()

    def initialize(self) -> JsonObject:
        return control.initialize(self.path, REQUEST, IMAGE)

    def test_guards_reject_changed_expressions_conditions_and_binding_scope_before_mutation(self):
        for field, value in (
            ("validations", [{"expression": "true"}]),
            ("matchConditions", [{"name": "the-storm-server", "expression": "false"}]),
        ):
            with self.subTest(field=field):
                self.cluster = Cluster()
                policy = self.cluster.objects["validatingadmissionpolicy", control.POLICIES[0][0]]
                policy.object("spec")[field] = value
                with self.assertRaisesRegex(ValueError, "reviewed contract"):
                    self.initialize()
                self.assertEqual(self.cluster.mutations, [])
        self.cluster = Cluster()
        binding = self.cluster.objects["validatingadmissionpolicybinding", control.POLICIES[0][0]]
        binding.object("spec")["matchResources"] = {"namespaceSelector": {"matchLabels": {"omit": "storm"}}}
        with self.assertRaisesRegex(ValueError, "reviewed contract"):
            self.initialize()
        self.assertEqual(self.cluster.mutations, [])

    def test_guards_accept_only_harmless_empty_selector_defaults(self):
        for (kind, _), resource in self.cluster.objects.items():
            if kind == "validatingadmissionpolicy":
                resource.object("spec").object("matchConstraints")["namespaceSelector"] = {}
                resource.object("spec").object("matchConstraints")["objectSelector"] = {}
            elif kind == "validatingadmissionpolicybinding":
                resource.object("spec")["matchResources"] = {"namespaceSelector": {}, "objectSelector": {}}
        self.initialize()
        self.assertEqual(self.cluster.mutations, [])

    def installation_fixture(self) -> JsonObject:
        journal = self.initialize()
        control.acquire(self.path, journal)
        journal["installation"] = {"phase": "INSTALLED", "candidateJarSha256": "b" * 64}
        journal["writerRemoved"] = True
        self.cluster.objects["pod", control.SERVER + "-0"] = JsonObject(
            {
                "metadata": {"uid": "accepted-pod", "ownerReferences": [{"uid": "server-uid", "controller": True}]},
                "spec": {"containers": [{"name": control.SERVER, "image": IMAGE}]},
                "status": {
                    "containerStatuses": [{
                        "ready": True, "imageID": "docker-pullable://" + IMAGE,
                        "containerID": "containerd://accepted-instance", "restartCount": 0,
                    }],
                },
            }
        )
        return journal

    def acceptance_evidence(self) -> Path:
        evidence = self.path.parent / "acceptance.json"
        evidence.write_text(
            json.dumps(
                {
                    "requestId": REQUEST,
                    "candidateImage": IMAGE,
                    "candidateJarSha256": "b" * 64,
                    "podUid": "accepted-pod",
                    "containerId": "containerd://accepted-instance",
                    "restartCount": 0,
                    "checks": dict.fromkeys(control.ACCEPTANCE_CHECKS, "VERIFIED"),
                }
            )
        )
        return evidence

    def test_private_start_requires_installation_and_keeps_every_public_route_closed(self):
        journal = self.installation_fixture()
        journal["writerRemoved"] = False
        before = len(self.cluster.mutations)
        with self.assertRaisesRegex(ValueError, "writer cleanup"):
            control.private_start(self.path, journal)
        self.assertEqual(len(self.cluster.mutations), before)
        journal["writerRemoved"] = True
        control.private_start(self.path, journal)
        control.assert_closed(journal)
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 1)
        self.assertEqual(control.annotations(self.cluster.server)[control.PHASE], "VALIDATING")
        self.assertEqual(control.server_image(self.cluster.server), IMAGE)
        before = len(self.cluster.mutations)
        control.private_start(self.path, journal)
        self.assertEqual(len(self.cluster.mutations), before)

    def test_acceptance_refuses_wrong_pod_image_owner_readiness_missing_check_and_synthetic_evidence(self):
        journal = self.installation_fixture()
        control.private_start(self.path, journal)
        pod = self.cluster.objects["pod", control.SERVER + "-0"]
        original = copy.deepcopy(pod)
        for change in (
            "image", "digest", "owner", "ready", "podUid", "containerId", "restartCount", "missing", "synthetic",
        ):
            with self.subTest(change=change):
                evidence = self.acceptance_evidence()
                data = JsonObject.parse(evidence.read_bytes())
                if change == "image":
                    pod.object("spec").objects("containers")[0]["image"] = "different-image"
                elif change == "digest":
                    pod.object("status").objects("containerStatuses")[0]["imageID"] = "sha256:" + "c" * 64
                elif change == "owner":
                    pod.object("metadata").objects("ownerReferences")[0]["uid"] = "replacement"
                elif change == "ready":
                    pod.object("status").objects("containerStatuses")[0]["ready"] = False
                elif change == "podUid":
                    data["podUid"] = "different-pod"
                elif change == "containerId":
                    data["containerId"] = "containerd://previous-instance"
                elif change == "restartCount":
                    data["restartCount"] = 1
                elif change == "missing":
                    del data.object("checks")["coreProtectRollback"]
                else:
                    data["testOnly"] = True
                evidence.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError, "every required behavior"):
                    control.accept(self.path, journal, evidence)
                pod.clear()
                pod.update(copy.deepcopy(original))
        control.accept(self.path, journal, self.acceptance_evidence())
        self.assertEqual(journal.object("acceptance")["status"], "VERIFIED")
        control.assert_closed(journal)

    def test_replacement_pod_and_restarted_container_invalidate_acceptance_when_stopped(self):
        for change in ("podUid", "containerID", "restartCount"):
            with self.subTest(change=change):
                journal = self.installation_fixture()
                control.private_start(self.path, journal)
                control.accept(self.path, journal, self.acceptance_evidence())
                pod = self.cluster.objects["pod", control.SERVER + "-0"]
                if change == "podUid":
                    pod.object("metadata")["uid"] = "replacement-pod"
                else:
                    pod.object("status").objects("containerStatuses")[0][change] = (
                        1 if change == "restartCount" else "containerd://replacement-instance"
                    )
                control.private_stop(self.path, journal)
                self.assertEqual(journal.object("acceptance")["status"], "INVALIDATED")
                with self.assertRaisesRegex(ValueError, "unchanged, verified"):
                    control.release(self.path, journal)
                control.require_offline(journal)
                self.path.unlink()
                self.cluster = Cluster()

    def test_a_new_private_start_discards_the_previous_acceptance_and_stop_receipt(self):
        journal = self.installation_fixture()
        control.private_start(self.path, journal)
        control.accept(self.path, journal, self.acceptance_evidence())
        control.private_stop(self.path, journal)
        control.private_stop(self.path, journal)
        self.assertEqual(journal.object("stoppedIncarnation").string("podUid"), "accepted-pod")
        control.private_start(self.path, journal)
        self.assertNotIn("acceptance", journal)
        self.assertNotIn("stoppedIncarnation", journal)
        with self.assertRaises(ValueError):
            control.release(self.path, journal)

    def test_a_replacement_observed_after_scaling_down_also_invalidates_acceptance(self):
        journal = self.installation_fixture()
        control.private_start(self.path, journal)
        control.accept(self.path, journal, self.acceptance_evidence())
        original_run = self.cluster.run

        def replace_while_stopping(arguments: list[str], timeout: float = 30) -> str:
            if arguments[2:4] == ["get", "pod"] and self.cluster.server.object("spec").integer("replicas") == 0:
                return json.dumps(self.cluster.objects["pod", control.SERVER + "-0"])
            if arguments[2] == "wait":
                return "deleted"
            result = original_run(arguments, timeout)
            if arguments[2:5] == ["patch", "statefulset", control.SERVER]:
                self.cluster.objects["pod", control.SERVER + "-0"].object("metadata")["uid"] = "replacement-pod"
            return result

        with patch.object(control, "run", side_effect=replace_while_stopping):
            control.private_stop(self.path, journal)
        self.assertEqual(journal.object("acceptance")["status"], "INVALIDATED")
        self.assertEqual(journal.object("stoppedIncarnation").string("podUid"), "replacement-pod")
        with self.assertRaisesRegex(ValueError, "unchanged, verified"):
            control.release(self.path, journal)

    def test_release_refuses_a_stop_receipt_for_a_different_incarnation(self):
        journal = self.installation_fixture()
        control.private_start(self.path, journal)
        control.accept(self.path, journal, self.acceptance_evidence())
        control.private_stop(self.path, journal)
        journal.object("stoppedIncarnation")["containerId"] = "containerd://replacement-instance"
        before = len(self.cluster.mutations)
        with self.assertRaisesRegex(ValueError, "exact stopped pod"):
            control.release(self.path, journal)
        self.assertEqual(len(self.cluster.mutations), before)

    def test_release_requires_acceptance_and_stopped_lease_then_restores_java_last_and_resumes(self):
        journal = self.installation_fixture()
        control.private_start(self.path, journal)
        control.accept(self.path, journal, self.acceptance_evidence())
        with self.assertRaisesRegex(ValueError, "gracefully stopped"):
            control.release(self.path, journal)
        control.private_stop(self.path, journal)
        control.require_offline(journal)
        before = len(self.cluster.mutations)
        control.release(self.path, journal)
        self.assertEqual(journal["phase"], "REOPENED")
        self.assertNotIn(control.LEASE, control.annotations(self.cluster.server))
        self.assertEqual(
            self.cluster.mutations[before + 1 :],
            [("service", name) for name in (*control.SERVICES[1:], control.SERVICES[0])],
        )
        for name in control.SERVICES:
            service = self.cluster.objects["service", name]
            self.assertEqual(service.object("spec").strings("selector"), {"app": control.SERVER})
            self.assertEqual(control.annotations(service), {"tracking": "keep"})
        before = len(self.cluster.mutations)
        self.cluster.server.object("spec")["replicas"] = 1
        self.cluster.server.object("status")["replicas"] = 1
        control.release(self.path, journal)
        self.assertEqual(len(self.cluster.mutations), before)

    def test_changed_acceptance_evidence_cannot_release_the_lease(self):
        journal = self.installation_fixture()
        control.private_start(self.path, journal)
        evidence = self.acceptance_evidence()
        control.accept(self.path, journal, evidence)
        control.private_stop(self.path, journal)
        evidence.write_text("changed")
        with self.assertRaisesRegex(ValueError, "unchanged, verified"):
            control.release(self.path, journal)
        control.require_offline(journal)

    def test_release_refuses_old_overridden_or_unreconciled_gitops_images_before_any_mutation(self):
        journal = self.installation_fixture()
        control.private_start(self.path, journal)
        control.accept(self.path, journal, self.acceptance_evidence())
        control.private_stop(self.path, journal)
        original = copy.deepcopy(self.cluster.objects["application", control.SERVER])
        for change in ("old", "parameter", "extra", "comparison", "sync", "operation"):
            with self.subTest(change=change):
                application = copy.deepcopy(original)
                self.cluster.objects["application", control.SERVER] = application
                helm = application.object("spec").object("source").object("helm")
                if change == "old":
                    helm.object("valuesObject").object("image")["tag"] = "rollback"
                elif change == "parameter":
                    helm.objects("parameters")[0]["value"] = "rollback"
                elif change == "extra":
                    helm["values"] = "image: {tag: rollback}"
                elif change == "comparison":
                    application.object("status").object("sync").object("comparedTo")["source"] = {}
                elif change == "sync":
                    application.object("status").object("sync")["status"] = "OutOfSync"
                else:
                    application["operation"] = {"sync": {}}
                before = len(self.cluster.mutations)
                with self.assertRaisesRegex(ValueError, "reconciled GitOps"):
                    control.release(self.path, journal)
                self.assertEqual(len(self.cluster.mutations), before)
                control.require_offline(journal)

    def test_uncertain_writer_creation_adopts_only_the_recorded_pending_exact_helper(self):
        journal = self.initialize()
        journal["writerCreationPending"] = True
        pod = control.writer_manifest(journal)
        pod.object("metadata")["uid"] = "pending-writer"
        with (
            patch.object(control, "run", side_effect=[json.dumps(pod), "Ready"]),
            patch.object(control, "require_offline") as stopped,
            patch.object(control, "ensure_resource", return_value=pod),
        ):
            control.create_writer(self.path, journal)
        self.assertEqual(journal["writerUid"], "pending-writer")
        self.assertIs(journal["writerCreationPending"], False)
        self.assertEqual(stopped.call_args_list[0].kwargs, {"writer": True})
        self.assertEqual(stopped.call_args_list[-1].kwargs, {"writer": True})

    def test_uncertain_writer_creation_refuses_an_injected_command_before_volume_access(self):
        journal = self.initialize()
        journal["writerCreationPending"] = True
        pod = control.writer_manifest(journal)
        pod.object("metadata")["uid"] = "injected-writer"
        pod.object("spec").objects("containers")[0]["command"] = ["start-paper"]
        with (
            patch.object(control, "run", return_value=json.dumps(pod)),
            patch.object(control, "ensure_resource") as creating,
            self.assertRaisesRegex(ValueError, "credential-free"),
        ):
            control.create_writer(self.path, journal)
        creating.assert_not_called()
        self.assertNotIn("writerUid", journal)

    def test_removed_writer_can_be_recreated_for_whole_volume_recovery_with_a_new_recorded_uid(self):
        journal = self.initialize()
        journal["writerUid"] = "removed-writer"
        journal["writerRemoved"] = True
        pod = control.writer_manifest(journal)
        pod.object("metadata")["uid"] = "recovery-writer"
        with (
            patch.object(control, "run", side_effect=["", "Ready"]),
            patch.object(control, "require_offline"),
            patch.object(control, "ensure_resource", return_value=pod),
        ):
            control.create_writer(self.path, journal)
        self.assertEqual(journal["previousWriterUid"], "removed-writer")
        self.assertEqual(journal["writerUid"], "recovery-writer")
        self.assertIs(journal["writerRemoved"], False)

    def test_preflight_cli_reports_pending_backup_without_requiring_backup_fields_or_mutating_cluster(self):
        output = io.StringIO()
        with (
            patch(
                "sys.argv",
                [
                    "restoration-control",
                    "preflight",
                    "--journal",
                    str(self.path),
                    "--request",
                    REQUEST,
                    "--image",
                    IMAGE,
                ],
            ),
            redirect_stdout(output),
        ):
            control.main()
        result = JsonObject.parse(output.getvalue())
        self.assertEqual(result["phase"], "PREPARED")
        self.assertEqual(result["backup"], {})
        self.assertEqual(result["restore"], {})
        self.assertEqual(self.cluster.mutations, [])

    def test_preflight_is_read_only_and_records_the_exact_targets(self):
        journal = self.initialize()
        self.assertEqual(self.cluster.mutations, [])
        self.assertEqual(journal.string("claimUid"), "claim-uid")
        self.assertEqual(set(journal.object("services")), set(control.SERVICES))

    def test_writer_template_preserves_metadata_without_starting_paper_or_receiving_credentials(self):
        journal = self.initialize()
        pod = control.writer_manifest(journal)
        pod.object("metadata")["uid"] = "writer-uid"
        journal["writerUid"] = "writer-uid"
        control.assert_writer(pod, journal)
        spec = pod.object("spec")
        container = spec.objects("containers")[0]
        self.assertEqual(container["image"], IMAGE)
        self.assertEqual(container["command"], ["sleep", "infinity"])
        self.assertIs(spec["automountServiceAccountToken"], False)
        self.assertNotIn("env", container)
        self.assertNotIn("envFrom", container)
        self.assertEqual(
            container.object("securityContext").object("capabilities")["add"], ["CHOWN", "DAC_OVERRIDE", "FOWNER"]
        )
        self.assertEqual(self.cluster.mutations, [])

    def test_writer_refuses_replacement_credentials_extra_container_and_privileged_access(self):
        journal = self.initialize()
        journal["writerUid"] = "writer-uid"
        for change in ("uid", "credentials", "container", "capabilities", "privileged", "lifecycle", "hostPID"):
            with self.subTest(change=change):
                pod = control.writer_manifest(journal)
                pod.object("metadata")["uid"] = "writer-uid"
                container = pod.object("spec").objects("containers")[0]
                if change == "uid":
                    pod.object("metadata")["uid"] = "replacement-uid"
                elif change == "credentials":
                    container["envFrom"] = [{"secretRef": {"name": "unexpected"}}]
                elif change == "container":
                    pod.object("spec").objects("containers").append(JsonObject({"name": "extra"}))
                elif change == "privileged":
                    container.object("securityContext")["privileged"] = True
                elif change == "lifecycle":
                    container["lifecycle"] = {"postStart": {"exec": {"command": ["unexpected"]}}}
                elif change == "hostPID":
                    pod.object("spec")["hostPID"] = True
                else:
                    container.object("securityContext").object("capabilities")["add"] = ["SYS_ADMIN"]
                with self.assertRaisesRegex(ValueError, "exact credential-free"):
                    control.assert_writer(pod, journal)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_closes_all_routes_before_stopping_and_leasing_then_resumes_without_writes(self):
        journal = self.initialize()
        control.acquire(self.path, journal)
        self.assertEqual(self.cluster.mutations[:4], [("service", name) for name in control.SERVICES])
        self.assertEqual(journal.string("phase"), "LEASED_OFFLINE")
        self.assertEqual(journal["admissionProbes"], "UPDATE_SCALE_AND_DELETE_DENIED")
        self.assertEqual(self.probes.call_count, 3)
        self.assertIn("--dry-run=server", self.probes.call_args_list[0].args[0])
        self.assertIn("statefulset/" + control.SERVER, self.probes.call_args_list[1].args[0])
        self.assertEqual(self.probes.call_args_list[2].args[0][:3], ["delete", "statefulset", control.SERVER])
        self.assertIn("--dry-run=server", self.probes.call_args_list[2].args[0])
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 0)
        self.assertEqual(control.annotations(self.cluster.server)[control.LEASE], REQUEST)
        self.assertEqual(control.annotations(self.cluster.server)[control.IMAGE], IMAGE)
        for name in control.SERVICES:
            service = self.cluster.objects["service", name]
            self.assertEqual(
                service.object("spec").strings("selector"), {"app": control.SERVER, control.ACCESS: "closed"}
            )
            self.assertEqual(service.object("metadata").strings("annotations")["tracking"], "keep")
        before = len(self.cluster.mutations)
        control.acquire(self.path, control.initialize(self.path, REQUEST, IMAGE))
        self.assertEqual(len(self.cluster.mutations), before)

    def test_players_and_late_joins_never_trigger_a_stop(self):
        journal = self.initialize()
        self.cluster.players = 1
        with self.assertRaisesRegex(ValueError, "empty server"):
            control.acquire(self.path, journal)
        self.assertEqual(self.cluster.mutations, [])
        self.cluster.players = 0
        self.cluster.late_join = True
        with self.assertRaisesRegex(ValueError, "empty server"):
            control.acquire(self.path, journal)
        self.assertEqual(journal.string("phase"), "ADMISSION_CLOSED")
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 1)
        self.assertNotIn(control.LEASE, control.annotations(self.cluster.server))

    def test_extra_pvc_writer_blocks_lease_acquisition(self):
        journal = self.initialize()
        self.cluster.extra_writer = True
        with self.assertRaisesRegex(ValueError, "still mounts"):
            control.acquire(self.path, journal)
        self.assertNotIn(control.LEASE, control.annotations(self.cluster.server))
        self.assertEqual(journal.string("phase"), "ADMISSION_CLOSED")

    def test_foreign_lease_and_replaced_claim_are_refused_before_any_mutation(self):
        journal = self.initialize()
        self.cluster.server.object("metadata").strings("annotations")[control.LEASE] = "foreign"
        with self.assertRaisesRegex(ValueError, "another request"):
            control.acquire(self.path, journal)
        self.cluster.server.object("metadata").strings("annotations").clear()
        self.cluster.objects["pvc", control.CLAIM].object("metadata")["uid"] = "replaced"
        with self.assertRaisesRegex(ValueError, "claim was replaced"):
            control.acquire(self.path, journal)
        self.assertEqual(self.cluster.mutations, [])

    def test_unreconciled_policy_cel_warnings_and_missing_parent_binding_are_refused(self):
        for change in ("generation", "warnings", "param"):
            with self.subTest(change=change):
                self.cluster = Cluster()
                policy = self.cluster.objects["validatingadmissionpolicy", control.POLICIES[0][0]]
                if change == "generation":
                    policy.object("status")["observedGeneration"] = 0
                elif change == "warnings":
                    policy.object("status").object("typeChecking")["expressionWarnings"] = [{"warning": "invalid"}]
                else:
                    self.cluster.objects["validatingadmissionpolicybinding", control.POLICIES[1][0]].object("spec")[
                        "paramRef"
                    ] = {}
                with (
                    patch.object(control, "read", side_effect=self.cluster.read),
                    self.assertRaises(ValueError),
                ):
                    self.initialize()
                self.assertFalse(self.path.exists())
                self.assertEqual(self.cluster.mutations, [])

    def test_compare_and_swap_refusal_retains_a_resumable_journal(self):
        journal = self.initialize()
        self.cluster.stale_patch = True
        with self.assertRaisesRegex(RuntimeError, "resourceVersion"):
            control.acquire(self.path, journal)
        self.assertEqual(JsonObject.parse(self.path.read_text()).string("phase"), "CLOSING_ADMISSION")
        self.cluster.stale_patch = False
        control.acquire(self.path, control.initialize(self.path, REQUEST, IMAGE))
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 0)

    def test_conflicting_request_and_unpinned_image_do_not_change_any_resource(self):
        self.initialize()
        with self.assertRaises(ValueError):
            control.initialize(self.path, "11111111-1111-4111-8111-111111111111", IMAGE)
        with self.assertRaisesRegex(ValueError, "immutable Storm image"):
            control.initialize(self.path, REQUEST, "ghcr.io/shepherdjerred/the-storm-server:latest")
        self.assertEqual(self.cluster.mutations, [])

    def test_guard_probe_requires_the_policy_denial_and_rejects_rbac_or_a_successful_request(self):
        for code, error in ((0, ""), (1, "RBAC: user cannot scale")):
            with (
                patch.object(
                    control.subprocess, "run", return_value=control.subprocess.CompletedProcess([], code, "", error)
                ),
                self.assertRaisesRegex(ValueError, "dry-run maintenance probe"),
            ):
                self.guard_probe(["scale"], "World restoration")
        with patch.object(
            control.subprocess,
            "run",
            return_value=control.subprocess.CompletedProcess([], 1, "", "World restoration blocks scale requests"),
        ):
            self.guard_probe(["scale"], "World restoration blocks scale requests")

    def backup_fixture(self):
        journal = self.initialize()
        control.acquire(self.path, journal)
        resources: dict[tuple[str, str], JsonObject] = {}

        def ensure(manifest: Mapping[str, object]) -> JsonObject:
            manifest = JsonObject(manifest)
            key = manifest.string("kind"), manifest.object("metadata").string("name")
            if key not in resources:
                resources[key] = copy.deepcopy(manifest)
                resources[key].object("metadata")["uid"] = manifest.string("kind") + "-uid"
            return resources[key]

        patch.object(control, "ensure_resource", side_effect=ensure).start()
        return journal, resources

    def test_backup_is_request_owned_scoped_and_does_not_unlock_the_server(self):
        journal, resources = self.backup_fixture()
        before = len(self.cluster.mutations)
        result = control.backup(self.path, journal)
        self.assertEqual(result.object("metadata").strings("labels"), {control.LEASE: REQUEST})
        self.assertEqual(result.object("spec")["includedNamespaces"], [control.NAMESPACE])
        self.assertEqual(result.object("spec")["includedResources"], ["persistentvolumeclaims", "persistentvolumes"])
        self.assertEqual(journal.object("backup").string("phase"), "New")
        self.assertEqual(len(self.cluster.mutations), before)
        self.assertEqual(journal.string("phase"), "LEASED_OFFLINE")
        control.backup(self.path, journal)
        self.assertEqual(len(resources), 1)

    def test_backup_refuses_mounts_foreign_lease_or_a_broader_pvc_selection(self):
        journal, _ = self.backup_fixture()
        self.cluster.extra_writer = True
        with self.assertRaisesRegex(ValueError, "pod still mounts"):
            control.backup(self.path, journal)
        self.cluster.extra_writer = False
        self.cluster.server.object("metadata").strings("annotations")[control.LEASE] = "foreign"
        with self.assertRaisesRegex(ValueError, "another request"):
            control.backup(self.path, journal)
        self.cluster.server.object("metadata").strings("annotations")[control.LEASE] = REQUEST
        original_run = self.cluster.run

        def broader(arguments: list[str], timeout: float = 30) -> str:
            if "velero.io/backup=enabled" in arguments:
                return json.dumps({"items": [{"metadata": {"name": "other", "uid": "other"}}]})
            return original_run(arguments, timeout)

        with (
            patch.object(control, "run", side_effect=broader),
            self.assertRaisesRegex(ValueError, "only the recorded"),
        ):
            control.backup(self.path, journal)

    def test_partial_backup_or_missing_snapshot_is_not_accepted_as_complete(self):
        journal, _ = self.backup_fixture()
        result = control.backup(self.path, journal)
        for status in (
            {"phase": "PartiallyFailed"},
            {"phase": "Completed", "errors": 1},
            {"phase": "Completed", "volumeSnapshotsAttempted": 1, "volumeSnapshotsCompleted": 0},
        ):
            result["status"] = status
            with self.assertRaises(ValueError):
                control.backup(self.path, journal)
        result.object("metadata")["uid"] = "replaced"
        with self.assertRaisesRegex(ValueError, "backup was replaced"):
            control.backup(self.path, journal)

    def test_restore_requires_completed_backup_and_remaps_only_data_into_independent_storage(self):
        journal, resources = self.backup_fixture()
        original = control.backup(self.path, journal)
        with self.assertRaisesRegex(ValueError, "backup to complete"):
            control.restore_backup(self.path, journal)
        original["status"] = {
            "phase": "Completed",
            "completionTimestamp": "2026-10-06T02:00:00Z",
            "volumeSnapshotsAttempted": 1,
            "volumeSnapshotsCompleted": 1,
        }
        control.restore_backup(self.path, journal)
        restored = resources["Restore", "storm-verify-" + REQUEST]
        self.assertEqual(restored.object("spec")["namespaceMapping"], {control.NAMESPACE: control.RESTORED_NAMESPACE})
        self.assertEqual(restored.object("spec")["includedResources"], ["persistentvolumeclaims", "persistentvolumes"])
        self.assertEqual(journal.object("restore").string("byteVerification"), "PENDING")
        restored["status"] = {"phase": "Completed"}
        existing_read = self.cluster.read

        def restored_claim(kind: str, name: str, namespace: str = control.NAMESPACE) -> JsonObject:
            if kind == "pv" and name == "restored-volume":
                return JsonObject(
                    {
                        "metadata": {"uid": "restored-volume-uid"},
                        "spec": {"csi": {"driver": "zfs.csi.openebs.io", "volumeHandle": "restored-dataset"}},
                    }
                )
            if namespace == control.RESTORED_NAMESPACE:
                return JsonObject(
                    {
                        "metadata": {"uid": "restored-claim"},
                        "spec": {"volumeName": "restored-volume"},
                        "status": {"phase": "Bound"},
                    }
                )
            return existing_read(kind, name, namespace)

        with patch.object(control, "read", side_effect=restored_claim):
            control.restore_backup(self.path, journal)
        self.assertEqual(journal.object("restore").string("volumeName"), "restored-volume")
        self.assertEqual(journal.object("restore").string("byteVerification"), "PENDING")
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 0)

        def aliased_volume(kind: str, name: str, namespace: str = control.NAMESPACE) -> JsonObject:
            result = restored_claim(kind, name, namespace)
            if kind == "pv" and name == "restored-volume":
                result.object("spec").object("csi")["volumeHandle"] = "source-dataset"
            return result

        with (
            patch.object(control, "read", side_effect=aliased_volume),
            self.assertRaisesRegex(ValueError, "independent native storage"),
        ):
            control.restore_backup(self.path, journal)
        with (
            patch.object(
                control, "read", side_effect=lambda kind, name, namespace=control.NAMESPACE: existing_read(kind, name)
            ),
            self.assertRaisesRegex(ValueError, "distinct bound"),
        ):
            control.restore_backup(self.path, journal)

    def test_uncertain_resource_creates_read_back_before_retrying_and_refuse_changed_ownership(self):
        manifest = JsonObject(
            {
                "apiVersion": "velero.io/v1",
                "kind": "Backup",
                "metadata": {"name": "fixture", "namespace": "velero", "labels": {control.LEASE: REQUEST}},
                "spec": {"includedNamespaces": [control.NAMESPACE]},
            }
        )
        ensure = control.ensure_resource
        with (
            patch.object(control, "run", return_value=json.dumps(manifest)),
            patch.object(control.subprocess, "run") as create,
        ):
            self.assertEqual(ensure(manifest), manifest)
            create.assert_not_called()
        foreign = copy.deepcopy(manifest)
        foreign.object("metadata").strings("labels")[control.LEASE] = "foreign"
        with (
            patch.object(control, "run", return_value=json.dumps(foreign)),
            self.assertRaisesRegex(ValueError, "another request"),
        ):
            ensure(manifest)
        changed = copy.deepcopy(manifest)
        changed.object("spec")["includedNamespaces"] = ["other"]
        with (
            patch.object(control, "run", return_value=json.dumps(changed)),
            self.assertRaisesRegex(ValueError, "has changed"),
        ):
            ensure(manifest)

    def reader_fixture(self):
        journal = self.initialize()
        control.acquire(self.path, journal)
        journal["backup"] = {"uid": "backup-uid", "phase": "Completed"}
        journal["restore"] = {
            "phase": "Completed",
            "uid": "restore-uid",
            "claimUid": "restored-claim",
            "volumeName": "restored-volume",
            "volumeUid": "restored-volume-uid",
            "byteVerification": "PENDING",
            "volumeSource": {"driver": "zfs.csi.openebs.io", "volumeHandle": "restored-dataset"},
        }
        pods: dict[str, JsonObject] = {}
        previous_read, previous_run = self.cluster.read, self.cluster.run

        def reader_read(kind: str, name: str, namespace: str = control.NAMESPACE) -> JsonObject:
            if kind == "pod":
                return copy.deepcopy(pods[namespace])
            if kind == "pvc" and namespace == control.RESTORED_NAMESPACE:
                return JsonObject(
                    {
                        "metadata": {"uid": "restored-claim"},
                        "spec": {"volumeName": "restored-volume"},
                        "status": {"phase": "Bound"},
                    }
                )
            if kind == "pv" and name == "restored-volume":
                return JsonObject(
                    {
                        "metadata": {"uid": "restored-volume-uid"},
                        "spec": {"csi": copy.deepcopy(journal.object("restore").strings("volumeSource"))},
                    }
                )
            return previous_read(kind, name, namespace)

        def reader_run(arguments: list[str], timeout: float = 30) -> str:
            if arguments[2:4] == ["get", "pods"]:
                return json.dumps({"items": [pods[arguments[1]]] if arguments[1] in pods else []})
            if arguments[2:4] == ["get", "pod"]:
                return json.dumps(pods[arguments[1]]) if arguments[1] in pods else ""
            if arguments[2] == "wait":
                return "ready"
            return previous_run(arguments, timeout)

        def reader_create(manifest: Mapping[str, object]) -> JsonObject:
            manifest = JsonObject(manifest)
            namespace = manifest.object("metadata").string("namespace")
            if namespace not in pods:
                pods[namespace] = copy.deepcopy(manifest)
                pods[namespace].object("metadata").update(uid=namespace + "-reader-uid", resourceVersion="1")
                pods[namespace]["status"] = {"phase": "Running"}
            return copy.deepcopy(pods[namespace])

        patch.object(control, "read", side_effect=reader_read).start()
        patch.object(control, "run", side_effect=reader_run).start()
        patch.object(control, "ensure_resource", side_effect=reader_create).start()
        return journal, pods

    def test_complete_volume_comparison_records_only_hashes_and_keeps_admission_closed(self):
        journal, pods = self.reader_fixture()
        files = {"world/level.dat": "a" * 64, "plugins/TheStorm/the-storm.db": "b" * 64}
        with patch.object(control, "remote_fingerprint", return_value=files) as hashing:
            control.verify_backup(self.path, journal)
        self.assertEqual(hashing.call_count, 2)
        self.assertEqual(journal.object("restore").string("byteVerification"), "VERIFIED")
        self.assertEqual(journal.string("phase"), "LEASED_OFFLINE")
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 0)
        proof = Path(journal.object("restore").string("proofPath"))
        self.assertEqual(json.loads(proof.read_text())["files"], files)
        self.assertEqual(
            hashlib.sha256(proof.read_bytes()).hexdigest(), journal.object("restore").string("proofSha256")
        )
        self.assertEqual(proof.stat().st_mode & 0o777, 0o600)
        for pod in pods.values():
            self.assertTrue(pod.object("spec").objects("volumes")[0].object("persistentVolumeClaim")["readOnly"])
            self.assertTrue(pod.object("spec").objects("containers")[0].objects("volumeMounts")[0]["readOnly"])
            self.assertFalse(pod.object("spec")["automountServiceAccountToken"])

    def test_mismatched_volume_never_receives_a_verified_receipt(self):
        journal, _ = self.reader_fixture()
        with (
            patch.object(control, "remote_fingerprint", side_effect=[{"file": "a"}, {"file": "b"}]),
            self.assertRaisesRegex(ValueError, "whole volume differs"),
        ):
            control.verify_backup(self.path, journal)
        self.assertEqual(journal.object("restore").string("byteVerification"), "FAILED")
        self.assertFalse(self.path.with_name(self.path.name + ".backup-files.json").exists())
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 0)

    def export_fixture(self):
        journal, _ = self.reader_fixture()
        contents = {
            "world/level.dat": b"native metadata",
            "plugins/TheStorm/the-storm.db": b"identity",
            "world/dimensions/minecraft/overworld/region/r.3.4.mca": b"arena terrain",
            "world/dimensions/minecraft/rwf/data/paper/metadata.dat": b"rwf identity",
            "world/dimensions/minecraft/rwf/region/r.0.0.mca": b"rwf terrain",
            "world/data/minecraft/maps/13.dat": b"map",
            "server.properties": b"private configuration",
            "plugins/TheStorm/config.yml": b"private configuration",
        }
        hashes = {name: hashlib.sha256(value).hexdigest() for name, value in contents.items()}
        with patch.object(control, "remote_fingerprint", return_value=hashes):
            control.verify_backup(self.path, journal)
        return journal, contents

    def export_tar(self, contents: dict[str, bytes]) -> io.BytesIO:
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as archive:
            for name, value in contents.items():
                member = tarfile.TarInfo(name)
                member.size = len(value)
                archive.addfile(member, io.BytesIO(value))
        output.seek(0)
        return output

    def test_export_copies_complete_native_selection_without_server_configuration_or_unlocking(self):
        journal, contents = self.export_fixture()
        destination, proof = self.path.parent / "native-export", self.path.parent / "export.json"

        def exporting(actual_journal: JsonObject, target: Path, expected: dict[str, str]) -> None:
            self.assertIs(actual_journal, journal)
            selected = {name: value for name, value in contents.items() if name in expected}
            control.export_stream(self.export_tar(selected), target, expected)

        with patch.object(control, "remote_export", side_effect=exporting):
            control.export_backup(self.path, journal, destination, proof)
        receipt = json.loads(proof.read_text())
        expected = control.backup_contract.verified_export(receipt)
        self.assertEqual(set(expected), {name for name in contents if not name.endswith((".properties", ".yml"))})
        self.assertEqual(
            {str(file.relative_to(destination)) for file in destination.rglob("*") if file.is_file()}, set(expected)
        )
        self.assertTrue(all((destination / name).stat().st_mode & 0o777 == 0o600 for name in expected))
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
        self.assertEqual(proof.stat().st_mode & 0o777, 0o600)
        self.assertEqual(journal.object("export").string("phase"), "VERIFIED")
        self.assertEqual(journal.string("phase"), "LEASED_OFFLINE")
        self.assertEqual(self.cluster.server.object("spec").integer("replicas"), 0)

    def test_export_requires_original_verified_storage_and_a_new_destination(self):
        journal, _ = self.export_fixture()
        destination, proof = self.path.parent / "native-export", self.path.parent / "export.json"
        with patch.object(control, "remote_export") as exporting:
            for change in ("unverified", "changed-proof", "changed-volume", "existing-destination"):
                with self.subTest(change=change):
                    altered = copy.deepcopy(journal)
                    if change == "unverified":
                        altered.object("restore")["byteVerification"] = "PENDING"
                    elif change == "changed-proof":
                        altered.object("restore")["proofSha256"] = "f" * 64
                    elif change == "changed-volume":
                        altered.object("restore")["volumeUid"] = "replaced"
                    else:
                        destination.mkdir()
                    with self.assertRaises(ValueError):
                        control.export_backup(self.path, altered, destination, proof)
                    exporting.assert_not_called()
                    self.assertFalse(proof.exists())

    def test_failed_export_retains_private_copy_without_a_success_receipt(self):
        journal, _ = self.export_fixture()
        destination, proof = self.path.parent / "native-export", self.path.parent / "export.json"
        with (
            patch.object(control, "remote_export", side_effect=RuntimeError("interrupted")),
            self.assertRaisesRegex(RuntimeError, "interrupted"),
        ):
            control.export_backup(self.path, journal, destination, proof)
        self.assertTrue(destination.is_dir())
        self.assertEqual(journal.object("export").string("phase"), "FAILED")
        self.assertFalse(proof.exists())

    def test_export_stream_rejects_extra_missing_corrupted_and_duplicate_files(self):
        expected = {"world/level.dat": hashlib.sha256(b"expected").hexdigest()}
        for index, contents in enumerate(
            ({}, {"world/level.dat": b"corrupt"}, {"server.properties": b"configuration"}, {"../outside": b"escape"})
        ):
            with self.subTest(contents=contents):
                target = self.path.parent / ("failed-" + str(index))
                target.mkdir(mode=0o700)
                with self.assertRaises(ValueError):
                    control.export_stream(self.export_tar(contents), target, expected)
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE, tarfile.CHRTYPE):
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w") as archive:
                member = tarfile.TarInfo("world/level.dat")
                member.type = kind
                archive.addfile(member)
            output.seek(0)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                control.export_stream(output, self.path.parent, expected)
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as archive:
            for _ in range(2):
                member = tarfile.TarInfo("world/level.dat")
                member.size = len(b"expected")
                archive.addfile(member, io.BytesIO(b"expected"))
        output.seek(0)
        duplicate = self.path.parent / "duplicate"
        duplicate.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            control.export_stream(output, duplicate, expected)

    def test_reader_refuses_replacement_extra_container_writable_volume_and_secret_environment(self):
        journal, pods = self.reader_fixture()
        with patch.object(control, "remote_fingerprint", return_value={"file": "checksum"}):
            control.verify_backup(self.path, journal)
        original = copy.deepcopy(pods[control.NAMESPACE])
        for change in ("uid", "container", "volume", "environment", "init", "ephemeral"):
            with self.subTest(change=change):
                pod = copy.deepcopy(original)
                if change == "uid":
                    pod.object("metadata")["uid"] = "replaced"
                elif change == "container":
                    pod.object("spec").objects("containers").append(JsonObject({"name": "unreviewed"}))
                elif change == "volume":
                    pod.object("spec").objects("volumes")[0].object("persistentVolumeClaim")["readOnly"] = False
                elif change == "environment":
                    pod.object("spec").objects("containers")[0]["envFrom"] = [{"secretRef": {"name": "unreviewed"}}]
                else:
                    pod.object("spec")["initContainers" if change == "init" else "ephemeralContainers"] = [{}]
                with self.assertRaisesRegex(ValueError, "read-only pod"):
                    control.assert_reader(pod, journal, control.NAMESPACE)

    def test_reader_cleanup_deletes_only_recorded_uid_and_version_and_can_resume(self):
        journal, pods = self.reader_fixture()
        with patch.object(control, "remote_fingerprint", return_value={"file": "checksum"}):
            control.verify_backup(self.path, journal)
        calls = []

        def delete(arguments: list[str], **kwargs: object):
            encoded = kwargs["input"]
            if not isinstance(encoded, str):
                raise AssertionError("Expected a JSON deletion body")
            body = JsonObject.parse(encoded)
            namespace = arguments[5].split("/")[4]
            self.assertEqual(
                body.object("preconditions"),
                {"uid": pods[namespace].object("metadata").string("uid"), "resourceVersion": "1"},
            )
            calls.append(namespace)
            del pods[namespace]
            return control.subprocess.CompletedProcess(arguments, 0, "", "")

        with patch.object(control.subprocess, "run", side_effect=delete):
            control.remove_readers(self.path, journal)
            control.remove_readers(self.path, journal)
        self.assertEqual(calls, [control.NAMESPACE, control.RESTORED_NAMESPACE])
        self.assertTrue(journal["readersRemoved"])

    def test_reader_cleanup_refuses_an_unrelated_namespace_before_deleting_anything(self):
        journal, _ = self.reader_fixture()
        journal["readers"] = {"other-service": "foreign-pod"}
        with patch.object(control.subprocess, "run") as deletion:
            with self.assertRaisesRegex(ValueError, "outside the two recorded"):
                control.remove_readers(self.path, journal)
            deletion.assert_not_called()

    def test_tar_volume_hashes_without_extracting_contents_and_rejects_unsafe_records(self):
        def stream(extra: tarfile.TarInfo | None = None, omit_database: bool = False) -> io.BytesIO:
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w") as archive:
                names = ["./world/level.dat", "./world/session.lock"]
                if not omit_database:
                    names.append("./plugins/TheStorm/the-storm.db")
                for name in names:
                    member = tarfile.TarInfo(name)
                    member.size = len(b"fixture bytes")
                    archive.addfile(member, io.BytesIO(b"fixture bytes"))
                if extra is not None:
                    archive.addfile(extra, io.BytesIO())
            output.seek(0)
            return output

        expected = hashlib.sha256(b"fixture bytes").hexdigest()
        self.assertEqual(
            control.tar_fingerprint(stream()), {"world/level.dat": expected, "plugins/TheStorm/the-storm.db": expected}
        )
        for name, kind in (
            ("../outside", tarfile.REGTYPE),
            ("/absolute", tarfile.REGTYPE),
            ("linked", tarfile.SYMTYPE),
            ("hardlink", tarfile.LNKTYPE),
            ("device", tarfile.CHRTYPE),
            ("./world/level.dat", tarfile.REGTYPE),
        ):
            with self.subTest(name=name, kind=kind):
                member = tarfile.TarInfo(name)
                member.type = kind
                with self.assertRaises(ValueError):
                    control.tar_fingerprint(stream(member))
        with self.assertRaisesRegex(ValueError, "expected Storm world and database"):
            control.tar_fingerprint(stream(omit_database=True))
        with self.assertRaises(tarfile.ReadError):
            control.tar_fingerprint(io.BytesIO(stream().getvalue()[:550]))


if __name__ == "__main__":
    unittest.main()

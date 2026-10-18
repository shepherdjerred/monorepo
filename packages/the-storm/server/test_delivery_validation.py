"""Lightweight regressions: never boot Paper or touch a real cluster in CI."""

import copy
import hashlib
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

import delivery_candidate
import delivery_validation
from delivery_receipt import SCHEMA
from restoration_json import JsonObject

REQUEST = "6903b19f-f4d2-42a5-91ba-6ce046562c83"
IMAGE = "docker.io/shepherdjerred/the-storm-server:candidate@sha256:" + "a" * 64


def journal() -> JsonObject:
    return JsonObject(
        {
            "requestId": REQUEST,
            "candidateImage": IMAGE,
            "rollbackImage": IMAGE.replace("candidate", "accepted"),
            "claimUid": "original-claim",
            "volumeUid": "original-volume",
            "volumeSource": {"driver": "zfs", "volumeHandle": "original-dataset"},
            "restore": {
                "claimUid": "restored-claim",
                "volumeName": "restored-pv",
                "volumeUid": "restored-volume",
                "volumeSource": {"driver": "zfs", "volumeHandle": "restored-dataset"},
            },
            "productionWriteAuthorized": False,
        }
    )


def candidate_pod(control: ModuleType, state: JsonObject) -> JsonObject:
    pod = delivery_candidate.pod_manifest(control, state)
    pod.object("metadata").update(uid="candidate-uid", resourceVersion="7")
    return pod


class CandidateIsolationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.control = delivery_validation.load_control()
        self.control.__dict__["RESTORED_NAMESPACE"] = self.control.DELIVERY_VALIDATION_NAMESPACE
        self.state = journal()

    def test_neutral_recipe_matches_receipt_policy_and_only_renders_reviewed_parameters(self) -> None:
        policy = SCHEMA.object("properties").object("candidate").object("properties").object("safeModules")
        self.assertEqual(
            list(delivery_candidate.SAFE_MODULES), [rule.string("const") for rule in policy.objects("prefixItems")]
        )
        rendered = delivery_candidate.pod_manifest(self.control, self.state)
        expected = json.loads(
            json.dumps(delivery_candidate.TEMPLATE)
            .replace("{{requestId}}", REQUEST)
            .replace("{{candidateImage}}", IMAGE)
        )
        self.assertEqual(rendered, expected)
        for key, invalid in (
            ("requestId", 'bad"request'),
            ("candidateImage", "docker.io/shepherdjerred/the-storm-server:latest"),
        ):
            unsafe = copy.deepcopy(self.state)
            unsafe[key] = invalid
            with self.subTest(key=key), self.assertRaises(ValueError):
                delivery_candidate.pod_manifest(self.control, unsafe)
        self.control.__dict__["RESTORED_NAMESPACE"] = "minecraft-tsmc"
        with self.assertRaisesRegex(ValueError, "fixed validation namespace"):
            delivery_candidate.pod_manifest(self.control, self.state)

    def test_exact_restored_claim_and_no_production_credentials_or_identity(self) -> None:
        pod = candidate_pod(self.control, self.state)
        delivery_candidate.assert_pod(self.control, self.state, pod)
        spec = pod.object("spec")
        self.assertIs(spec["automountServiceAccountToken"], False)
        self.assertIs(spec["enableServiceLinks"], False)
        self.assertIs(spec.object("securityContext")["runAsNonRoot"], True)
        self.assertEqual(spec.object("securityContext")["seccompProfile"], {"type": "RuntimeDefault"})
        for container in spec.objects("containers") + spec.objects("initContainers"):
            security = container.object("securityContext")
            self.assertIs(security["allowPrivilegeEscalation"], False)
            self.assertEqual(security["capabilities"], {"drop": ["ALL"]})
        claims = [
            volume.object("persistentVolumeClaim").string("claimName")
            for volume in spec.objects("volumes")
            if "persistentVolumeClaim" in volume
        ]
        self.assertEqual(claims, [self.control.CLAIM])
        self.assertEqual(pod.object("metadata").string("namespace"), self.control.RESTORED_NAMESPACE)
        env = {item.string("name"): item.string("value") for item in spec.objects("containers")[0].objects("env")}
        self.assertEqual(env["SERVER_IP"], "127.0.0.1")
        self.assertEqual(env["MC_BRIDGE_BIND"], "127.0.0.1")
        self.assertEqual(env["ENABLE_RCON"], "FALSE")
        self.assertFalse(
            set(env)
            & {
                "DISCORD_BOT_TOKEN",
                "STORM_BRAIN_BEARER_TOKEN",
                "AWS_SECRET_ACCESS_KEY",
                "DATABASE_URL",
                "OP_SERVICE_ACCOUNT_TOKEN",
            }
        )

    def test_candidate_overlay_preserves_every_image_module_key_and_disables_remote_integrations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugins = root / "plugins"
            overlay = root / "overlay"
            for name in ("TheStorm", "Geyser-Spigot"):
                (plugins / name).mkdir(parents=True)
                (plugins / name / "config.yml").write_bytes(
                    Path(__file__).with_name("owned").joinpath("plugins", name, "config.yml").read_bytes()
                )
            script = delivery_candidate.CONFIGURE.replace("/plugins/", str(plugins) + "/").replace(
                "/overlay", str(overlay)
            )
            subprocess.run(["bash", "-c", script], check=True, capture_output=True, text=True)
            actual = dict(
                re.findall(r"^  ([a-z][a-z0-9]*): (true|false)$", (overlay / "TheStorm/config.yml").read_text(), re.M)
            )
            original = dict(
                re.findall(r"^  ([a-z][a-z0-9]*): (true|false)$", (plugins / "TheStorm/config.yml").read_text(), re.M)
            )
            self.assertEqual(set(actual), set(original))
            self.assertEqual(
                {key for key, enabled in actual.items() if enabled == "true"}, set(delivery_candidate.SAFE_MODULES)
            )
            self.assertEqual(actual["agent"], "false")
            self.assertEqual(actual["discord"], "false")
            self.assertEqual(actual["companions"], "false")
            self.assertIn("address: 127.0.0.1", (overlay / "geyser.yml").read_text())
            self.assertEqual((overlay / "bluemap-webserver.conf").read_text(), "enabled: false\n")

    def test_rejects_secret_injection_privilege_host_access_and_foreign_incarnation(self) -> None:
        mutations = [
            lambda pod: pod.object("spec").update(hostNetwork=True),
            lambda pod: pod.object("spec").update(serviceAccountName="delivery-controller"),
            lambda pod: (
                pod.object("spec").objects("containers")[0].update(envFrom=[{"secretRef": {"name": "production"}}])
            ),
            lambda pod: (
                pod.object("spec")
                .objects("containers")[0]
                .object("securityContext")
                .object("capabilities")
                .update(add=["NET_ADMIN"])
            ),
            lambda pod: (
                pod.object("spec")
                .objects("initContainers")[0]
                .update(lifecycle={"postStart": {"exec": {"command": ["bad"]}}})
            ),
            lambda pod: pod.object("metadata").update(uid="replacement"),
        ]
        self.state["deliveryCandidate"] = {"podUid": "candidate-uid"}
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                pod = candidate_pod(self.control, self.state)
                mutate(pod)
                with self.assertRaises(ValueError):
                    delivery_candidate.assert_pod(self.control, self.state, pod)

    def test_native_storage_alias_and_replacement_fail_before_candidate_access(self) -> None:
        claim = JsonObject(
            {"metadata": {"uid": "restored-claim"}, "status": {"phase": "Bound"}, "spec": {"volumeName": "restored-pv"}}
        )
        volume = JsonObject(
            {
                "metadata": {"uid": "restored-volume"},
                "spec": {"csi": {"driver": "zfs", "volumeHandle": "restored-dataset"}},
            }
        )
        with (
            patch.object(self.control, "require_offline"),
            patch.object(self.control, "read", side_effect=[claim, volume]),
            patch.object(self.control, "run", return_value='{"items":[]}'),
        ):
            delivery_candidate.assert_storage(self.control, self.state)
        for change in ("uid", "handle"):
            unsafe = copy.deepcopy(volume)
            if change == "uid":
                unsafe.object("metadata")["uid"] = "replacement"
            else:
                unsafe.object("spec").object("csi")["volumeHandle"] = "original-dataset"
            with (
                patch.object(self.control, "require_offline"),
                patch.object(self.control, "read", side_effect=[claim, unsafe]),
                self.assertRaisesRegex(ValueError, "aliases production"),
            ):
                delivery_candidate.assert_storage(self.control, self.state)

    def test_interrupted_candidate_is_not_replayed_on_already_migrated_copy(self) -> None:
        self.state["deliveryCandidate"] = {"started": True, "podUid": "prior-uid"}
        with (
            patch.object(delivery_candidate, "assert_storage"),
            patch.object(self.control, "ensure_resource") as create,
            self.assertRaisesRegex(ValueError, "already started"),
        ):
            delivery_candidate.check_candidate(self.control, Path("unused"), self.state)
        create.assert_not_called()

    def test_lost_stop_response_requires_successful_recorded_process_exit(self) -> None:
        for exit_code in (0, 1):
            with self.subTest(exit_code=exit_code):
                pod = candidate_pod(self.control, self.state)
                pod["status"] = {
                    "phase": "Succeeded" if exit_code == 0 else "Failed",
                    "containerStatuses": [{"restartCount": 0, "state": {"terminated": {"exitCode": exit_code}}}],
                }
                with (
                    patch.object(delivery_candidate, "bridge", side_effect=RuntimeError("closing connection")),
                    patch.object(delivery_candidate, "assert_storage"),
                    patch.object(self.control, "read", return_value=pod),
                ):
                    if exit_code == 0:
                        delivery_candidate.stop_candidate(self.control, self.state)
                    else:
                        with self.assertRaisesRegex(ValueError, "stop successfully"):
                            delivery_candidate.stop_candidate(self.control, self.state)


class GameplayTest(unittest.TestCase):
    def check(self, inventory: list[dict[str, object]]) -> list[tuple[str, str]]:
        calls: list[tuple[str, str]] = []

        def request(method: str, route: str, body: object = None) -> JsonObject:
            calls.append((method, route))
            if route == "info":
                return JsonObject(
                    {
                        "worlds": [{"name": "actual-restored-world", "key": "minecraft:overworld"}],
                        "plugins": [
                            {"name": name, "enabled": True}
                            for name in ("TheStorm", "MCBridge", "Citizens", "LuckPerms")
                        ],
                    }
                )
            if method == "POST" and route == "actors":
                actor = JsonObject.require(body)
                return JsonObject(
                    {
                        "name": actor.string("name"),
                        "world": "actual-restored-world",
                        "uuid": "actor-uid",
                        "op": actor["op"],
                    }
                )
            if route == "regions/read":
                return JsonObject({"palette": ["minecraft:air"], "blocks": "AAAAAA=="})
            if route == "actors/DeliveryGuest/place":
                return JsonObject(
                    {"ok": False, "detail": "a BlockPlaceEvent listener cancelled placing minecraft:diamond_block"}
                )
            if method == "GET":
                reads = sum(1 for verb, path in calls if verb == "GET" and path == route)
                return JsonObject({"actor": {"uuid": "actor-uid"}, "inventory": [] if reads == 1 else inventory})
            return JsonObject({"ok": True})

        result = delivery_candidate.verify_gameplay(request)
        self.assertEqual(result["diamondsAfter"], 1)
        return calls

    def test_observes_real_inventory_effect_and_removes_named_actor(self) -> None:
        calls = self.check([{"item": "minecraft:diamond", "count": 1}])
        self.assertIn(("POST", "actors/DeliveryCheck/command"), calls)
        self.assertEqual(calls[-1], ("DELETE", "actors/DeliveryCheck"))

    def test_ok_true_without_observed_effect_does_not_qualify(self) -> None:
        with self.assertRaisesRegex(ValueError, "observed inventory effect"):
            self.check([])


class OrchestrationTest(unittest.TestCase):
    def test_eligibility_waits_for_players_and_existing_owners_without_mutation(self) -> None:
        control = delivery_validation.load_control()
        server = JsonObject({"metadata": {"annotations": {}}, "spec": {"replicas": 1}})
        application = JsonObject({"status": {}})
        service = JsonObject({"metadata": {"annotations": {}}, "spec": {"selector": {"app": "minecraft-tsmc"}}})

        def read(kind: str, name: str, namespace: str = control.NAMESPACE) -> JsonObject:
            if kind == "statefulset":
                return server
            return application if kind == "application" else service

        ready = json.dumps({"status": {"phase": "Running", "containerStatuses": [{"ready": True}]}})
        with (
            patch.object(control, "read", side_effect=read),
            patch.object(control, "run", side_effect=["", ready, "There are 2 of a max of 20 players online"]) as run,
        ):
            self.assertEqual(
                delivery_validation.eligibility(control),
                {"status": "waiting", "reason": "players-online", "players": 2},
            )
            self.assertEqual(run.call_count, 3)
            self.assertEqual(run.call_args.args[0][-1], "minecraft:list")
        with (
            patch.object(control, "read", side_effect=read),
            patch.object(control, "run", side_effect=["", ready, "There are 0 of a max of 20 players online"]),
        ):
            self.assertEqual(delivery_validation.eligibility(control), {"status": "eligible", "players": 0})
        server.object("metadata").strings("annotations")[control.MINING] = "existing-owner"
        with patch.object(control, "read", side_effect=read), patch.object(control, "run") as run:
            self.assertEqual(
                delivery_validation.eligibility(control), {"status": "waiting", "reason": "maintenance-owner"}
            )
            run.assert_not_called()

    def test_eligibility_never_turns_unparsed_player_output_into_empty(self) -> None:
        control = delivery_validation.load_control()
        server = JsonObject({"metadata": {"annotations": {}}, "spec": {"replicas": 1}})
        service = JsonObject({"metadata": {"annotations": {}}, "spec": {"selector": {}}})
        ready = json.dumps({"status": {"phase": "Running", "containerStatuses": [{"ready": True}]}})
        with (
            patch.object(
                control, "read", side_effect=[server, JsonObject({"status": {}}), *[service for _ in control.SERVICES]]
            ),
            patch.object(control, "run", side_effect=["", ready, "Unknown command"]),
            self.assertRaisesRegex(ValueError, "authoritative player count"),
        ):
            delivery_validation.eligibility(control)

    def test_private_journal_boundary_never_changes_shared_ancestor_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "owned"
            private.mkdir(mode=0o700)
            delivery_validation.require_private_workspace(private / "journal.json")
            private.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "inaccessible"):
                delivery_validation.require_private_workspace(private / "journal.json")
            self.assertEqual(private.stat().st_mode & 0o777, 0o755)

    def test_composes_only_non_destructive_existing_controller_operations(self) -> None:
        control = delivery_validation.load_control()
        state = journal()
        events: list[str] = []
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            with (
                patch.object(control, "acquire", side_effect=lambda *_: events.append("acquire")),
                patch.object(delivery_validation, "wait_completed", side_effect=lambda *args: events.append(args[-1])),
                patch.object(control, "verify_backup", side_effect=lambda *_: events.append("verify")),
                patch.object(control, "remove_readers", side_effect=lambda *_: events.append("remove-readers")),
                patch.object(delivery_candidate, "check_candidate", side_effect=lambda *_: events.append("candidate")),
                patch.object(delivery_validation, "recover", side_effect=lambda *_: events.append("recover")),
                patch.object(delivery_validation, "cleanup_copy", side_effect=lambda *_: events.append("cleanup")),
                patch.object(delivery_validation, "receipt", return_value=JsonObject({"candidateImage": IMAGE})),
                patch.object(control, "save"),
            ):
                delivery_validation.validate(control, path, state)
                self.assertEqual(
                    events,
                    ["acquire", "backup", "restore", "verify", "remove-readers", "candidate", "recover", "cleanup"],
                )
                events.clear()
                with patch.object(delivery_validation, "validate_receipt", side_effect=lambda value: value):
                    delivery_validation.validate(control, path, state)
                    self.assertEqual(events, [])

    def test_recovery_refuses_original_writer_authorization(self) -> None:
        state = journal()
        state["productionWriteAuthorized"] = True
        control = delivery_validation.load_control()
        with (
            patch.object(delivery_candidate, "delete_pod") as delete,
            self.assertRaisesRegex(ValueError, "production writer"),
        ):
            delivery_validation.recover(control, Path("unused"), state)
        delete.assert_not_called()

    def test_receipt_requires_actual_hash_bound_complete_volume_and_abort_proof(self) -> None:
        state = journal()
        state.update(serverUid="server-uid", phase="REOPENED", backup={"uid": "backup-uid"})
        state["deliveryValidation"] = {"restoreNamespace": "minecraft-tsmc-delivery-validation"}
        state["deliveryCandidate"] = {
            "status": "VERIFIED",
            "gracefulStop": True,
            "verifiedAt": "2026-10-17T21:00:00+00:00",
            "podUid": "candidate-uid",
            "imageId": IMAGE,
            "containerId": "container-id",
            "restartCount": 0,
            "safeModules": list(delivery_candidate.SAFE_MODULES),
            "gameplaySha256": "c" * 64,
            "startupLogSha256": "d" * 64,
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, key in (("gameplay", "gameplaySha256"), ("startup", "startupLogSha256")):
                evidence = Path(directory) / (name + ".json")
                evidence.write_text('{"testOnly":true}', encoding="utf-8")
                state.object("deliveryCandidate")[name + "ProofPath"] = str(evidence)
                state.object("deliveryCandidate")[key] = hashlib.sha256(evidence.read_bytes()).hexdigest()
            proof = Path(directory) / "proof.json"
            proof.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "status": "VERIFIED",
                        "requestId": REQUEST,
                        "backupUid": "backup-uid",
                        "sourceVolumeUid": "original-volume",
                        "restoredVolumeUid": "restored-volume",
                        "files": {"world/level.dat": "a" * 64, "plugins/TheStorm/the-storm.db": "b" * 64},
                    }
                ),
                encoding="utf-8",
            )
            abort = Path(directory) / "abort.json"
            abort.write_text(
                json.dumps(
                    {
                        "status": "NO_PRODUCTION_WRITE_AUTHORIZATION",
                        "requestId": REQUEST,
                        "serverUid": "server-uid",
                        "volumeUid": "original-volume",
                        "rollbackImage": state.string("rollbackImage"),
                    }
                ),
                encoding="utf-8",
            )
            state["preInstallAbort"] = {"path": str(abort), "sha256": hashlib.sha256(abort.read_bytes()).hexdigest()}
            state.object("restore").update(
                uid="restore-uid",
                proofPath=str(proof),
                proofSha256=hashlib.sha256(proof.read_bytes()).hexdigest(),
                files=2,
            )
            result = delivery_validation.receipt(state)
            self.assertEqual(result["originalUntouched"], True)
            self.assertEqual(result["candidateImage"], IMAGE)
            proof.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "changed after verification"):
                delivery_validation.receipt(state)


if __name__ == "__main__":
    unittest.main()

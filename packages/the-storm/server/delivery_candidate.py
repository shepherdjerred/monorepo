"""Bounded Paper compatibility check on an independently restored Storm PVC.

This is not a whole-world restoration or production gameplay acceptance. Flannel
does not enforce NetworkPolicy: isolation here is explicit local listeners,
no service identity/credentials, and a source-owned sandbox module overlay.
"""

import hashlib
import json
import re
import subprocess
import time
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType

from delivery_gameplay import verify_gameplay
from restoration_json import JsonObject

SANDBOX = JsonObject.parse(
    Path(__file__).resolve().parents[2].joinpath("homelab/src/minecraft-delivery-sandbox.json").read_bytes()
)
if set(SANDBOX) != {"schemaVersion", "safeModules", "podTemplate"} or SANDBOX.integer("schemaVersion") != 1:
    raise ValueError("Unknown neutral Minecraft sandbox recipe")
SAFE_MODULES = tuple(SANDBOX.string_list("safeModules"))
TEMPLATE = SANDBOX.object("podTemplate")
LABEL = "sjer.red/delivery-validation"
CONFIGURE = TEMPLATE.object("spec").objects("initContainers")[0].string_list("command")[2]


def pod_manifest(control: ModuleType, journal: JsonObject) -> JsonObject:
    request = journal.string("requestId")
    image = journal.string("candidateImage")
    if not re.fullmatch(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}", request):
        raise ValueError("Sandbox request must be a canonical UUID")
    if not re.fullmatch(
        r"docker\.io/shepherdjerred/the-storm-server:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[a-f0-9]{64}", image
    ):
        raise ValueError("Sandbox candidate must be an exact qualified Storm image")
    namespace = control.RESTORED_NAMESPACE
    claim = control.CLAIM
    if namespace != TEMPLATE.object("metadata").string("namespace"):
        raise ValueError("Sandbox requires the reviewed fixed validation namespace")
    if claim != TEMPLATE.object("spec").objects("volumes")[0].object("persistentVolumeClaim").string("claimName"):
        raise ValueError("Sandbox requires the reviewed restored claim")
    # Values cannot contain JSON syntax; only the two reviewed placeholders vary.
    encoded = json.dumps(TEMPLATE).replace("{{requestId}}", request).replace("{{candidateImage}}", image)
    if re.search(r"\{\{[A-Za-z]", encoded):
        raise ValueError("Unhandled neutral sandbox template placeholder")
    return JsonObject.parse(encoded)


def assert_pod(control: ModuleType, journal: JsonObject, pod: JsonObject) -> None:
    expected = pod_manifest(control, journal)
    if (
        not control.includes(pod.object("spec"), expected.object("spec"))
        or pod.object("metadata").get("name") != expected.object("metadata").string("name")
        or pod.object("metadata").get("namespace") != control.RESTORED_NAMESPACE
        or pod.object("metadata").strings("labels", {}).get(control.LEASE) != journal.string("requestId")
        or any(
            pod.object("spec").get(key)
            for key in ("hostNetwork", "hostPID", "hostIPC", "shareProcessNamespace", "ephemeralContainers")
        )
        or pod.object("spec").get("serviceAccountName", "default") != "default"
    ):
        raise ValueError("Candidate Pod is not the exact credentialless restored-copy sandbox")
    recorded = journal.object("deliveryCandidate", {}).get("podUid")
    if recorded is not None and recorded != pod.object("metadata").string("uid"):
        raise ValueError("Candidate Pod incarnation changed")
    for actual, declared in zip(
        pod.object("spec").objects("containers") + pod.object("spec").objects("initContainers"),
        expected.object("spec").objects("containers") + expected.object("spec").objects("initContainers"),
        strict=True,
    ):
        defaulted = {"imagePullPolicy", "terminationMessagePath", "terminationMessagePolicy"}
        if set(actual) - set(declared) - defaulted:
            raise ValueError("Candidate acquired an unreviewed container capability")
        if actual.get("envFrom") or actual.get("env", []) != declared.get("env", []):
            raise ValueError("Candidate acquired unreviewed environment credentials")
        if (
            actual.object("securityContext").get("privileged")
            or actual.object("securityContext").get("procMount", "Default") != "Default"
            or actual.object("securityContext").object("capabilities").get("add")
        ):
            raise ValueError("Candidate acquired privileged host access")


def assert_storage(control: ModuleType, journal: JsonObject) -> None:
    """Fence both native storage identities even while the candidate owns the copy."""
    control.require_offline(journal)
    restored = journal.object("restore")
    claim = control.read("pvc", control.CLAIM, control.RESTORED_NAMESPACE)
    volume = control.read("pv", restored.string("volumeName"), "")
    if (
        claim.object("metadata").get("uid") != restored.string("claimUid")
        or claim.object("status").get("phase") != "Bound"
        or claim.object("spec").get("volumeName") != restored.string("volumeName")
        or volume.object("metadata").get("uid") != restored.string("volumeUid")
        or control.volume_source(volume) != restored.strings("volumeSource")
        or restored.string("claimUid") == journal.string("claimUid")
        or restored.string("volumeUid") == journal.string("volumeUid")
        or restored.strings("volumeSource")["volumeHandle"] == journal.strings("volumeSource")["volumeHandle"]
    ):
        raise ValueError("Candidate storage was replaced or aliases production")
    pods = JsonObject.parse(control.run(["-n", control.RESTORED_NAMESPACE, "get", "pods", "-o", "json"])).objects(
        "items"
    )
    for pod in pods:
        if pod.object("status", {}).get("phase") not in ("Succeeded", "Failed") and any(
            volume.object("persistentVolumeClaim", {}).get("claimName") == control.CLAIM
            for volume in pod.object("spec").objects("volumes", [])
        ):
            assert_pod(control, journal, pod)


def bridge(control: ModuleType, journal: JsonObject, method: str, route: str, body: object = None) -> JsonObject:
    name = pod_manifest(control, journal).object("metadata").string("name")
    assert_storage(control, journal)
    pod = control.read("pod", name, control.RESTORED_NAMESPACE)
    assert_pod(control, journal, pod)
    arguments = [
        "-n",
        control.RESTORED_NAMESPACE,
        "exec",
        name,
        "-c",
        "candidate",
        "--",
        "curl",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "15",
        "-X",
        method,
        "-H",
        "Authorization: Bearer " + journal.string("requestId"),
        "-H",
        "Content-Type: application/json",
    ]
    if body is not None:
        arguments.extend(["--data", json.dumps(body)])
    arguments.append("http://127.0.0.1:25580/v1/" + route)
    return JsonObject.parse(control.run(arguments, 20))


def delete_pod(control: ModuleType, journal: JsonObject) -> None:
    name = pod_manifest(control, journal).object("metadata").string("name")
    encoded = control.run(
        ["-n", control.RESTORED_NAMESPACE, "get", "pod", name, "--ignore-not-found", "-o", "json"]
    ).strip()
    if not encoded:
        return
    pod = JsonObject.parse(encoded)
    assert_pod(control, journal, pod)
    completed = subprocess.run(
        [
            "kubectl",
            "--context",
            control.CONTEXT,
            "delete",
            "--raw",
            f"/api/v1/namespaces/{control.RESTORED_NAMESPACE}/pods/{name}",
            "-f",
            "-",
        ],
        input=json.dumps(
            {
                "apiVersion": "v1",
                "kind": "DeleteOptions",
                "gracePeriodSeconds": 120,
                "preconditions": {
                    "uid": pod.object("metadata").string("uid"),
                    "resourceVersion": pod.object("metadata").string("resourceVersion"),
                },
            }
        ),
        text=True,
        capture_output=True,
        timeout=30,
    )
    if completed.returncode:
        raise RuntimeError("Candidate deletion is ambiguous; retain maintenance ownership")
    control.run(["-n", control.RESTORED_NAMESPACE, "wait", "--for=delete", "pod/" + name, "--timeout=150s"], 155)


def stop_candidate(control: ModuleType, journal: JsonObject) -> None:
    """Require Paper's successful graceful exit, not merely a deleted Pod."""
    # A closing loopback HTTP connection may lose its response. Only the
    # recorded process exit below can resolve that ambiguity as success.
    with suppress(RuntimeError):
        bridge(control, journal, "POST", "command", {"command": "stop"})
    deadline = time.monotonic() + 120
    name = pod_manifest(control, journal).object("metadata").string("name")
    while True:
        assert_storage(control, journal)
        pod = control.read("pod", name, control.RESTORED_NAMESPACE)
        assert_pod(control, journal, pod)
        statuses = pod.object("status", {}).objects("containerStatuses", [])
        if statuses and statuses[0].object("state", {}).get("terminated") is not None:
            status = statuses[0]
            if (
                pod.object("status").get("phase") != "Succeeded"
                or status.integer("restartCount") != 0
                or status.object("state").object("terminated").integer("exitCode") != 0
            ):
                raise ValueError("Candidate did not save and stop successfully")
            return
        if time.monotonic() > deadline:
            raise ValueError("Candidate graceful shutdown exceeded deadline; retain ownership")
        time.sleep(2)


def check_candidate(control: ModuleType, path: Path, journal: JsonObject) -> JsonObject:
    assert_storage(control, journal)
    state = journal.object("deliveryCandidate", {})
    # A terminal or lost-response run is never retried against an already
    # migrated copy. Inspect its recorded Pod and start a fresh restore drill.
    if state.get("started") is True:
        raise ValueError("Candidate check already started; inspect the recorded incarnation before a fresh drill")
    state["started"] = True
    control.save(path, journal)
    pod = control.ensure_resource(pod_manifest(control, journal))
    assert_pod(control, journal, pod)
    state["podUid"] = pod.object("metadata").string("uid")
    control.save(path, journal)
    deadline = time.monotonic() + 900
    name = pod.object("metadata").string("name")
    while True:
        assert_storage(control, journal)
        pod = control.read("pod", name, control.RESTORED_NAMESPACE)
        assert_pod(control, journal, pod)
        if pod.object("status", {}).get("phase") in ("Failed", "Succeeded"):
            raise ValueError("Candidate terminated before compatibility acceptance")
        if time.monotonic() > deadline:
            raise ValueError("Candidate did not become ready within its bounded startup window")
        statuses = pod.object("status", {}).objects("containerStatuses", [])
        if statuses and statuses[0].object("state", {}).get("running") is not None:
            logs = control.run(
                ["-n", control.RESTORED_NAMESPACE, "logs", name, "-c", "candidate", "--limit-bytes=1000000"]
            )
            done = re.search(r"Done \([0-9.]+s\)!", logs)
            if done is not None:
                break
        time.sleep(5)
    if re.search(r"Error occurred while enabling|Could not load plugin|Ambiguous plugin name", logs):
        raise ValueError("Candidate plugin startup failed on the restored copy")
    enabled = re.search(r"Enabled modules: \[([^]]+)\]", logs)
    if enabled is None or set(enabled[1].split(", ")) != set(SAFE_MODULES):
        raise ValueError("Candidate did not use the exact sandbox integration policy")
    status = statuses[0]
    digests = [
        journal.string("candidateImage").split("@", 1)[1],
        *journal.object("deliveryValidation").string_list("runtimeDigests"),
    ]
    if status.integer("restartCount") != 0 or not any(status.string("imageID").endswith(digest) for digest in digests):
        raise ValueError("Candidate runtime does not prove the selected digest and first incarnation")

    def call(method: str, route: str, body: object = None) -> JsonObject:
        return bridge(control, journal, method, route, body)

    manifest = JsonObject.parse(
        control.run(
            [
                "-n",
                control.RESTORED_NAMESPACE,
                "exec",
                name,
                "-c",
                "candidate",
                "--",
                "cat",
                "/opt/the-storm/plugins.json",
            ]
        )
    )
    info = call("GET", "info")
    enabled_plugins = {plugin.string("name") for plugin in info.objects("plugins") if plugin.get("enabled") is True}
    if not {plugin.string("name") for plugin in manifest.objects("plugins")}.issubset(enabled_plugins):
        raise ValueError("Not every baked plugin enabled against the independently restored data")
    gameplay = verify_gameplay(call)
    assert_storage(control, journal)
    gameplay_path = path.with_name(path.name + ".candidate-gameplay.json")
    startup_path = path.with_name(path.name + ".candidate-startup.json")
    control.save(gameplay_path, gameplay)
    # Retain only allowlisted startup facts, never arbitrary plugin log lines
    # or restored player data that could contain private configuration.
    control.save(
        startup_path,
        {
            "done": done[0],
            "safeModules": list(SAFE_MODULES),
            "enabledPlugins": sorted(enabled_plugins),
            "podUid": state.string("podUid"),
            "imageId": status.string("imageID"),
        },
    )
    result = JsonObject(
        {
            "status": "VERIFIED",
            "podUid": state.string("podUid"),
            "imageId": status.string("imageID"),
            "containerId": status.string("containerID"),
            "restartCount": 0,
            "safeModules": list(SAFE_MODULES),
            "gameplayProofPath": str(gameplay_path.resolve()),
            "startupProofPath": str(startup_path.resolve()),
            "gameplaySha256": hashlib.sha256(gameplay_path.read_bytes()).hexdigest(),
            "startupLogSha256": hashlib.sha256(startup_path.read_bytes()).hexdigest(),
        }
    )
    stop_candidate(control, journal)
    result["gracefulStop"] = True
    result["verifiedAt"] = datetime.now(UTC).isoformat()
    delete_pod(control, journal)
    state.update(result)
    control.save(path, journal)
    return result

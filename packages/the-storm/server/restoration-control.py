#!/usr/bin/env python3
"""Restore Storm with closed admission, one verified rollback volume, and private acceptance."""

import argparse
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import threading
import uuid
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import IO

import restoration_activation
import restoration_files
import restoration_resources
from restoration_json import JsonObject

CONTEXT = "admin@torvalds"
NAMESPACE = "minecraft-tsmc"
SERVER = "minecraft-tsmc"
CLAIM = "datadir-minecraft-tsmc-0"
LEASE = "sjer.red/world-restore-lease"
PHASE = "sjer.red/world-restore-phase"
IMAGE = "sjer.red/world-restore-image"
ACCESS = "sjer.red/world-restore-access"
WAKE = "mc-router.itzg.me/autoScaleUp"
MINING = "sjer.red/mining-reset-lock"
SERVICES = (SERVER, SERVER + "-bedrock", SERVER + "-bluemap", SERVER + "-rcon")
POLICIES = (
    ("minecraft-tsmc-world-restoration.sjer.red", "statefulsets", "UPDATE"),
    ("minecraft-tsmc-world-restoration-scale.sjer.red", "statefulsets/scale", "UPDATE"),
    ("minecraft-tsmc-world-restoration-delete.sjer.red", "statefulsets", "DELETE"),
    ("minecraft-tsmc-world-restoration-service-write.sjer.red", "services", "UPDATE"),
    ("minecraft-tsmc-world-restoration-service-delete.sjer.red", "services", "DELETE"),
)
RESTORED_NAMESPACE = "minecraft-tsmc-restore"

backup_spec = importlib.util.spec_from_file_location(
    "restoration_backup", Path(__file__).with_name("restoration_backup.py")
)
if backup_spec is None or backup_spec.loader is None:
    raise RuntimeError("Restoration backup contract is unavailable")
backup_contract = importlib.util.module_from_spec(backup_spec)
backup_spec.loader.exec_module(backup_contract)


def run(arguments: list[str], timeout: float = 30) -> str:
    completed = subprocess.run(
        ["kubectl", "--context", CONTEXT, *arguments],
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    if completed.returncode:
        # These commands never read Secret objects or pod environments.
        raise RuntimeError("Kubernetes operation failed: " + completed.stderr.strip())
    return completed.stdout


def read(kind: str, name: str, namespace: str = NAMESPACE) -> JsonObject:
    arguments = (["-n", namespace] if namespace else []) + ["get", kind, name, "-o", "json"]
    return JsonObject.parse(run(arguments))


def includes(actual: object, expected: object) -> bool:
    """Compare declared fields while allowing Kubernetes defaulting within their objects."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and includes(actual[key], value) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return (
            isinstance(actual, list)
            and len(actual) == len(expected)
            and all(includes(left, right) for left, right in zip(actual, expected, strict=True))
        )
    return actual == expected


def ensure_resource(manifest: Mapping[str, object]) -> JsonObject:
    """Resume uncertain creates only after reading back the exact request-owned object."""
    manifest = JsonObject(manifest)
    metadata = manifest.object("metadata")
    namespace = metadata.string("namespace", "")
    arguments = (["-n", namespace] if namespace else []) + [
        "get",
        manifest.string("kind"),
        metadata.string("name"),
        "--ignore-not-found",
        "-o",
        "json",
    ]
    existing = run(arguments).strip()
    if not existing:
        completed = subprocess.run(
            ["kubectl", "--context", CONTEXT, "create", "-f", "-", "-o", "json"],
            input=json.dumps(manifest),
            text=True,
            capture_output=True,
            timeout=30,
        )
        if completed.returncode:
            raise RuntimeError("Kubernetes create failed; read back before retrying: " + completed.stderr.strip())
        existing = completed.stdout
    resource = JsonObject.parse(existing)
    if resource.object("metadata").strings("labels", {}).get(LEASE) != metadata.strings("labels")[
        LEASE
    ] or not includes(resource.object("spec", {}), manifest.object("spec", {})):
        raise ValueError("Backup or restore resource belongs to another request or has changed")
    return resource


def pointer(key: str) -> str:
    return key.replace("~", "~0").replace("/", "~1")


def patch(kind: str, name: str, current: JsonObject, operations: list[dict[str, object]]) -> None:
    version = current.object("metadata").string("resourceVersion")
    run(
        [
            "-n",
            NAMESPACE,
            "patch",
            kind,
            name,
            "--type=json",
            "-p",
            json.dumps([{"op": "test", "path": "/metadata/resourceVersion", "value": version}, *operations]),
        ]
    )


def save(path: Path, journal: Mapping[str, object]) -> None:
    temporary = path.with_name(path.name + ".writing")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(journal, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def journal_lock(path: Path):
    if path.is_symlink() or not path.parent.is_dir():
        raise ValueError("Expected an existing journal directory and a regular receipt path")
    descriptor = os.open(path.with_name(path.name + ".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+b") as handle:
        try:
            fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as failure:
            raise ValueError("Another operator owns this maintenance journal") from failure
        yield


def annotations(resource: JsonObject) -> dict[str, str]:
    return resource.object("metadata").strings("annotations", {})


def volume_source(volume: JsonObject) -> dict[str, str]:
    csi = volume.object("spec").object("csi")
    return {"driver": csi.string("driver"), "volumeHandle": csi.string("volumeHandle")}


def assert_guards() -> None:
    expected = json.loads(Path(__file__).with_name("restoration-guards.json").read_text(encoding="utf-8"))
    for resource in expected:
        live = read(resource["kind"].lower(), resource["name"], "")
        actual = dict(live.object("spec"))
        # Kubernetes defaults empty selectors; they select everything and add no restriction.
        for field in ("matchConstraints", "matchResources"):
            if field in actual:
                constraints = dict(JsonObject.require(actual[field]))
                for selector in ("namespaceSelector", "objectSelector"):
                    if constraints.get(selector) == {}:
                        constraints.pop(selector)
                if constraints:
                    actual[field] = constraints
                else:
                    actual.pop(field)
        if actual != resource["spec"]:
            raise ValueError("Restoration admission guard definition differs from the reviewed contract")
    for name, resource, operation in POLICIES:
        policy = read("validatingadmissionpolicy", name, "")
        binding = read("validatingadmissionpolicybinding", name, "")
        spec = policy.object("spec")
        status = policy.object("status", {})
        if (
            spec.get("failurePolicy") != "Fail"
            or status.get("observedGeneration") != policy.object("metadata").integer("generation")
            or "typeChecking" not in status
            or status.object("typeChecking").get("expressionWarnings")
            or binding.object("spec").get("policyName") != name
            or binding.object("spec").get("validationActions") != ["Deny"]
            or not any(
                resource in rule.string_list("resources") and operation in rule.string_list("operations")
                for rule in spec.object("matchConstraints").objects("resourceRules")
            )
        ):
            raise ValueError("Restoration admission guards have not reconciled without CEL errors")
        if (resource.endswith("/scale") or resource == "services") and binding.object("spec").object("paramRef") != {
            "name": SERVER,
            "namespace": NAMESPACE,
            "parameterNotFoundAction": "Allow" if resource == "services" else "Deny",
        }:
            raise ValueError("Admission guard does not bind the expected parent StatefulSet")


def server_image(server: JsonObject) -> str:
    containers = server.object("spec").object("template").object("spec").objects("containers")
    if len(containers) != 1:
        raise ValueError("Expected one Storm server container")
    return containers[0].string("image")


def assert_empty() -> None:
    output = run(["-n", NAMESPACE, "exec", SERVER + "-0", "-c", SERVER, "--", "rcon-cli", "minecraft:list"])
    players = re.search(r"There are (\d+) of a max of \d+ players online", output)
    if players is None or int(players[1]) != 0:
        raise ValueError("Maintenance requires a verified empty server")


def assert_denied(arguments: list[str], message: str) -> None:
    completed = subprocess.run(
        ["kubectl", "--context", CONTEXT, "-n", NAMESPACE, *arguments],
        text=True,
        capture_output=True,
        timeout=30,
    )
    if completed.returncode == 0 or message not in completed.stderr:
        raise ValueError("Restoration guard did not reject its live dry-run maintenance probe")


def assert_owner(server: JsonObject, journal: JsonObject, allow_unheld: bool = False) -> None:
    if server.object("metadata").string("uid") != journal.string("serverUid"):
        raise ValueError("Storm StatefulSet was replaced during maintenance")
    held = annotations(server).get(LEASE)
    if (held is None and not allow_unheld) or (held is not None and held != journal.string("requestId")):
        raise ValueError("Restoration lease belongs to another request or is missing")
    if MINING in annotations(server):
        raise ValueError("A mining reset owns this server")


def initialize(path: Path, request: str, image: str) -> JsonObject:
    if str(uuid.UUID(request)) != request or not re.fullmatch(
        r"ghcr\.io/shepherdjerred/the-storm-server:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}", image
    ):
        raise ValueError("Expected a canonical request UUID and an immutable Storm image")
    assert_guards()
    if path.exists():
        journal = JsonObject.parse(path.read_text(encoding="utf-8"))
        if (
            journal.string("requestId") != request
            or journal.string("candidateImage") != image
            or journal.string("context") != CONTEXT
            or journal.string("namespace") != NAMESPACE
        ):
            raise ValueError("Existing maintenance journal belongs to another request or target")
        return journal
    server = read("statefulset", SERVER)
    if any(key in annotations(server) for key in (LEASE, PHASE, IMAGE, MINING)):
        raise ValueError("Storm already has maintenance annotations; inspect their owner")
    claim = read("pvc", CLAIM)
    if claim.object("status").get("phase") != "Bound":
        raise ValueError("Storm data claim is not bound")
    volume = read("pv", claim.object("spec").string("volumeName"), "")
    services = {}
    for name in SERVICES:
        service = read("service", name)
        if (
            LEASE in annotations(service)
            or ACCESS in service.object("spec").strings("selector")
            or (name == SERVER and WAKE in annotations(service))
        ):
            raise ValueError("A Storm route already has maintenance state")
        services[name] = {
            "uid": service.object("metadata").string("uid"),
            "selector": service.object("spec").strings("selector"),
        }
    journal = JsonObject(
        {
            "schemaVersion": 1,
            "context": CONTEXT,
            "namespace": NAMESPACE,
            "requestId": request,
            "candidateImage": image,
            "rollbackImage": server_image(server),
            "rollbackTemplate": server.object("spec").object("template"),
            "serverUid": server.object("metadata").string("uid"),
            "claimUid": claim.object("metadata").string("uid"),
            "volumeName": claim.object("spec").string("volumeName"),
            "volumeUid": volume.object("metadata").string("uid"),
            "volumeSource": volume_source(volume),
            "services": services,
            "phase": "PREPARED",
            "productionWriteAuthorized": False,
        }
    )
    save(path, journal)
    return journal


def close_route(name: str, journal: JsonObject) -> None:
    service = read("service", name)
    expected = journal.object("services").object(name)
    held = annotations(service).get(LEASE)
    selector = dict(service.object("spec").strings("selector"))
    access = selector.pop(ACCESS, None)
    if (
        service.object("metadata").string("uid") != expected.string("uid")
        or selector != expected.strings("selector")
        or held not in (None, journal.string("requestId"))
        or access not in (None, "closed")
        or ((held is None) != (access is None))
    ):
        raise ValueError("Route changed or belongs to another restoration request")
    if held is not None:
        return
    updated = dict(annotations(service))
    updated[LEASE] = journal.string("requestId")
    if name == SERVER:
        updated[WAKE] = "false"
    patch(
        "service",
        name,
        service,
        [
            {"op": "add", "path": "/metadata/annotations", "value": updated},
            {"op": "add", "path": "/spec/selector/" + pointer(ACCESS), "value": "closed"},
        ],
    )


def assert_closed(journal: JsonObject) -> None:
    for name in SERVICES:
        service = read("service", name)
        expected = journal.object("services").object(name)
        if (
            service.object("metadata").string("uid") != expected.string("uid")
            or annotations(service).get(LEASE) != journal.string("requestId")
            or service.object("spec").strings("selector") != {**expected.strings("selector"), ACCESS: "closed"}
            or (name == SERVER and annotations(service).get(WAKE) != "false")
        ):
            raise ValueError("A public Storm route is open or no longer request-owned")
    pods = JsonObject.parse(run(["-n", NAMESPACE, "get", "pods", "-o", "json"])).objects("items")
    if any(pod.object("metadata").strings("labels", {}).get(ACCESS) == "closed" for pod in pods):
        raise ValueError("A pod matches the closed public route selector")


def assert_rollback_template(server: JsonObject, journal: JsonObject) -> None:
    if server_image(server) != journal.string("rollbackImage"):
        raise ValueError("Server image changed before the rollback capture")
    if server.object("spec").object("template") != journal.object("rollbackTemplate"):
        raise ValueError("Server pod template changed before the rollback capture")


def acquire(path: Path, journal: JsonObject) -> None:
    claim = read("pvc", CLAIM)
    volume = read("pv", journal.string("volumeName"), "")
    if (
        claim.object("metadata").string("uid") != journal.string("claimUid")
        or claim.object("spec").string("volumeName") != journal.string("volumeName")
        or volume.object("metadata").string("uid") != journal.string("volumeUid")
        or volume_source(volume) != journal.strings("volumeSource")
    ):
        raise ValueError("Storm data claim was replaced during maintenance")
    server = read("statefulset", SERVER)
    assert_owner(server, journal, allow_unheld=True)
    if annotations(server).get(LEASE) is None:
        assert_rollback_template(server, journal)
    if journal["phase"] == "PREPARED":
        if server.object("spec").integer("replicas") != 0:
            assert_empty()
        journal["phase"] = "CLOSING_ADMISSION"
        save(path, journal)
    if journal["phase"] == "CLOSING_ADMISSION":
        for name in SERVICES:
            close_route(name, journal)
        assert_closed(journal)
        journal["phase"] = "ADMISSION_CLOSED"
        save(path, journal)
    if journal["phase"] == "ADMISSION_CLOSED":
        assert_closed(journal)
        server = read("statefulset", SERVER)
        assert_owner(server, journal, allow_unheld=True)
        if annotations(server).get(LEASE) is None:
            assert_rollback_template(server, journal)
        if server.object("spec").integer("replicas") != 0:
            assert_empty()
            patch("statefulset", SERVER, server, [{"op": "add", "path": "/spec/replicas", "value": 0}])
        # Waiting does not force-delete Paper; its normal grace period drains and saves.
        if run(["-n", NAMESPACE, "get", "pod", SERVER + "-0", "--ignore-not-found", "-o", "json"]).strip():
            run(["-n", NAMESPACE, "wait", "--for=delete", "pod/" + SERVER + "-0", "--timeout=180s"], 190)
        server = read("statefulset", SERVER)
        assert_owner(server, journal, allow_unheld=True)
        if annotations(server).get(LEASE) is None:
            assert_rollback_template(server, journal)
        if server.object("spec").integer("replicas") != 0 or server.object("status", {}).get("replicas", 0) != 0:
            raise ValueError("Server has not finished stopping")
        pods = JsonObject.parse(run(["-n", NAMESPACE, "get", "pods", "-o", "json"])).objects("items")
        if any(
            volume.object("persistentVolumeClaim", {}).get("claimName") == CLAIM
            for pod in pods
            for volume in pod.object("spec").objects("volumes", [])
            if pod.object("status", {}).get("phase") not in ("Succeeded", "Failed")
        ):
            raise ValueError("Another pod still mounts the Storm data claim")
        updated = dict(annotations(server))
        updated.update({LEASE: journal.string("requestId"), PHASE: "OFFLINE", IMAGE: journal.string("candidateImage")})
        patch("statefulset", SERVER, server, [{"op": "add", "path": "/metadata/annotations", "value": updated}])
        journal["phase"] = "LEASED_OFFLINE"
        save(path, journal)
    if journal.string("phase") != "LEASED_OFFLINE":
        raise ValueError("Unexpected maintenance phase")
    assert_closed(journal)
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    if (
        server.object("spec").integer("replicas") != 0
        or annotations(server).get(PHASE) != "OFFLINE"
        or annotations(server).get(IMAGE) != journal.string("candidateImage")
    ):
        raise ValueError("Restoration is not holding the server offline")
    # These requests never mutate the server. A reconciled policy alone is not
    # proof that both Kubernetes update paths actually refuse a wake request.
    assert_denied(
        [
            "patch",
            "statefulset",
            SERVER,
            "--dry-run=server",
            "--type=json",
            "-p",
            json.dumps([{"op": "replace", "path": "/spec/replicas", "value": 1}]),
        ],
        "World restoration holds the server offline",
    )
    assert_denied(
        ["scale", "statefulset/" + SERVER, "--replicas=1", "--dry-run=server"],
        "World restoration blocks scale requests",
    )
    assert_denied(
        ["delete", "statefulset", SERVER, "--dry-run=server", "--wait=false"],
        "Release the restoration lease before deleting its StatefulSet",
    )
    assert_denied(
        [
            "patch",
            "statefulset",
            SERVER,
            "--dry-run=server",
            "--type=json",
            "-p",
            json.dumps(
                [
                    {"op": "add", "path": "/spec/template/metadata/labels/" + pointer(ACCESS), "value": "closed"},
                    {"op": "replace", "path": "/metadata/annotations/" + pointer(PHASE), "value": "VALIDATING"},
                    {
                        "op": "replace",
                        "path": "/spec/template/spec/containers/0/image",
                        "value": journal.string("candidateImage"),
                    },
                    {"op": "replace", "path": "/spec/replicas", "value": 1},
                ]
            ),
        ],
        "Restoration pod templates must omit the closed public route label",
    )
    for name in SERVICES:
        assert_denied(
            [
                "patch",
                "service",
                name,
                "--dry-run=server",
                "--type=json",
                "-p",
                json.dumps([{"op": "remove", "path": "/spec/selector/" + pointer(ACCESS)}]),
            ],
            "Keep restoration Services closed under the parent lease owner",
        )
        assert_denied(
            ["delete", "service", name, "--dry-run=server", "--wait=false"],
            "Release the restoration lease before deleting its Service",
        )
    journal["admissionProbes"] = "UPDATE_SCALE_AND_DELETE_DENIED"
    journal["serviceAdmissionProbes"] = "ALL_FOUR_UPDATE_AND_DELETE_DENIED"
    save(path, journal)


def require_offline(journal: JsonObject, readers: bool = False, writer: bool = False) -> None:
    if readers and writer:
        raise ValueError("Remove source-volume readers before allowing the installation writer")
    assert_closed(journal)
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    claim = read("pvc", CLAIM)
    volume = read("pv", journal.string("volumeName"), "")
    if (
        journal.string("phase") != "LEASED_OFFLINE"
        or journal.get("admissionProbes") != "UPDATE_SCALE_AND_DELETE_DENIED"
        or server.object("spec").integer("replicas") != 0
        or server.object("status", {}).get("replicas", 0) != 0
        or annotations(server).get(PHASE) != "OFFLINE"
        or annotations(server).get(IMAGE) != journal.string("candidateImage")
        or claim.object("metadata").string("uid") != journal.string("claimUid")
        or claim.object("spec").string("volumeName") != journal.string("volumeName")
        or volume.object("metadata").string("uid") != journal.string("volumeUid")
        or volume_source(volume) != journal.strings("volumeSource")
    ):
        raise ValueError("Backup requires the original request-owned stopped Storm volume")
    pods = JsonObject.parse(run(["-n", NAMESPACE, "get", "pods", "-o", "json"])).objects("items")
    for pod in pods:
        if pod.object("status", {}).get("phase") in ("Succeeded", "Failed"):
            continue
        if any(
            volume.object("persistentVolumeClaim", {}).get("claimName") == CLAIM
            for volume in pod.object("spec").objects("volumes", [])
        ):
            if writer:
                assert_writer(pod, journal)
                continue
            if not readers:
                raise ValueError("A pod still mounts the stopped source volume")
            assert_reader(pod, journal, NAMESPACE)


def backup(path: Path, journal: JsonObject) -> JsonObject:
    require_offline(journal)
    claims = JsonObject.parse(
        run(["-n", NAMESPACE, "get", "pvc", "-l", "velero.io/backup=enabled", "-o", "json"])
    ).objects("items")
    if [(claim.object("metadata").string("name"), claim.object("metadata").string("uid")) for claim in claims] != [
        (CLAIM, journal.string("claimUid"))
    ]:
        raise ValueError("Velero selection does not identify only the recorded Storm claim")
    name = "storm-world-" + journal.string("requestId")
    resource = ensure_resource(
        {
            "apiVersion": "velero.io/v1",
            "kind": "Backup",
            "metadata": {"name": name, "namespace": "velero", "labels": {LEASE: journal.string("requestId")}},
            "spec": {
                "includedNamespaces": [NAMESPACE],
                "includedResources": ["persistentvolumeclaims", "persistentvolumes"],
                "labelSelector": {"matchLabels": {"velero.io/backup": "enabled"}},
                "snapshotVolumes": True,
                "storageLocation": "default",
                "ttl": "720h",
                "volumeSnapshotLocations": ["zfspv-incr"],
            },
        }
    )
    prior = journal.object("backup", {})
    if prior.get("uid", resource.object("metadata").string("uid")) != resource.object("metadata").string("uid"):
        raise ValueError("Recorded rollback backup was replaced")
    status = resource.object("status", {})
    journal["backup"] = {
        "name": name,
        "uid": resource.object("metadata").string("uid"),
        "phase": status.get("phase", "New"),
        "warnings": status.get("warnings", 0),
    }
    save(path, journal)
    if status.get("phase") in ("Failed", "PartiallyFailed", "FailedValidation") or status.get("errors", 0):
        raise ValueError("Rollback backup failed; admission remains closed")
    if status.get("phase") == "Completed" and (
        status.get("volumeSnapshotsAttempted") != 1
        or status.get("volumeSnapshotsCompleted") != 1
        or not status.get("completionTimestamp")
    ):
        raise ValueError("Rollback backup did not complete exactly one volume snapshot")
    return resource


def restore_backup(path: Path, journal: JsonObject) -> None:
    resource = backup(path, journal)
    if resource.object("status", {}).get("phase") != "Completed":
        raise ValueError("Wait for the owned backup to complete before restoring it")
    ensure_resource(
        {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {"name": RESTORED_NAMESPACE, "labels": {LEASE: journal.string("requestId")}},
        }
    )
    name = "storm-verify-" + journal.string("requestId")
    restored = ensure_resource(
        {
            "apiVersion": "velero.io/v1",
            "kind": "Restore",
            "metadata": {"name": name, "namespace": "velero", "labels": {LEASE: journal.string("requestId")}},
            "spec": {
                "backupName": resource.object("metadata").string("name"),
                "includedNamespaces": [NAMESPACE],
                "includedResources": ["persistentvolumeclaims", "persistentvolumes"],
                "namespaceMapping": {NAMESPACE: RESTORED_NAMESPACE},
                "restorePVs": True,
            },
        }
    )
    prior = journal.object("restore", {})
    if prior.get("uid", restored.object("metadata").string("uid")) != restored.object("metadata").string("uid"):
        raise ValueError("Recorded independent restore was replaced")
    status = restored.object("status", {})
    if prior.get("phase") == "Completed" and status.get("phase") != "Completed":
        raise ValueError("Recorded independent restore is no longer completed")
    journal["restore"] = {
        "name": name,
        "uid": restored.object("metadata").string("uid"),
        "namespace": RESTORED_NAMESPACE,
        "phase": status.get("phase", "New"),
        "byteVerification": prior.get("byteVerification", "PENDING"),
        "warnings": status.get("warnings", 0),
        **{
            key: prior[key]
            for key in ("proofPath", "proofSha256", "files", "claimUid", "volumeName", "volumeUid", "volumeSource")
            if key in prior
        },
    }
    save(path, journal)
    if status.get("phase") in ("Failed", "PartiallyFailed", "FailedValidation") or status.get("errors", 0):
        raise ValueError("Independent restore failed; admission remains closed")
    if status.get("phase") == "Completed":
        claim = read("pvc", CLAIM, RESTORED_NAMESPACE)
        if (
            claim.object("status").get("phase") != "Bound"
            or claim.object("metadata")["uid"] == journal.string("claimUid")
            or claim.object("spec")["volumeName"] == journal.string("volumeName")
        ):
            raise ValueError("Restore does not have a distinct bound claim and volume")
        volume = read("pv", claim.object("spec").string("volumeName"), "")
        if (
            volume.object("metadata")["uid"] == journal.string("volumeUid")
            or volume.object("spec").object("csi").string("driver") != journal.strings("volumeSource")["driver"]
            or volume.object("spec").object("csi")["volumeHandle"] == journal.strings("volumeSource")["volumeHandle"]
        ):
            raise ValueError("Restored volume does not identify independent native storage")
        identities = {
            "claimUid": claim.object("metadata").string("uid"),
            "volumeName": claim.object("spec").string("volumeName"),
            "volumeUid": volume.object("metadata").string("uid"),
            "volumeSource": volume_source(volume),
        }
        if any(key in prior and prior[key] != value for key, value in identities.items()):
            raise ValueError("Previously recorded independent restore storage was replaced")
        journal.object("restore").update(identities)
        save(path, journal)


def reader_manifest(journal: JsonObject, namespace: str) -> JsonObject:
    if namespace not in (NAMESPACE, RESTORED_NAMESPACE):
        raise ValueError("Reader namespace is outside the two recorded Storm volumes")
    return JsonObject(
        {
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": "storm-verify-reader-" + journal.string("requestId"),
                "namespace": namespace,
                "labels": {LEASE: journal.string("requestId")},
            },
            "spec": {
                "restartPolicy": "Never",
                "automountServiceAccountToken": False,
                "enableServiceLinks": False,
                "terminationGracePeriodSeconds": 10,
                "containers": [
                    {
                        "name": "reader",
                        "image": journal.string("rollbackImage"),
                        "command": ["sleep", "infinity"],
                        "securityContext": {
                            "runAsUser": 1000,
                            "runAsGroup": 2000,
                            "readOnlyRootFilesystem": True,
                            "allowPrivilegeEscalation": False,
                            "capabilities": {"drop": ["ALL"]},
                        },
                        "resources": {
                            "requests": {"cpu": "50m", "memory": "64Mi"},
                            "limits": {"cpu": "1", "memory": "256Mi"},
                        },
                        "volumeMounts": [{"name": "data", "mountPath": "/data", "readOnly": True}],
                    }
                ],
                "volumes": [{"name": "data", "persistentVolumeClaim": {"claimName": CLAIM, "readOnly": True}}],
            },
        }
    )


def unsafe_helper(pod: JsonObject, expected: JsonObject, write: bool = False) -> bool:
    spec = pod.object("spec")
    if any(spec.get(key) for key in ("hostNetwork", "hostPID", "hostIPC", "shareProcessNamespace")):
        return True
    defaulted = {"imagePullPolicy", "terminationMessagePath", "terminationMessagePolicy"}
    declared = set(expected.object("spec").objects("containers")[0])
    for container in spec.objects("containers"):
        security = container.object("securityContext", {})
        if (
            set(container) - declared - defaulted
            or security.get("privileged")
            or security.get("procMount", "Default") != "Default"
            or (not write and security.object("capabilities", {}).get("add"))
        ):
            return True
    return False


def assert_reader(pod: JsonObject, journal: JsonObject, namespace: str) -> None:
    expected = reader_manifest(journal, namespace)
    recorded = journal.strings("readers", {}).get(namespace)
    if (
        pod.object("metadata").get("name") != expected.object("metadata").string("name")
        or pod.object("metadata").get("namespace") != namespace
        or pod.object("metadata").strings("labels", {}).get(LEASE) != journal.string("requestId")
        or not includes(pod.object("spec"), expected.object("spec"))
        or pod.object("spec").get("initContainers")
        or pod.object("spec").get("ephemeralContainers")
        or unsafe_helper(pod, expected)
        or any(
            container.get("env") or container.get("envFrom") for container in pod.object("spec").objects("containers")
        )
        or (recorded is not None and recorded != pod.object("metadata").string("uid"))
    ):
        raise ValueError("Volume reader is not the exact request-owned read-only pod")


def writer_manifest(journal: JsonObject) -> JsonObject:
    """A dormant, request-owned maintenance helper; never starts Paper or receives runtime credentials."""
    manifest = reader_manifest(journal, NAMESPACE)
    manifest.object("metadata")["name"] = "storm-install-writer-" + journal.string("requestId")
    spec = manifest.object("spec")
    container = spec.objects("containers")[0]
    container["name"] = "writer"
    container["image"] = journal.string("candidateImage")
    # The verified volume contains both UID 1000 and UID 0 files. Metadata
    # restoration requires these limited filesystem capabilities. The helper
    # carries no ServiceAccount token, environment credentials or server process.
    container.object("securityContext").update(
        runAsUser=0,
        runAsGroup=2000,
        capabilities={"drop": ["ALL"], "add": ["CHOWN", "DAC_OVERRIDE", "FOWNER"]},
    )
    container["resources"] = {
        "requests": {"cpu": "100m", "memory": "128Mi", "ephemeral-storage": "32Gi"},
        "limits": {"cpu": "2", "memory": "512Mi", "ephemeral-storage": "40Gi"},
    }
    container["volumeMounts"] = [
        # Kubernetes omits false volumeMount.readOnly values in pod readbacks.
        {"name": "data", "mountPath": "/data"},
        {"name": "scratch", "mountPath": "/scratch"},
        {"name": "temporary", "mountPath": "/tmp"},
    ]
    spec["volumes"] = [
        {"name": "data", "persistentVolumeClaim": {"claimName": CLAIM}},
        {"name": "scratch", "emptyDir": {"sizeLimit": "32Gi"}},
        {"name": "temporary", "emptyDir": {"sizeLimit": "64Mi"}},
    ]
    return manifest


def assert_writer(pod: JsonObject, journal: JsonObject) -> None:
    expected = writer_manifest(journal)
    if (
        pod.object("metadata").get("name") != expected.object("metadata").string("name")
        or pod.object("metadata").get("namespace") != NAMESPACE
        or pod.object("metadata").strings("labels", {}).get(LEASE) != journal.string("requestId")
        or not includes(pod.object("spec"), expected.object("spec"))
        or pod.object("spec").get("initContainers")
        or pod.object("spec").get("ephemeralContainers")
        or unsafe_helper(pod, expected, write=True)
        or any(
            mount.get("readOnly", False) is not False
            for container in pod.object("spec").objects("containers")
            for mount in container.objects("volumeMounts")
        )
        or any(
            volume.object("persistentVolumeClaim", {}).get("readOnly", False) is not False
            for volume in pod.object("spec").objects("volumes")
        )
        or any(
            container.get("env") or container.get("envFrom") for container in pod.object("spec").objects("containers")
        )
        or journal.get("writerUid") != pod.object("metadata").string("uid")
    ):
        raise ValueError("Installation writer differs from the exact credential-free request-owned helper")


def tar_fingerprint(stream: IO[bytes]) -> dict[str, str]:
    """Hash a volume stream without extracting or retaining any file contents."""
    result, seen = {}, set()
    with tarfile.open(fileobj=stream, mode="r|") as archive:
        for member in archive:
            relative = PurePosixPath(member.name)
            if relative.is_absolute() or ".." in relative.parts or member.issym() or member.islnk():
                raise ValueError("Volume contains an unsafe path or a linked file")
            name = str(relative)
            if name in seen:
                raise ValueError("Volume stream contains duplicate paths")
            seen.add(name)
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("Volume contains an unsupported non-regular file")
            if relative.name == "session.lock":
                continue
            checksum = hashlib.sha256()
            contents = archive.extractfile(member)
            if contents is None:
                raise ValueError("Regular volume file has no readable contents")
            with contents:
                while block := contents.read(1024 * 1024):
                    checksum.update(block)
            result[name] = checksum.hexdigest()
    if not {"world/level.dat", "plugins/TheStorm/the-storm.db"}.issubset(result):
        raise ValueError("Volume stream does not include the expected Storm world and database")
    return result


def remote_fingerprint(journal: JsonObject, namespace: str, exclude_workspace: bool = False) -> dict[str, str]:
    name = reader_manifest(journal, namespace).object("metadata").string("name")
    assert_reader(read("pod", name, namespace), journal, namespace)
    with subprocess.Popen(
        [
            "kubectl",
            "--context",
            CONTEXT,
            "--request-timeout=30m",
            "-n",
            namespace,
            "exec",
            name,
            "-c",
            "reader",
            "--",
            "tar",
            *(["--exclude=./" + restoration_files.WORKSPACE] if exclude_workspace else []),
            "-C",
            "/data",
            "-cf",
            "-",
            ".",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as process:
        if process.stdout is None:
            raise RuntimeError("Volume reader has no output pipe")
        deadline = threading.Timer(1800, process.kill)
        deadline.start()
        try:
            result = tar_fingerprint(process.stdout)
            # Consume tar padding so kubectl can close its output without a broken pipe.
            while process.stdout.read(1024 * 1024):
                pass
            if process.wait(timeout=30) != 0:
                raise RuntimeError("Volume read failed or exceeded its deadline; no file contents were saved")
            return result
        finally:
            deadline.cancel()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=30)


def require_restore(journal: JsonObject) -> None:
    proof = journal.object("restore", {})
    if proof.get("phase") != "Completed" or not proof.get("volumeUid"):
        raise ValueError("Verification requires a completed independent rollback restore")
    claim = read("pvc", CLAIM, RESTORED_NAMESPACE)
    volume = read("pv", proof.string("volumeName"), "")
    if (
        claim.object("metadata").string("uid") != proof.string("claimUid")
        or claim.object("status").get("phase") != "Bound"
        or claim.object("spec").string("volumeName") != proof.string("volumeName")
        or volume.object("metadata").string("uid") != proof.string("volumeUid")
        or volume_source(volume) != proof.strings("volumeSource")
        or proof.strings("volumeSource")["volumeHandle"] == journal.strings("volumeSource")["volumeHandle"]
    ):
        raise ValueError("The independently restored storage was replaced or aliases the source")
    pods = JsonObject.parse(run(["-n", RESTORED_NAMESPACE, "get", "pods", "-o", "json"])).objects("items")
    for pod in pods:
        if pod.object("status", {}).get("phase") not in ("Succeeded", "Failed") and any(
            volume.object("persistentVolumeClaim", {}).get("claimName") == CLAIM
            for volume in pod.object("spec").objects("volumes", [])
        ):
            assert_reader(pod, journal, RESTORED_NAMESPACE)


def verify_backup(path: Path, journal: JsonObject) -> None:
    require_offline(journal, readers=True)
    require_restore(journal)
    for namespace in (NAMESPACE, RESTORED_NAMESPACE):
        pod = ensure_resource(reader_manifest(journal, namespace))
        assert_reader(pod, journal, namespace)
        journal.strings("readers", {})[namespace] = pod.object("metadata").string("uid")
        save(path, journal)
        run(
            [
                "-n",
                namespace,
                "wait",
                "--for=condition=Ready",
                "pod/" + pod.object("metadata").string("name"),
                "--timeout=45s",
            ],
            50,
        )
    require_offline(journal, readers=True)
    require_restore(journal)
    original = remote_fingerprint(journal, NAMESPACE)
    restored = remote_fingerprint(journal, RESTORED_NAMESPACE)
    require_offline(journal, readers=True)
    require_restore(journal)
    if original != restored:
        journal.object("restore")["byteVerification"] = "FAILED"
        save(path, journal)
        raise ValueError("The independently restored whole volume differs from its stopped source")
    proof = path.with_name(path.name + ".backup-files.json")
    if proof.is_symlink():
        raise ValueError("Backup proof cannot be a symlink")
    if proof.exists():
        existing = JsonObject.parse(proof.read_text(encoding="utf-8"))
        if existing.get("requestId") != journal.string("requestId") or existing.get("files") != original:
            raise ValueError("The existing whole-volume proof changed or belongs to another request")
    save(
        proof,
        {
            "schemaVersion": 1,
            "status": "VERIFIED",
            "requestId": journal.string("requestId"),
            "backupUid": journal.object("backup").string("uid"),
            "sourceVolumeUid": journal.string("volumeUid"),
            "restoredVolumeUid": journal.object("restore").string("volumeUid"),
            "files": original,
        },
    )
    journal.object("restore").update(
        byteVerification="VERIFIED",
        proofPath=str(proof.resolve()),
        proofSha256=hashlib.sha256(proof.read_bytes()).hexdigest(),
        files=len(original),
    )
    save(path, journal)


def export_stream(stream: IO[bytes], destination: Path, expected: dict[str, str]) -> None:
    """Extract only requested regular files into a new private directory, checking every hash."""
    seen = set()
    with tarfile.open(fileobj=stream, mode="r|") as archive:
        for member in archive:
            relative = PurePosixPath(member.name)
            name = str(relative)
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or name != member.name
                or name not in expected
                or name in seen
                or not member.isfile()
                or member.size < 0
                or member.size > 2 * 1024**3
            ):
                raise ValueError("Export stream contains an unexpected, duplicate or unsafe file")
            if shutil.disk_usage(destination).free < member.size + 128 * 1024**2:
                raise ValueError("Insufficient local capacity for the verified native data export")
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            checksum = hashlib.sha256()
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            contents = archive.extractfile(member)
            if contents is None:
                os.close(descriptor)
                raise ValueError("Regular export file has no readable contents")
            with os.fdopen(descriptor, "wb") as output, contents:
                while block := contents.read(1024 * 1024):
                    checksum.update(block)
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            if checksum.hexdigest() != expected[name]:
                raise ValueError("Export file differs from the independently verified rollback volume")
            seen.add(name)
    if seen != set(expected):
        raise ValueError("Export stream omitted required native data files")


def remote_export(journal: JsonObject, destination: Path, expected: dict[str, str]) -> None:
    name = reader_manifest(journal, RESTORED_NAMESPACE).object("metadata").string("name")
    assert_reader(read("pod", name, RESTORED_NAMESPACE), journal, RESTORED_NAMESPACE)
    with tempfile.TemporaryFile() as names:
        names.write(b"".join(name.encode("utf-8") + b"\0" for name in expected))
        names.seek(0)
        with subprocess.Popen(
            [
                "kubectl",
                "--context",
                CONTEXT,
                "--request-timeout=30m",
                "-n",
                RESTORED_NAMESPACE,
                "exec",
                "-i",
                name,
                "-c",
                "reader",
                "--",
                "tar",
                "-C",
                "/data",
                "-cf",
                "-",
                "--null",
                "--verbatim-files-from",
                "-T",
                "-",
            ],
            stdin=names,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ) as process:
            if process.stdout is None:
                raise RuntimeError("Export reader has no output pipe")
            deadline = threading.Timer(1800, process.kill)
            deadline.start()
            try:
                export_stream(process.stdout, destination, expected)
                while process.stdout.read(1024 * 1024):
                    pass
                if process.wait(timeout=30) != 0:
                    raise RuntimeError("Native data export failed or exceeded its deadline")
            finally:
                deadline.cancel()
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=30)


def export_backup(path: Path, journal: JsonObject, destination: Path, proof_path: Path) -> None:
    require_offline(journal, readers=True)
    require_restore(journal)
    restored = journal.object("restore")
    if restored.get("byteVerification") != "VERIFIED":
        raise ValueError("Export requires whole-volume byte verification")
    source = backup_contract.whole_proof(Path(restored.string("proofPath")), restored.string("proofSha256"))
    if any(
        (
            source[key] != value
            for key, value in {
                "requestId": journal.string("requestId"),
                "backupUid": journal.object("backup").string("uid"),
                "sourceVolumeUid": journal.string("volumeUid"),
                "restoredVolumeUid": restored.string("volumeUid"),
            }.items()
        )
    ):
        raise ValueError("Whole-volume proof belongs to different recorded storage")
    expected = backup_contract.selected_files(source["files"])
    if destination.is_symlink() or proof_path.is_symlink():
        raise ValueError("Native data export paths cannot be symlinks")
    destination, proof_path = destination.resolve(), proof_path.resolve()
    if (
        destination.exists()
        or proof_path.exists()
        or not destination.parent.is_dir()
        or not proof_path.parent.is_dir()
        or proof_path.is_relative_to(destination)
        or path.resolve().is_relative_to(destination)
        or Path(restored.string("proofPath")).resolve().is_relative_to(destination)
    ):
        raise ValueError("Export requires a new directory and separate private receipt paths")
    destination.mkdir(mode=0o700)
    journal["export"] = {"phase": "COPYING", "destination": str(destination), "proofPath": str(proof_path)}
    save(path, journal)
    try:
        remote_export(journal, destination, expected)
        require_offline(journal, readers=True)
        require_restore(journal)
        # Recheck the sealed hash proof before publishing the export receipt.
        backup_contract.whole_proof(Path(restored.string("proofPath")), restored.string("proofSha256"))
        save(
            proof_path,
            {
                "schemaVersion": 2,
                "status": "VERIFIED_EXPORT",
                **{key: source[key] for key in ("requestId", "backupUid", "sourceVolumeUid", "restoredVolumeUid")},
                "wholeVolumeProofPath": restored.string("proofPath"),
                "wholeVolumeProofSha256": restored.string("proofSha256"),
                "files": expected,
            },
        )
        journal.object("export").update(
            phase="VERIFIED", proofSha256=hashlib.sha256(proof_path.read_bytes()).hexdigest(), files=len(expected)
        )
        save(path, journal)
    except BaseException:
        journal.object("export")["phase"] = "FAILED"
        save(path, journal)
        raise


def remove_readers(path: Path, journal: JsonObject) -> None:
    """Remove only the recorded read-only helpers, with API-side identity preconditions."""
    require_offline(journal, readers=True)
    for namespace, identity in journal.strings("readers", {}).items():
        name = reader_manifest(journal, namespace).object("metadata").string("name")
        existing = run(["-n", namespace, "get", "pod", name, "--ignore-not-found", "-o", "json"]).strip()
        if not existing:
            continue
        pod = JsonObject.parse(existing)
        assert_reader(pod, journal, namespace)
        if pod.object("metadata").string("uid") != identity:
            raise ValueError("Reader identity changed before cleanup")
        completed = subprocess.run(
            [
                "kubectl",
                "--context",
                CONTEXT,
                "delete",
                "--raw",
                f"/api/v1/namespaces/{namespace}/pods/{name}",
                "-f",
                "-",
            ],
            input=json.dumps(
                {
                    "apiVersion": "v1",
                    "kind": "DeleteOptions",
                    "preconditions": {
                        "uid": identity,
                        "resourceVersion": pod.object("metadata").string("resourceVersion"),
                    },
                }
            ),
            text=True,
            capture_output=True,
            timeout=30,
        )
        if completed.returncode:
            raise RuntimeError("Owned reader deletion failed; admission remains closed")
        run(["-n", namespace, "wait", "--for=delete", "pod/" + name, "--timeout=45s"], 50)
    require_offline(journal)
    journal["readersRemoved"] = True
    save(path, journal)


def recover_writer_identity(path: Path, journal: JsonObject, existing: str | None = None) -> None:
    """Recover custody of an already authorized helper before checking stopped mounts."""
    if journal.get("writerUid") is not None or journal.get("writerCreationPending") is not True:
        return
    if journal.get("productionWriteAuthorized") is not True:
        raise ValueError("Pending writer recovery requires recorded production write authorization")
    if existing is None:
        name = writer_manifest(journal).object("metadata").string("name")
        existing = run(["-n", NAMESPACE, "get", "pod", name, "--ignore-not-found", "-o", "json"]).strip()
    if not existing:
        return
    pod = JsonObject.parse(existing)
    proposed = JsonObject({**journal, "writerUid": pod.object("metadata").string("uid")})
    assert_writer(pod, proposed)
    require_offline(proposed, writer=True)
    journal["writerUid"] = proposed.string("writerUid")
    save(path, journal)


def create_writer(path: Path, journal: JsonObject) -> JsonObject:
    # A writer can run either installation or whole-volume recovery. Revoke
    # the old installation before granting write access, even if the writer
    # exits without reporting which transaction it completed.
    journal["productionWriteAuthorized"] = True
    if "installation" in journal:
        journal.object("installation")["phase"] = "WRITE_PENDING"
    for key in ("acceptance", "stoppingIncarnation", "stoppedIncarnation", "rollbackVerification"):
        journal.pop(key, None)
    save(path, journal)
    name = writer_manifest(journal).object("metadata").string("name")
    existing = run(["-n", NAMESPACE, "get", "pod", name, "--ignore-not-found", "-o", "json"]).strip()
    recover_writer_identity(path, journal, existing)
    require_offline(journal, writer=bool(journal.get("writerUid")))
    if journal.get("writerRemoved") is True:
        if existing:
            raise ValueError("A removed writer name is occupied; inspect its identity before recreation")
        journal["previousWriterUid"] = journal.pop("writerUid")
        journal["writerRemoved"] = False
    journal["writerCreationPending"] = True
    save(path, journal)
    pod = ensure_resource(writer_manifest(journal))
    identity = pod.object("metadata").string("uid")
    if journal.get("writerUid") not in (None, identity):
        raise ValueError("Installation writer was replaced")
    journal["writerUid"] = identity
    journal["writerRemoved"] = False
    journal["writerCreationPending"] = False
    save(path, journal)
    assert_writer(pod, journal)
    run(
        [
            "-n",
            NAMESPACE,
            "wait",
            "--for=condition=Ready",
            "pod/" + pod.object("metadata").string("name"),
            "--timeout=45s",
        ],
        50,
    )
    require_offline(journal, writer=True)
    return pod


def upload_installation(journal: JsonObject, plan: JsonObject, *, resources: bool = False) -> None:
    """Stream only approved world/identity files and operator code into bounded scratch storage."""
    name = writer_manifest(journal).object("metadata").string("name")
    expected = (
        restoration_resources.validate_files(plan.strings("installationFiles"))
        if resources
        else restoration_files.installation_manifest(plan.strings("installationFiles"))
    )
    layout = Path(plan.string("layout"))
    owned = Path(__file__).resolve().parent
    process = subprocess.Popen(
        [
            "kubectl",
            "--context",
            CONTEXT,
            "-n",
            NAMESPACE,
            "exec",
            "-i",
            name,
            "-c",
            "writer",
            "--",
            "tar",
            "-xf",
            "-",
            "-C",
            "/scratch",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        if process.stdin is None:
            raise RuntimeError("Installation upload stream is unavailable")
        with tarfile.open(fileobj=process.stdin, mode="w|") as archive:
            for relative, checksum in expected.items():
                source = layout / relative
                if source.is_symlink() or not source.is_file() or restoration_files.digest(source) != checksum:
                    raise ValueError("Prepared installation changed before upload")
                archive.add(source, arcname="payload/" + relative, recursive=False)
            for script in (
                "restoration_install.py",
                "restoration_files.py",
                "restoration_revision.py",
                "restoration_json.py",
                "restoration_resources.py",
            ):
                source = owned / script
                if source.is_symlink() or not source.is_file():
                    raise ValueError("Operator installation code must be regular files")
                archive.add(source, arcname="operator/" + script, recursive=False)
            encoded = json.dumps(plan).encode("utf-8")
            entry = tarfile.TarInfo("plan.json")
            entry.mode = 0o600
            entry.size = len(encoded)
            archive.addfile(entry, io.BytesIO(encoded))
        process.stdin.close()
        process.stdin = None
        _, errors = process.communicate(timeout=90)
        if process.returncode:
            raise RuntimeError("Private installation upload failed: " + errors.decode("utf-8", errors="replace"))
    except BaseException:
        process.kill()
        process.wait()
        raise


def revise_installation(path: Path, journal: JsonObject, staging: Path, candidate: Path, image: str) -> None:
    """Rebind an unstarted, stopped installation to a new sealed plan under the same lease."""
    if not re.fullmatch(r"ghcr\.io/shepherdjerred/the-storm-server:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}", image):
        raise ValueError("Revision requires an immutable replacement image")
    if journal.get("privateStartup") is not None or journal.get("acceptance") is not None:
        raise ValueError("An installation that has started requires whole-volume rollback")
    revision = journal.object("installationRevision", {})
    if not revision:
        require_offline(journal)
        require_restore(journal)
        if journal.object("installation").get("phase") != "INSTALLED" or journal.get("writerRemoved") is not True:
            raise ValueError("Revision requires a completed unstarted installation and removed writer")
        proposed = JsonObject({**journal, "candidateImage": image})
        plan = restoration_activation.plan(staging, proposed, candidate)
        if plan.get("overworldOverlay") is not False:
            raise ValueError("Pristine archive revision refuses an overworld arena overlay")
        old = journal.object("installationPlan")
        plan["revisionOf"] = {key: old[key] for key in ("candidateImage", "candidateJarSha256", "installationFiles")}
        revision = JsonObject(
            {
                "phase": "PREPARED",
                "previousImage": journal.string("candidateImage"),
                "previousPlan": old,
                "previousInstallation": JsonObject.parse(json.dumps(journal.object("installation"))),
                "plan": plan,
            }
        )
        journal["installationRevision"] = revision
        journal.object("installation")["phase"] = "REVISION_PENDING"
        save(path, journal)
    plan = revision.object("plan")
    if image != plan.string("candidateImage"):
        raise ValueError("Revision belongs to a different replacement image")
    check = restoration_activation.plan(staging, JsonObject({**journal, "candidateImage": image}), candidate)
    if JsonObject({key: value for key, value in plan.items() if key != "revisionOf"}) != check:
        raise ValueError("Sealed replacement plan changed")
    if check.get("overworldOverlay") is not False:
        raise ValueError("Pristine archive revision refuses an overworld arena overlay")
    server = read("statefulset", SERVER)
    bound = annotations(server).get(IMAGE)
    if bound not in (revision.string("previousImage"), image):
        raise ValueError("Revision maintenance image was changed by another writer")
    actual = JsonObject({**journal, "candidateImage": bound})
    recover_writer_identity(path, actual)
    require_offline(actual, writer=actual.get("writerRemoved") is not True)
    require_restore(journal)
    if bound != image:
        patch(
            "statefulset",
            SERVER,
            server,
            [{"op": "replace", "path": "/metadata/annotations/" + pointer(IMAGE), "value": image}],
        )
    journal.update(actual)
    journal["candidateImage"] = image
    journal["installationPlan"] = plan
    revision["phase"] = "INSTALLING"
    save(path, journal)
    install(path, journal, staging, candidate, plan)
    revision["phase"] = "INSTALLED"
    save(path, journal)


def install(
    path: Path, journal: JsonObject, staging: Path, candidate: Path, revision_plan: JsonObject | None = None
) -> None:
    recover_writer_identity(path, journal)
    require_offline(journal, writer=bool(journal.get("writerUid")))
    require_restore(journal)
    plan = revision_plan if revision_plan is not None else restoration_activation.plan(staging, journal, candidate)
    if journal.get("installationPlan") is not None and journal.object("installationPlan") != plan:
        raise ValueError("Installation inputs changed after the plan was recorded")
    journal["installationPlan"] = plan
    save(path, journal)
    create_writer(path, journal)
    name = writer_manifest(journal).object("metadata").string("name")
    published = run(["-n", NAMESPACE, "exec", name, "-c", "writer", "--", "sha256sum", "/plugins/TheStorm.jar"])
    if published.split()[:1] != [plan.string("candidateJarSha256")]:
        raise ValueError("Published candidate image contains a different gameplay plugin")
    upload_installation(journal, plan)
    require_offline(journal, writer=True)
    result = JsonObject.parse(
        run(
            [
                "-n",
                NAMESPACE,
                "exec",
                name,
                "-c",
                "writer",
                "--",
                "python3",
                "/scratch/operator/restoration_install.py",
                "--plan",
                "/scratch/plan.json",
            ],
            1800,
        )
    )
    if (
        result.get("phase") != "INSTALLED"
        or any(
            result.get(key) != plan.get(key)
            for key in ("requestId", "candidateImage", "candidateJarSha256", "backupUid")
        )
        or result.get("coreProtectEpoch") != journal.string("requestId")
    ):
        raise ValueError("Stopped-volume installation returned mismatched evidence")
    require_offline(journal, writer=True)
    journal["installation"] = result
    save(path, journal)


def remove_writer(path: Path, journal: JsonObject) -> None:
    require_offline(journal, writer=True)
    name = writer_manifest(journal).object("metadata").string("name")
    existing = run(["-n", NAMESPACE, "get", "pod", name, "--ignore-not-found", "-o", "json"]).strip()
    if existing:
        pod = JsonObject.parse(existing)
        assert_writer(pod, journal)
        completed = subprocess.run(
            [
                "kubectl",
                "--context",
                CONTEXT,
                "delete",
                "--raw",
                f"/api/v1/namespaces/{NAMESPACE}/pods/{name}",
                "-f",
                "-",
            ],
            input=json.dumps(
                {
                    "apiVersion": "v1",
                    "kind": "DeleteOptions",
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
            raise RuntimeError("Owned writer deletion failed; admission remains closed")
        run(["-n", NAMESPACE, "wait", "--for=delete", "pod/" + name, "--timeout=45s"], 50)
    require_offline(journal)
    journal["writerRemoved"] = True
    save(path, journal)


def rollback_proof(journal: JsonObject) -> JsonObject:
    restored = journal.object("restore")
    if restored.get("byteVerification") != "VERIFIED":
        raise ValueError("Rollback requires the verified independent whole-volume proof")
    proof = backup_contract.whole_proof(Path(restored.string("proofPath")), restored.string("proofSha256"))
    if any(
        proof.get(key) != expected
        for key, expected in {
            "requestId": journal.string("requestId"),
            "backupUid": journal.object("backup").string("uid"),
            "sourceVolumeUid": journal.string("volumeUid"),
            "restoredVolumeUid": restored.string("volumeUid"),
        }.items()
    ):
        raise ValueError("Rollback proof identifies different storage or request")
    return proof


def upload_rollback_operator(journal: JsonObject, proof: JsonObject) -> None:
    """Upload reviewed operator code and hashes; backup contents never enter this upload."""
    owned = Path(__file__).resolve().parent
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w") as archive:
        for script in ("restoration_rollback.py", "restoration_files.py", "restoration_json.py"):
            source = owned / script
            if source.is_symlink() or not source.is_file():
                raise ValueError("Rollback operator code must be regular files")
            archive.add(source, arcname="operator/" + script, recursive=False)
        encoded = json.dumps(proof).encode("utf-8")
        entry = tarfile.TarInfo("rollback-proof.json")
        entry.mode = 0o600
        entry.size = len(encoded)
        archive.addfile(entry, io.BytesIO(encoded))
    name = writer_manifest(journal).object("metadata").string("name")
    uploaded = subprocess.run(
        [
            "kubectl",
            "--context",
            CONTEXT,
            "-n",
            NAMESPACE,
            "exec",
            "-i",
            name,
            "-c",
            "writer",
            "--",
            "tar",
            "-xf",
            "-",
            "-C",
            "/scratch",
        ],
        input=payload.getvalue(),
        capture_output=True,
        timeout=60,
    )
    if uploaded.returncode:
        raise RuntimeError("Private rollback operator upload failed; admission remains closed")


def rollback_writer_operation(journal: JsonObject, operation: str) -> JsonObject:
    if operation not in ("inspect", "restore"):
        raise ValueError("Unknown rollback writer operation")
    name = writer_manifest(journal).object("metadata").string("name")
    assert_writer(read("pod", name), journal)
    return JsonObject.parse(
        run(
            [
                "-n",
                NAMESPACE,
                "exec",
                name,
                "-c",
                "writer",
                "--",
                "python3",
                "/scratch/operator/restoration_rollback.py",
                operation,
                "--proof",
                "/scratch/rollback-proof.json",
            ],
            1800,
        )
    )


def transfer_rollback(journal: JsonObject) -> None:
    """Pipe the independent restore directly to verified pod scratch, never workstation storage."""
    reader = reader_manifest(journal, RESTORED_NAMESPACE).object("metadata").string("name")
    writer = writer_manifest(journal).object("metadata").string("name")
    assert_reader(read("pod", reader, RESTORED_NAMESPACE), journal, RESTORED_NAMESPACE)
    assert_writer(read("pod", writer), journal)
    kubectl = ["kubectl", "--context", CONTEXT, "--request-timeout=30m"]
    processes: list[subprocess.Popen[bytes]] = []
    deadline = threading.Timer(1800, lambda: [process.kill() for process in processes if process.poll() is None])
    try:
        receiver = subprocess.Popen(
            [
                *kubectl,
                "-n",
                NAMESPACE,
                "exec",
                "-i",
                writer,
                "-c",
                "writer",
                "--",
                "python3",
                "/scratch/operator/restoration_rollback.py",
                "receive",
                "--proof",
                "/scratch/rollback-proof.json",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        processes.append(receiver)
        if receiver.stdin is None:
            raise RuntimeError("Rollback receiver has no private input stream")
        sender = subprocess.Popen(
            [
                *kubectl,
                "-n",
                RESTORED_NAMESPACE,
                "exec",
                reader,
                "-c",
                "reader",
                "--",
                "tar",
                "--numeric-owner",
                "-C",
                "/data",
                "-cf",
                "-",
                ".",
            ],
            stdout=receiver.stdin,
            stderr=subprocess.DEVNULL,
        )
        processes.append(sender)
        receiver.stdin.close()
        receiver.stdin = None
        deadline.start()
        if sender.wait(timeout=1800) != 0 or receiver.wait(timeout=60) != 0:
            raise RuntimeError("Whole-volume rollback transfer failed; admission remains closed")
    finally:
        deadline.cancel()
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=30)


def whole_rollback(path: Path, journal: JsonObject) -> None:
    recover_writer_identity(path, journal)
    require_offline(journal, writer=bool(journal.get("writerUid")))
    require_restore(journal)
    proof = rollback_proof(journal)
    if "installationPlan" not in journal:
        raise ValueError("Whole-volume rollback requires a recorded installation plan")
    name = reader_manifest(journal, RESTORED_NAMESPACE).object("metadata").string("name")
    if journal.get("readersRemoved") is True:
        for namespace in (NAMESPACE, RESTORED_NAMESPACE):
            reader_name = reader_manifest(journal, namespace).object("metadata").string("name")
            existing = run(["-n", namespace, "get", "pod", reader_name, "--ignore-not-found", "-o", "json"]).strip()
            if not existing:
                journal.strings("readers", {}).pop(namespace, None)
    journal["readersRemoved"] = False
    save(path, journal)
    reader = ensure_resource(reader_manifest(journal, RESTORED_NAMESPACE))
    assert_reader(reader, journal, RESTORED_NAMESPACE)
    journal.strings("readers", {})[RESTORED_NAMESPACE] = reader.object("metadata").string("uid")
    save(path, journal)
    run(["-n", RESTORED_NAMESPACE, "wait", "--for=condition=Ready", "pod/" + name, "--timeout=45s"], 50)
    require_restore(journal)
    if remote_fingerprint(journal, RESTORED_NAMESPACE) != proof.strings("files"):
        raise ValueError("Independent whole-volume restore changed before recovery")
    writer = create_writer(path, journal)
    writer_name = writer.object("metadata").string("name")
    published = run(["-n", NAMESPACE, "exec", writer_name, "-c", "writer", "--", "sha256sum", "/plugins/TheStorm.jar"])
    if published.split()[:1] != [journal.object("installationPlan").string("candidateJarSha256")]:
        raise ValueError("Rollback writer does not contain the pinned candidate plugin")
    upload_rollback_operator(journal, proof)
    state = rollback_writer_operation(journal, "inspect")
    if (
        state.get("requestId") != journal.string("requestId")
        or state.get("files") != len(proof.strings("files"))
        or state.get("phase") not in ("STAGED", "COMMITTING", "INSTALLED", "WHOLE_VOLUME_RESTORED")
    ):
        raise ValueError("Rollback writer transaction does not identify this original volume")
    if state.get("rollbackPhase") == "NOT_STAGED":
        transfer_rollback(journal)
    elif state.get("rollbackPhase") not in ("STAGED", "COMMITTING", "RESTORED"):
        raise ValueError("Rollback writer returned an unreviewed recovery phase")
    require_offline(journal, writer=True)
    require_restore(journal)
    if remote_fingerprint(journal, RESTORED_NAMESPACE) != proof.strings("files"):
        raise ValueError("Independent whole-volume restore changed during recovery transfer")
    rollback_proof(journal)
    result = rollback_writer_operation(journal, "restore")
    if (
        result.get("requestId") != journal.string("requestId")
        or result.get("phase") != "WHOLE_VOLUME_RESTORED"
        or result.get("rollbackPhase") != "RESTORED"
        or result.get("files") != len(proof.strings("files"))
    ):
        raise ValueError("Whole-volume recovery returned mismatched evidence")
    require_offline(journal, writer=True)
    require_restore(journal)
    rollback_proof(journal)
    journal["wholeVolumeRecovery"] = result
    save(path, journal)


def bootstrap_resources(path: Path, journal: JsonObject, staging: Path, candidate: Path) -> None:
    """Add only fresh resource metadata to an installed, stopped volume; retain historical data."""
    recover_writer_identity(path, journal)
    require_offline(journal, writer=journal.get("writerRemoved") is not True)
    require_restore(journal)
    prepared = restoration_resources.plan(staging, journal, candidate)
    operation = journal.object("resourceBootstrapOperation", {})
    if not operation:
        if journal.object("installation").get("phase") != "INSTALLED" or journal.get("writerRemoved") is not True:
            raise ValueError("Resource bootstrap requires verified installation and removed writer")
        operation = JsonObject(
            {
                "plan": prepared,
                "installation": JsonObject.parse(json.dumps(journal.object("installation"))),
            }
        )
        journal["resourceBootstrapOperation"] = operation
        save(path, journal)
    if operation.object("plan") != prepared:
        raise ValueError("Fresh resource bootstrap inputs changed")
    create_writer(path, journal)
    upload_installation(journal, JsonObject({**prepared, "layout": prepared.string("payload")}), resources=True)
    require_offline(journal, writer=True)
    name = writer_manifest(journal).object("metadata").string("name")
    result = JsonObject.parse(
        run(
            [
                "-n",
                NAMESPACE,
                "exec",
                name,
                "-c",
                "writer",
                "--",
                "python3",
                "/scratch/operator/restoration_resources.py",
                "--plan",
                "/scratch/plan.json",
            ],
            1800,
        )
    )
    if (
        result.get("phase") != "VERIFIED"
        or any(result.get(key) != prepared.get(key) for key in ("requestId", "candidateJarSha256", "receiptSha256"))
        or result.get("files") != 9
    ):
        raise ValueError("Stopped resource bootstrap returned mismatched evidence")
    require_offline(journal, writer=True)
    journal["installation"] = JsonObject.parse(json.dumps(operation.object("installation")))
    journal["resourceBootstrap"] = result
    save(path, journal)


def private_start(path: Path, journal: JsonObject) -> None:
    if (
        journal.get("privateStartup") == "ROLLED_BACK"
        or journal.object("wholeVolumeRecovery", {}).get("phase") == "WHOLE_VOLUME_RESTORED"
    ):
        raise ValueError("Candidate installation was rolled back; release the verified original volume")
    assert_closed(journal)
    if journal.object("installationRevision", {}).get("phase", "INSTALLED") != "INSTALLED":
        raise ValueError("Private startup requires a completed installation revision")
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    if journal.object("installation").get("phase") != "INSTALLED" or journal.get("writerRemoved") is not True:
        raise ValueError("Private startup requires verified installation and writer cleanup")
    resources = journal.object("resourceBootstrap", {})
    if (
        resources.get("phase") != "VERIFIED"
        or resources.get("requestId") != journal.string("requestId")
        or resources.get("candidateJarSha256") != journal.object("installation").get("candidateJarSha256")
        or resources.get("files") != 9
    ):
        raise ValueError("Private startup requires verified fresh resource metadata")
    if annotations(server).get(PHASE) == "OFFLINE":
        require_offline(journal)
        for key in ("acceptance", "stoppingIncarnation", "stoppedIncarnation", "rollbackVerification"):
            journal.pop(key, None)
        journal["privateStartup"] = "STARTING"
        save(path, journal)
        patch(
            "statefulset",
            SERVER,
            server,
            [
                {"op": "replace", "path": "/metadata/annotations/" + pointer(PHASE), "value": "VALIDATING"},
                {
                    "op": "replace",
                    "path": "/spec/template/spec/containers/0/image",
                    "value": journal.string("candidateImage"),
                },
                {"op": "replace", "path": "/spec/replicas", "value": 1},
            ],
        )
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    if (
        annotations(server).get(PHASE) != "VALIDATING"
        or annotations(server).get(IMAGE) != journal.string("candidateImage")
        or server_image(server) != journal.string("candidateImage")
        or server.object("spec").integer("replicas") != 1
    ):
        raise ValueError("Private startup is not running the exact pinned candidate")
    assert_closed(journal)
    if "acceptance" in journal:
        current = run(["-n", NAMESPACE, "get", "pod", SERVER + "-0", "--ignore-not-found", "-o", "json"]).strip()
        invalidate_changed_incarnation(journal, pod_incarnation(JsonObject.parse(current)) if current else {})
    journal["privateStartup"] = "VALIDATING"
    save(path, journal)


def pod_incarnation(pod: JsonObject) -> JsonObject:
    statuses = pod.object("status", {}).objects("containerStatuses", [])
    status = statuses[0] if len(statuses) == 1 else JsonObject()
    return JsonObject(
        {
            "podUid": pod.object("metadata").string("uid"),
            "containerId": status.get("containerID"),
            "restartCount": status.get("restartCount"),
        }
    )


def invalidate_changed_incarnation(journal: JsonObject, incarnation: Mapping[str, object]) -> None:
    if "acceptance" in journal:
        acceptance = journal.object("acceptance")
        if any(acceptance.get(key) != incarnation.get(key) for key in ("podUid", "containerId", "restartCount")):
            acceptance["status"] = "INVALIDATED"


def private_stop(path: Path, journal: JsonObject) -> None:
    assert_closed(journal)
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    if annotations(server).get(IMAGE) != journal.string("candidateImage"):
        raise ValueError("Private server image pin changed")
    current = run(["-n", NAMESPACE, "get", "pod", SERVER + "-0", "--ignore-not-found", "-o", "json"]).strip()
    if journal.get("privateStartup") != "STOPPED":
        if current:
            journal["stoppingIncarnation"] = pod_incarnation(JsonObject.parse(current))
        incarnation = journal.object("stoppingIncarnation", {})
        invalidate_changed_incarnation(journal, incarnation)
        save(path, journal)
    if server.object("spec").integer("replicas") != 0:
        patch("statefulset", SERVER, server, [{"op": "replace", "path": "/spec/replicas", "value": 0}])
    remaining = run(["-n", NAMESPACE, "get", "pod", SERVER + "-0", "--ignore-not-found", "-o", "json"]).strip()
    if remaining:
        incarnation = pod_incarnation(JsonObject.parse(remaining))
        invalidate_changed_incarnation(journal, incarnation)
        journal["stoppingIncarnation"] = incarnation
        save(path, journal)
        run(["-n", NAMESPACE, "wait", "--for=delete", "pod/" + SERVER + "-0", "--timeout=180s"], 190)
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    if server.object("status", {}).get("replicas", 0) != 0:
        raise ValueError("Private server has not finished its graceful shutdown")
    patch(
        "statefulset",
        SERVER,
        server,
        [{"op": "replace", "path": "/metadata/annotations/" + pointer(PHASE), "value": "OFFLINE"}],
    )
    require_offline(journal)
    if journal.get("privateStartup") != "STOPPED":
        journal["stoppedIncarnation"] = journal.pop("stoppingIncarnation", {})
    journal["privateStartup"] = "STOPPED"
    save(path, journal)


ACCEPTANCE_CHECKS = (
    "startup",
    "historicalSpawn",
    "townDirectory",
    "provenPlotEditors",
    "heritageProtection",
    "historicalContainerLocks",
    "grazingAndGrowth",
    "settlement",
    "rustworks",
    "rwf",
    "coreProtectLookup",
    "coreProtectRollback",
    "identities",
    "historicalPlayerData",
    "maps",
    "privateAdmission",
)


def accept(path: Path, journal: JsonObject, evidence_path: Path) -> None:
    assert_closed(journal)
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    pod = read("pod", SERVER + "-0")
    if evidence_path.is_symlink() or not evidence_path.is_file():
        raise ValueError("Private acceptance evidence must be a regular file")
    evidence = JsonObject.parse(evidence_path.read_bytes())
    containers = pod.object("spec").objects("containers")
    statuses = pod.object("status").objects("containerStatuses")
    server_status = server.object("status")
    revision = server_status.string("updateRevision")
    if (
        annotations(server).get(PHASE) != "VALIDATING"
        or server_image(server) != journal.string("candidateImage")
        or evidence.get("requestId") != journal.string("requestId")
        or evidence.get("candidateImage") != journal.string("candidateImage")
        or evidence.get("candidateJarSha256") != journal.object("installation").string("candidateJarSha256")
        or evidence.get("podUid") != pod.object("metadata").string("uid")
        or server_status.get("observedGeneration") != server.object("metadata").integer("generation")
        or server_status.get("currentRevision") != revision
        or pod.object("metadata").strings("labels", {}).get("controller-revision-hash") != revision
        or evidence.get("testOnly")
        or set(evidence.object("checks")) != set(ACCEPTANCE_CHECKS)
        or any(evidence.object("checks").get(key) != "VERIFIED" for key in ACCEPTANCE_CHECKS)
        or len(containers) != 1
        or containers[0].get("image") != journal.string("candidateImage")
        or len(statuses) != 1
        or statuses[0].get("ready") is not True
        or evidence.get("containerId") != statuses[0].string("containerID")
        or evidence.get("restartCount") != statuses[0].integer("restartCount")
        or not statuses[0].string("imageID").endswith(journal.string("candidateImage").split("@", 1)[1])
        or not any(
            owner.get("controller") is True and owner.get("uid") == journal.string("serverUid")
            for owner in pod.object("metadata").objects("ownerReferences")
        )
    ):
        raise ValueError("Private acceptance does not verify this live candidate and every required behavior")
    journal["acceptance"] = {
        "status": "VERIFIED",
        **pod_incarnation(pod),
        "path": str(evidence_path.resolve()),
        "sha256": restoration_files.digest(evidence_path),
        "podTemplate": server.object("spec").object("template"),
        "controllerRevision": revision,
    }
    save(path, journal)


def assert_gitops_image(journal: JsonObject, expected_image: str | None = None) -> None:
    """The reconciled Application must declare this image at both Helm precedence levels."""
    application = read("application", SERVER, "argocd")
    spec = application.object("spec")
    source = spec.object("source")
    helm = source.object("helm")
    image = helm.object("valuesObject").object("image")
    declared = image.string("repository") + ":" + image.string("tag")
    image_parameters = [item for item in helm.objects("parameters") if item.string("name").startswith("image.")]
    sync = application.object("status").object("sync")
    if (
        declared != (expected_image if expected_image is not None else journal.string("candidateImage"))
        or image_parameters != [{"name": "image.tag", "value": image.string("tag")}]
        or set(helm) != {"parameters", "valuesObject"}
        or "sources" in spec
        or source.get("chart") != "minecraft"
        or source.get("repoURL") != "https://itzg.github.io/minecraft-server-charts/"
        or spec.object("destination").get("namespace") != NAMESPACE
        or sync.get("status") != "Synced"
        or sync.object("comparedTo").get("source") != source
        or sync.object("comparedTo").get("destination") != spec.object("destination")
        or "operation" in application
    ):
        raise ValueError("Release requires the reconciled GitOps Application to declare the accepted candidate image")


def release(path: Path, journal: JsonObject) -> None:
    """Release the stopped lease, then restore only this request's recorded route selectors."""
    acceptance = journal.object("acceptance")
    if acceptance.get("status") != "VERIFIED" or restoration_files.digest(
        Path(acceptance.string("path"))
    ) != acceptance.string("sha256"):
        raise ValueError("Reopening requires unchanged, verified private acceptance")
    server = read("statefulset", SERVER)
    assert_owner(server, journal, allow_unheld=True)
    if annotations(server).get(LEASE) is not None and (
        server.object("spec").integer("replicas") != 0 or server.object("status", {}).get("replicas", 0) != 0
    ):
        raise ValueError("Release requires a gracefully stopped accepted candidate")
    stopped = journal.object("stoppedIncarnation", {})
    if any(acceptance.get(key) != stopped.get(key) for key in ("podUid", "containerId", "restartCount")):
        raise ValueError("Release requires acceptance of the exact stopped pod and container incarnation")
    reopen(path, journal, journal.string("candidateImage"), acceptance.object("podTemplate"))


def verify_rollback(path: Path, journal: JsonObject) -> None:
    """Verify the committed original volume before selecting its recorded image; keep admission closed."""
    require_offline(journal, readers=True)
    require_restore(journal)
    if journal.get("writerRemoved") is not True:
        raise ValueError("Rollback verification requires writer cleanup")
    restored = journal.object("restore")
    if restored.get("byteVerification") != "VERIFIED":
        raise ValueError("Rollback requires the verified independent whole-volume proof")
    proof = backup_contract.whole_proof(Path(restored.string("proofPath")), restored.string("proofSha256"))
    if any(
        proof.get(key) != value
        for key, value in {
            "requestId": journal.string("requestId"),
            "backupUid": journal.object("backup").string("uid"),
            "sourceVolumeUid": journal.string("volumeUid"),
            "restoredVolumeUid": restored.string("volumeUid"),
        }.items()
    ):
        raise ValueError("Rollback proof identifies different storage or request")
    name = reader_manifest(journal, NAMESPACE).object("metadata").string("name")
    existing = run(["-n", NAMESPACE, "get", "pod", name, "--ignore-not-found", "-o", "json"]).strip()
    if not existing and journal.get("readersRemoved") is True:
        journal.strings("readers", {}).pop(NAMESPACE, None)
    journal["readersRemoved"] = False
    journal["privateStartup"] = "ROLLED_BACK"
    for key in ("acceptance", "stoppingIncarnation", "stoppedIncarnation", "rollbackVerification"):
        journal.pop(key, None)
    save(path, journal)
    pod = ensure_resource(reader_manifest(journal, NAMESPACE))
    assert_reader(pod, journal, NAMESPACE)
    journal.strings("readers", {})[NAMESPACE] = pod.object("metadata").string("uid")
    save(path, journal)
    run(["-n", NAMESPACE, "wait", "--for=condition=Ready", "pod/" + name, "--timeout=45s"], 50)
    require_offline(journal, readers=True)
    encoded = run(
        [
            "-n",
            NAMESPACE,
            "exec",
            name,
            "-c",
            "reader",
            "--",
            "cat",
            "/data/" + restoration_files.WORKSPACE + "/" + journal.string("requestId") + "/journal.json",
        ]
    )
    transaction = JsonObject.parse(encoded)
    if (
        transaction.get("requestId") != journal.string("requestId")
        or transaction.get("phase") != "WHOLE_VOLUME_RESTORED"
        or transaction.object("wholeRollback").get("phase") != "RESTORED"
        or transaction.strings("original") != proof.strings("files")
        or remote_fingerprint(journal, NAMESPACE, exclude_workspace=True) != proof.strings("files")
    ):
        raise ValueError("Committed whole-volume rollback does not match its original byte proof")
    require_offline(journal, readers=True)
    require_restore(journal)
    rollback_image = journal.string("rollbackImage")
    if not re.fullmatch(
        r"ghcr\.io/shepherdjerred/the-storm-server:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}",
        rollback_image,
    ):
        raise ValueError("Rollback requires its recorded immutable image")
    server = read("statefulset", SERVER)
    if server_image(server) != rollback_image:
        patch(
            "statefulset",
            SERVER,
            server,
            [
                {"op": "replace", "path": "/spec/template/spec/containers/0/image", "value": rollback_image},
            ],
        )
    receipt = path.with_name(path.name + ".rollback-verification.json")
    verification = {
        "status": "VERIFIED",
        "requestId": journal.string("requestId"),
        "rollbackImage": rollback_image,
        "volumeUid": journal.string("volumeUid"),
        "backupUid": journal.object("backup").string("uid"),
        "backupProofSha256": restored.string("proofSha256"),
        "transactionSha256": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
    }
    save(receipt, verification)
    journal["rollbackVerification"] = {
        **verification,
        "path": str(receipt.resolve()),
        "sha256": restoration_files.digest(receipt),
    }
    journal["privateStartup"] = "ROLLED_BACK"
    save(path, journal)


def release_rollback(path: Path, journal: JsonObject) -> None:
    """Reopen the verified original volume with its recorded image and reconciled GitOps declaration."""
    verification = journal.object("rollbackVerification")
    if (
        verification.get("status") != "VERIFIED"
        or verification.get("requestId") != journal.string("requestId")
        or verification.get("rollbackImage") != journal.string("rollbackImage")
        or verification.get("volumeUid") != journal.string("volumeUid")
        or verification.get("backupUid") != journal.object("backup").string("uid")
        or verification.get("backupProofSha256") != journal.object("restore").string("proofSha256")
        or journal.get("readersRemoved") is not True
        or journal.get("writerRemoved") is not True
        or restoration_files.digest(Path(verification.string("path"))) != verification.string("sha256")
    ):
        raise ValueError("Rollback release requires unchanged byte verification and helper cleanup")
    backup_contract.whole_proof(
        Path(journal.object("restore").string("proofPath")),
        verification.string("backupProofSha256"),
    )
    reopen(path, journal, journal.string("rollbackImage"), journal.object("rollbackTemplate"))


def abort(path: Path, journal: JsonObject) -> None:
    """Reopen the untouched original volume only before any production write authorization."""
    if (
        journal.get("productionWriteAuthorized") is not False
        or any(
            key in journal
            for key in (
                "writerUid",
                "previousWriterUid",
                "installation",
                "wholeVolumeRecovery",
                "privateStartup",
                "acceptance",
                "stoppingIncarnation",
                "stoppedIncarnation",
                "rollbackVerification",
            )
        )
        or journal.get("writerCreationPending")
    ):
        raise ValueError("Abort requires no production writer authorization, installation or candidate startup")
    claim = read("pvc", CLAIM)
    volume = read("pv", journal.string("volumeName"), "")
    if (
        (
            claim.object("metadata").get("uid"),
            claim.object("status").get("phase"),
            claim.object("spec").get("volumeName"),
        )
        != (journal.string("claimUid"), "Bound", journal.string("volumeName"))
        or volume.object("metadata").get("uid") != journal.string("volumeUid")
        or volume_source(volume) != journal.strings("volumeSource")
    ):
        raise ValueError("Abort requires the recorded original volume and claim")
    expected = JsonObject(
        {
            "status": "NO_PRODUCTION_WRITE_AUTHORIZATION",
            "requestId": journal.string("requestId"),
            "serverUid": journal.string("serverUid"),
            "volumeUid": journal.string("volumeUid"),
            "rollbackImage": journal.string("rollbackImage"),
            "templateSha256": hashlib.sha256(
                json.dumps(journal.object("rollbackTemplate"), sort_keys=True).encode("utf-8")
            ).hexdigest(),
        }
    )
    receipt = path.with_name(path.name + ".pre-install-abort.json")
    if journal.string("phase") == "LEASED_OFFLINE":
        require_offline(journal, readers=True)
        assert_rollback_template(read("statefulset", SERVER), journal)
        assert_gitops_image(journal, journal.string("rollbackImage"))
        # Even terminated, unrecorded source-volume pods make prior write access uncertain.
        pods = JsonObject.parse(run(["-n", NAMESPACE, "get", "pods", "-o", "json"])).objects("items")
        for pod in pods:
            if any(
                entry.object("persistentVolumeClaim", {}).get("claimName") == CLAIM
                for entry in pod.object("spec").objects("volumes", [])
            ):
                assert_reader(pod, journal, NAMESPACE)
        remove_readers(path, journal)
        require_offline(journal)
        save(receipt, expected)
        journal["preInstallAbort"] = {"path": str(receipt.resolve()), "sha256": restoration_files.digest(receipt)}
        save(path, journal)
    elif journal.string("phase") not in ("RELEASING", "REOPENED"):
        raise ValueError("Abort requires stopped pre-install maintenance or its recorded reopening")
    evidence = journal.object("preInstallAbort")
    proof_path = Path(evidence.string("path"))
    if (
        proof_path != receipt.resolve()
        or proof_path.is_symlink()
        or not proof_path.is_file()
        or restoration_files.digest(proof_path) != evidence.string("sha256")
        or JsonObject.parse(proof_path.read_bytes()) != expected
        or journal.get("readersRemoved") is not True
    ):
        raise ValueError("Abort reopening requires unchanged original-volume evidence and reader cleanup")
    reopen(path, journal, journal.string("rollbackImage"), journal.object("rollbackTemplate"))


def reopen(path: Path, journal: JsonObject, expected_image: str, accepted_template: JsonObject) -> None:
    """Restore captured routes for an accepted candidate or byte-verified whole-volume rollback."""
    server = read("statefulset", SERVER)
    assert_owner(server, journal, allow_unheld=True)
    if server.object("spec").object("template") != accepted_template:
        raise ValueError("Release requires the exact accepted pod template")
    if server_image(server) != expected_image:
        raise ValueError("Release requires the accepted candidate image or recorded rollback image")
    if annotations(server).get(LEASE) is not None and (
        server.object("spec").integer("replicas") != 0 or server.object("status", {}).get("replicas", 0) != 0
    ):
        raise ValueError("Release requires a gracefully stopped accepted candidate or rollback")
    assert_gitops_image(journal, expected_image)
    if journal.get("phase") == "LEASED_OFFLINE":
        require_offline(journal)
        journal["phase"] = "RELEASING"
        save(path, journal)
    if journal.get("phase") not in ("RELEASING", "REOPENED"):
        raise ValueError("Unexpected release phase")
    if annotations(server).get(LEASE) is not None:
        if annotations(server).get(PHASE) != "OFFLINE":
            raise ValueError("Release cannot clear a running validation lease")
        updated = {key: value for key, value in annotations(server).items() if key not in (LEASE, PHASE, IMAGE)}
        patch("statefulset", SERVER, server, [{"op": "replace", "path": "/metadata/annotations", "value": updated}])
    # Java is the only route that wakes the server; expose it after the others.
    for name in (*SERVICES[1:], SERVICES[0]):
        service = read("service", name)
        expected = journal.object("services").object(name)
        held = annotations(service).get(LEASE)
        if service.object("metadata").string("uid") != expected.string("uid") or held not in (
            None,
            journal.string("requestId"),
        ):
            raise ValueError("Route identity changed during reopening")
        if held is None:
            if service.object("spec").strings("selector") != expected.strings("selector") or (
                name == SERVER and WAKE in annotations(service)
            ):
                raise ValueError("Released route differs from its original selector")
            continue
        if service.object("spec").strings("selector") != {**expected.strings("selector"), ACCESS: "closed"}:
            raise ValueError("Owned route selector changed before reopening")
        updated = {
            key: value
            for key, value in annotations(service).items()
            if key != LEASE and not (name == SERVER and key == WAKE)
        }
        patch(
            "service",
            name,
            service,
            [
                {"op": "replace", "path": "/spec/selector", "value": expected.strings("selector")},
                {"op": "replace", "path": "/metadata/annotations", "value": updated},
            ],
        )
    journal["phase"] = "REOPENED"
    save(path, journal)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "operation",
        choices=(
            "preflight",
            "acquire",
            "backup",
            "restore-backup",
            "verify-backup",
            "export-backup",
            "remove-readers",
            "plan-install",
            "install",
            "revise-installation",
            "bootstrap-resources",
            "remove-writer",
            "private-start",
            "private-stop",
            "accept",
            "release",
            "abort",
            "whole-rollback",
            "verify-rollback",
            "release-rollback",
        ),
    )
    parser.add_argument("--journal", required=True, type=Path)
    parser.add_argument("--request", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--export-dir", type=Path)
    parser.add_argument("--export-proof", type=Path)
    parser.add_argument("--staging", type=Path)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--evidence", type=Path)
    arguments = parser.parse_args()
    if arguments.operation == "export-backup" and (arguments.export_dir is None or arguments.export_proof is None):
        parser.error("export-backup requires --export-dir and --export-proof")
    if arguments.operation in ("plan-install", "install", "revise-installation", "bootstrap-resources") and (
        arguments.staging is None or arguments.candidate is None
    ):
        parser.error("Installation requires --staging and --candidate")
    if arguments.operation == "accept" and arguments.evidence is None:
        parser.error("accept requires --evidence")
    with journal_lock(arguments.journal):
        image = arguments.image
        if arguments.operation == "revise-installation":
            if arguments.journal.is_symlink() or not arguments.journal.is_file():
                raise ValueError("Revision requires an existing regular maintenance journal")
            image = JsonObject.parse(arguments.journal.read_bytes()).string("candidateImage")
        journal = initialize(arguments.journal, arguments.request, image)
        if arguments.operation == "acquire":
            acquire(arguments.journal, journal)
        elif arguments.operation == "backup":
            backup(arguments.journal, journal)
        elif arguments.operation == "restore-backup":
            restore_backup(arguments.journal, journal)
        elif arguments.operation == "verify-backup":
            verify_backup(arguments.journal, journal)
        elif arguments.operation == "export-backup":
            export_backup(arguments.journal, journal, arguments.export_dir, arguments.export_proof)
        elif arguments.operation == "remove-readers":
            remove_readers(arguments.journal, journal)
        elif arguments.operation == "plan-install":
            require_offline(journal)
            require_restore(journal)
            journal["installationPlan"] = restoration_activation.plan(arguments.staging, journal, arguments.candidate)
            save(arguments.journal, journal)
        elif arguments.operation == "install":
            install(arguments.journal, journal, arguments.staging, arguments.candidate)
        elif arguments.operation == "revise-installation":
            revise_installation(arguments.journal, journal, arguments.staging, arguments.candidate, arguments.image)
        elif arguments.operation == "remove-writer":
            remove_writer(arguments.journal, journal)
        elif arguments.operation == "bootstrap-resources":
            bootstrap_resources(arguments.journal, journal, arguments.staging, arguments.candidate)
        elif arguments.operation == "private-start":
            private_start(arguments.journal, journal)
        elif arguments.operation == "private-stop":
            private_stop(arguments.journal, journal)
        elif arguments.operation == "accept":
            accept(arguments.journal, journal, arguments.evidence)
        elif arguments.operation == "release":
            release(arguments.journal, journal)
        elif arguments.operation == "abort":
            abort(arguments.journal, journal)
        elif arguments.operation == "whole-rollback":
            whole_rollback(arguments.journal, journal)
        elif arguments.operation == "verify-rollback":
            verify_rollback(arguments.journal, journal)
        elif arguments.operation == "release-rollback":
            release_rollback(arguments.journal, journal)
        print(
            json.dumps(
                {
                    "requestId": journal.string("requestId"),
                    "phase": journal.string("phase"),
                    "backup": journal.object("backup", {}),
                    "restore": journal.object("restore", {}),
                }
            )
        )


if __name__ == "__main__":
    main()

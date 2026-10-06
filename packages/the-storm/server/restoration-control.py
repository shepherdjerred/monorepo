#!/usr/bin/env python3
"""Hold Storm offline and verify its independent rollback restore. Never installs world data."""

import argparse
import fcntl
import hashlib
import importlib.util
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
POLICIES = ("minecraft-tsmc-world-restoration.sjer.red", "minecraft-tsmc-world-restoration-scale.sjer.red")
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
    for name, resource in zip(POLICIES, ("statefulsets", "statefulsets/scale"), strict=True):
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
                resource in rule.string_list("resources") and "UPDATE" in rule.string_list("operations")
                for rule in spec.object("matchConstraints").objects("resourceRules")
            )
        ):
            raise ValueError("Restoration admission guards have not reconciled without CEL errors")
        if resource.endswith("/scale") and binding.object("spec").object("paramRef") != {
            "name": SERVER,
            "namespace": NAMESPACE,
            "parameterNotFoundAction": "Deny",
        }:
            raise ValueError("Scale admission guard does not bind the expected parent StatefulSet")


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
        raise ValueError("Restoration guard did not reject its live dry-run scale-up probe")


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
            "serverUid": server.object("metadata").string("uid"),
            "claimUid": claim.object("metadata").string("uid"),
            "volumeName": claim.object("spec").string("volumeName"),
            "volumeUid": volume.object("metadata").string("uid"),
            "volumeSource": volume_source(volume),
            "services": services,
            "phase": "PREPARED",
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
        if annotations(server).get(LEASE) is None and server_image(server) != journal.string("rollbackImage"):
            raise ValueError("Server image changed before the rollback capture")
        if server.object("spec").integer("replicas") != 0:
            assert_empty()
            patch("statefulset", SERVER, server, [{"op": "add", "path": "/spec/replicas", "value": 0}])
        # Waiting does not force-delete Paper; its normal grace period drains and saves.
        if run(["-n", NAMESPACE, "get", "pod", SERVER + "-0", "--ignore-not-found", "-o", "json"]).strip():
            run(["-n", NAMESPACE, "wait", "--for=delete", "pod/" + SERVER + "-0", "--timeout=180s"], 190)
        server = read("statefulset", SERVER)
        assert_owner(server, journal, allow_unheld=True)
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
    journal["admissionProbes"] = "UPDATE_AND_SCALE_DENIED"
    save(path, journal)


def require_offline(journal: JsonObject, readers: bool = False) -> None:
    assert_closed(journal)
    server = read("statefulset", SERVER)
    assert_owner(server, journal)
    claim = read("pvc", CLAIM)
    volume = read("pv", journal.string("volumeName"), "")
    if (
        journal.string("phase") != "LEASED_OFFLINE"
        or journal.get("admissionProbes") != "UPDATE_AND_SCALE_DENIED"
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
        or any(
            container.get("env") or container.get("envFrom") for container in pod.object("spec").objects("containers")
        )
        or (recorded is not None and recorded != pod.object("metadata").string("uid"))
    ):
        raise ValueError("Volume reader is not the exact request-owned read-only pod")


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


def remote_fingerprint(journal: JsonObject, namespace: str) -> dict[str, str]:
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
        ),
    )
    parser.add_argument("--journal", required=True, type=Path)
    parser.add_argument("--request", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--export-dir", type=Path)
    parser.add_argument("--export-proof", type=Path)
    arguments = parser.parse_args()
    if arguments.operation == "export-backup" and (arguments.export_dir is None or arguments.export_proof is None):
        parser.error("export-backup requires --export-dir and --export-proof")
    with journal_lock(arguments.journal):
        journal = initialize(arguments.journal, arguments.request, arguments.image)
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
        print(
            json.dumps(
                {
                    "requestId": journal.string("requestId"),
                    "phase": journal.string("phase"),
                    "backup": journal.object("backup"),
                    "restore": journal.object("restore"),
                }
            )
        )


if __name__ == "__main__":
    main()

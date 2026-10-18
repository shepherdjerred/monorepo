"""Discard only the exact independently restored copy after safe original recovery."""

import json
import subprocess
from pathlib import Path
from types import ModuleType

from restoration_json import JsonObject


def cleanup_copy(control: ModuleType, path: Path, journal: JsonObject) -> None:
    if journal.get("phase") != "REOPENED" or journal.get("productionWriteAuthorized") is not False:
        raise ValueError("Validation copy cleanup requires the safely reopened untouched original")
    control.assert_managed_restore_namespace(journal)
    restored = journal.object("restore", {})
    if not restored.get("claimUid"):
        return
    original_claim = control.read("pvc", control.CLAIM)
    original_volume = control.read("pv", journal.string("volumeName"), "")
    if (
        original_claim.object("metadata").get("uid") != journal.string("claimUid")
        or original_claim.object("spec").get("volumeName") != journal.string("volumeName")
        or original_volume.object("metadata").get("uid") != journal.string("volumeUid")
        or control.volume_source(original_volume) != journal.strings("volumeSource")
    ):
        raise ValueError("Original storage changed before validation-copy cleanup")
    encoded = control.run(
        ["-n", control.RESTORED_NAMESPACE, "get", "pvc", control.CLAIM, "--ignore-not-found", "-o", "json"]
    ).strip()
    validation = journal.object("deliveryValidation")
    if not encoded:
        if validation.get("copyCleanupIntent") != restored.string("claimUid"):
            raise ValueError("Validation copy disappeared before its cleanup intent")
        validation["copyRemoved"] = True
        control.save(path, journal)
        return
    claim = JsonObject.parse(encoded)
    volume = control.read("pv", restored.string("volumeName"), "")
    if (
        claim.object("metadata").get("uid") != restored.string("claimUid")
        or claim.object("metadata").strings("labels", {}).get("velero.io/restore-name") != restored.string("name")
        or claim.object("spec").get("volumeName") != restored.string("volumeName")
        or volume.object("metadata").get("uid") != restored.string("volumeUid")
        or control.volume_source(volume) != restored.strings("volumeSource")
        or restored.string("claimUid") == journal.string("claimUid")
        or restored.string("volumeUid") == journal.string("volumeUid")
        or restored.strings("volumeSource")["volumeHandle"] == journal.strings("volumeSource")["volumeHandle"]
    ):
        raise ValueError("Cleanup target is not the exact independent restored copy")
    pods = JsonObject.parse(control.run(["-n", control.RESTORED_NAMESPACE, "get", "pods", "-o", "json"])).objects(
        "items"
    )
    if any(
        mount.object("persistentVolumeClaim", {}).get("claimName") == control.CLAIM
        for pod in pods
        for mount in pod.object("spec").objects("volumes", [])
    ):
        raise ValueError("Validation copy still has a Pod; inspect its exact owner before cleanup")
    validation["copyCleanupIntent"] = restored.string("claimUid")
    control.save(path, journal)
    completed = subprocess.run(
        [
            "kubectl",
            "--context",
            control.CONTEXT,
            "delete",
            "--raw",
            f"/api/v1/namespaces/{control.RESTORED_NAMESPACE}/persistentvolumeclaims/{control.CLAIM}",
            "-f",
            "-",
        ],
        input=json.dumps(
            {
                "apiVersion": "v1",
                "kind": "DeleteOptions",
                "preconditions": {
                    "uid": restored.string("claimUid"),
                    "resourceVersion": claim.object("metadata").string("resourceVersion"),
                },
            }
        ),
        text=True,
        capture_output=True,
        timeout=30,
    )
    if completed.returncode:
        raise RuntimeError("Validation copy deletion is ambiguous; inspect its recorded UID before retrying")
    control.run(
        ["-n", control.RESTORED_NAMESPACE, "wait", "--for=delete", "pvc/" + control.CLAIM, "--timeout=120s"], 125
    )
    validation["copyRemoved"] = True
    control.save(path, journal)

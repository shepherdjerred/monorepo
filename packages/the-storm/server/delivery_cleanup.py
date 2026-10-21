"""Discard only the exact independently restored copy after safe original recovery."""

import json
import subprocess
from pathlib import Path
from types import ModuleType

from restoration_json import JsonObject


def no_consumers(control: ModuleType, volume_name: str | None) -> None:
    pods = JsonObject.parse(control.run(["-n", control.restored_namespace, "get", "pods", "-o", "json"])).objects(
        "items"
    )
    if any(
        mount.object("persistentVolumeClaim", {}).get("claimName") == control.CLAIM
        for pod in pods
        for mount in pod.object("spec").objects("volumes", [])
    ):
        raise ValueError("Validation copy still has a Pod; inspect its exact owner before cleanup")
    if volume_name is not None:
        attachments = JsonObject.parse(control.run(["get", "volumeattachments", "-o", "json"])).objects("items")
        if any(item.object("spec").object("source").get("persistentVolumeName") == volume_name for item in attachments):
            raise ValueError("Validation copy still has a VolumeAttachment")


def delete_claim(control: ModuleType, claim: JsonObject) -> None:
    completed = subprocess.run(
        [
            "kubectl",
            "--context",
            control.CONTEXT,
            "delete",
            "--raw",
            f"/api/v1/namespaces/{control.restored_namespace}/persistentvolumeclaims/{control.CLAIM}",
            "-f",
            "-",
        ],
        input=json.dumps(
            {
                "apiVersion": "v1",
                "kind": "DeleteOptions",
                "preconditions": {
                    "uid": claim.object("metadata").string("uid"),
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
        ["-n", control.restored_namespace, "wait", "--for=delete", "pvc/" + control.CLAIM, "--timeout=120s"], 125
    )


def cleanup_copy(control: ModuleType, path: Path, journal: JsonObject) -> None:
    if journal.get("phase") != "REOPENED" or journal.get("productionWriteAuthorized") is not False:
        raise ValueError("Validation copy cleanup requires the safely reopened untouched original")
    control.assert_managed_restore_namespace(journal)
    restored = journal.object("restore", {})
    if not restored.get("name"):
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
        ["-n", control.restored_namespace, "get", "pvc", control.CLAIM, "--ignore-not-found", "-o", "json"]
    ).strip()
    validation = journal.object("deliveryValidation")
    native_restore = control.read("restore.velero.io", restored.string("name"), "velero")
    if (
        native_restore.object("metadata").get("uid") != restored.string("uid")
        or native_restore.object("metadata").strings("labels", {}).get(control.LEASE) != journal.string("requestId")
        or native_restore.object("status").get("phase")
        not in ("Completed", "Failed", "PartiallyFailed", "FailedValidation")
    ):
        raise ValueError("Exact owned restore must be terminal before validation-copy cleanup")
    claim = JsonObject.parse(encoded) if encoded else None
    if claim is not None and (
        claim.object("metadata").get("uid") == journal.string("claimUid")
        or claim.object("metadata").strings("labels", {}).get("velero.io/restore-name") != restored.string("name")
    ):
        raise ValueError("Cleanup claim is not owned by this independent restore")
    if not restored.get("claimUid"):
        if claim is None:
            if isinstance(validation.get("copyCleanupIntent"), str):
                validation["copyRemoved"] = True
                control.save(path, journal)
            return
        if claim.object("status").get("phase") != "Pending":
            raise ValueError("Unrecorded validation claim is not Pending")
        # A failed restore may retain the ORIGINAL PV name in an unbound PVC.
        # Never derive a reclaim target from that field.
        requested_volume = claim.object("spec").get("volumeName")
        if requested_volume:
            requested = control.read("pv", claim.object("spec").string("volumeName"), "")
            if requested.object("spec").object("claimRef", {}).get("uid") == claim.object("metadata").string("uid"):
                raise ValueError("Unrecorded validation claim already owns native storage")
        no_consumers(control, None)
        validation["copyCleanupIntent"] = claim.object("metadata").string("uid")
        control.save(path, journal)
        delete_claim(control, claim)
        validation["copyRemoved"] = True
        control.save(path, journal)
        return
    if claim is None and validation.get("copyCleanupIntent") != restored.string("claimUid"):
        raise ValueError("Validation copy disappeared before its cleanup intent")
    volume_encoded = control.run(
        ["get", "pv", restored.string("volumeName"), "--ignore-not-found", "-o", "json"]
    ).strip()
    volume = JsonObject.parse(volume_encoded) if volume_encoded else None
    if (
        (
            claim is not None
            and (
                claim.object("metadata").get("uid") != restored.string("claimUid")
                or claim.object("spec").get("volumeName") != restored.string("volumeName")
            )
        )
        or (
            volume is not None
            and (
                volume.object("metadata").get("uid") != restored.string("volumeUid")
                or control.volume_source(volume) != restored.strings("volumeSource")
                or volume.object("metadata").strings("labels", {}).get("velero.io/restore-name")
                != restored.string("name")
                or volume.object("spec").object("claimRef")
                != {
                    **volume.object("spec").object("claimRef"),
                    "namespace": control.restored_namespace,
                    "name": control.CLAIM,
                    "uid": restored.string("claimUid"),
                }
            )
        )
        or restored.string("claimUid") == journal.string("claimUid")
        or restored.string("volumeUid") == journal.string("volumeUid")
        or restored.strings("volumeSource")["volumeHandle"] == journal.strings("volumeSource")["volumeHandle"]
        or restored.strings("volumeSource")["driver"] != "zfs.csi.openebs.io"
    ):
        raise ValueError("Cleanup target is not the exact independent restored copy")
    no_consumers(control, restored.string("volumeName"))
    handle = restored.strings("volumeSource")["volumeHandle"]
    native_encoded = control.run(
        ["-n", "openebs", "get", "zfsvolume", handle, "--ignore-not-found", "-o", "json"]
    ).strip()
    if native_encoded:
        native = JsonObject.parse(native_encoded)
        if (
            native.object("metadata").strings("labels", {}).get("velero.io/namespace") != control.restored_namespace
            or native.object("metadata").strings("labels", {}).get("velero.io/volname") != journal.string("volumeName")
            or native.object("metadata").strings("annotations", {}).get("velero.io/backup")
            != journal.object("backup").string("name")
            or validation.get("copyNativeVolumeUid", native.object("metadata").string("uid"))
            != native.object("metadata").string("uid")
        ):
            raise ValueError("Native validation volume identity changed")
        validation["copyNativeVolumeUid"] = native.object("metadata").string("uid")
    validation["copyCleanupIntent"] = restored.string("claimUid")
    control.save(path, journal)
    if volume is not None:
        policy = volume.object("spec").string("persistentVolumeReclaimPolicy")
        if policy not in ("Retain", "Delete"):
            raise ValueError("Unknown validation volume reclaim policy")
        if policy == "Retain":
            control.run(
                [
                    "patch",
                    "pv",
                    restored.string("volumeName"),
                    "--type=json",
                    "-p",
                    json.dumps(
                        [
                            {"op": "test", "path": "/metadata/uid", "value": restored.string("volumeUid")},
                            {
                                "op": "test",
                                "path": "/metadata/resourceVersion",
                                "value": volume.object("metadata").string("resourceVersion"),
                            },
                            {"op": "test", "path": "/spec", "value": volume.object("spec")},
                            {"op": "replace", "path": "/spec/persistentVolumeReclaimPolicy", "value": "Delete"},
                        ]
                    ),
                ]
            )
    if claim is not None:
        delete_claim(control, claim)
    control.run(["wait", "--for=delete", "pv/" + restored.string("volumeName"), "--timeout=120s"], 125)
    control.run(["-n", "openebs", "wait", "--for=delete", "zfsvolume/" + handle, "--timeout=120s"], 125)
    if (
        control.run(["get", "pv", restored.string("volumeName"), "--ignore-not-found", "-o", "json"]).strip()
        or control.run(["-n", "openebs", "get", "zfsvolume", handle, "--ignore-not-found", "-o", "json"]).strip()
    ):
        raise ValueError("Validation storage still exists after CSI reclaim")
    validation["copyRemoved"] = True
    control.save(path, journal)

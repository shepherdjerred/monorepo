#!/usr/bin/env python3
"""Produce real independent-restore evidence before a routine TSMC upgrade.

No historical install, world conversion, original-volume writer or blind image
rollback is reachable from this command. Failed/ambiguous helpers retain their
journal and the existing maintenance lease for explicit inspect/recover.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import time
from pathlib import Path
from types import ModuleType

import delivery_candidate
import delivery_recovery
import restoration_backup
from delivery_admission import reopen_unstopped
from delivery_cleanup import cleanup_copy
from delivery_receipt import validate_eligibility, validate_receipt
from restoration_json import JsonObject


def load_control() -> ModuleType:
    specification = importlib.util.spec_from_file_location(
        "restoration_control", Path(__file__).with_name("restoration-control.py")
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("The reviewed Storm restoration controller is unavailable")
    control = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(control)
    return control


def require_private_workspace(path: Path) -> None:
    directory = path.parent
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Validation journal requires an existing private directory")
    metadata = directory.stat()
    if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise ValueError("Validation directory must be owned by this executor and inaccessible to other users")


def eligibility(control: ModuleType) -> JsonObject:
    """Read-only admission check. A busy world remains running and untouched."""
    server = control.read("statefulset", control.SERVER)
    if server.object("spec").integer("replicas") not in (0, 1):
        raise ValueError("TSMC eligibility requires its reviewed single-server replica policy")
    annotations = server.object("metadata").strings("annotations", {})
    if any(key in annotations for key in (control.LEASE, control.MINING, control.PHASE, control.IMAGE)):
        return JsonObject({"status": "waiting", "reason": "maintenance-owner"})
    application = control.read("application", control.SERVER, "argocd")
    phase = application.object("status", {}).object("operationState", {}).get("phase")
    if phase in ("Running", "Terminating"):
        return JsonObject({"status": "waiting", "reason": "argocd-operation"})
    retained = control.run(
        ["-n", control.RESTORED_NAMESPACE, "get", "pvc", control.CLAIM, "--ignore-not-found", "-o", "json"]
    ).strip()
    if retained:
        return JsonObject({"status": "waiting", "reason": "validation-copy-retained"})
    for name in control.SERVICES:
        service = control.read("service", name)
        route_annotations = service.object("metadata").strings("annotations", {})
        if (
            control.LEASE in route_annotations
            or (name == control.SERVER and control.WAKE in route_annotations)
            or control.ACCESS in service.object("spec").strings("selector")
        ):
            return JsonObject({"status": "waiting", "reason": "admission-owner"})
    encoded = control.run(
        ["-n", control.NAMESPACE, "get", "pod", control.SERVER + "-0", "--ignore-not-found", "-o", "json"]
    ).strip()
    if server.object("spec").integer("replicas") == 0:
        return (
            JsonObject({"status": "waiting", "reason": "server-stopping"})
            if encoded
            else JsonObject({"status": "eligible", "players": 0})
        )
    if not encoded:
        return JsonObject({"status": "waiting", "reason": "server-starting"})
    pod = JsonObject.parse(encoded)
    statuses = pod.object("status", {}).objects("containerStatuses", [])
    if (
        pod.object("status").get("phase") != "Running"
        or not statuses
        or any(status.get("ready") is not True for status in statuses)
    ):
        return JsonObject({"status": "waiting", "reason": "server-starting"})
    output = control.run(
        [
            "-n",
            control.NAMESPACE,
            "exec",
            control.SERVER + "-0",
            "-c",
            control.SERVER,
            "--",
            "rcon-cli",
            "minecraft:list",
        ]
    )
    count = re.search(r"There are (\d+) of a max of \d+ players online", output)
    if count is None:
        raise ValueError("Maintenance eligibility lacks an authoritative player count")
    players = int(count[1])
    return (
        JsonObject({"status": "eligible", "players": 0})
        if players == 0
        else JsonObject({"status": "waiting", "reason": "players-online", "players": players})
    )


def wait_completed(control: ModuleType, path: Path, journal: JsonObject, stage: str) -> None:
    deadline = time.monotonic() + 1800
    action = control.backup if stage == "backup" else control.restore_backup
    while True:
        action(path, journal)
        if journal.object(stage).get("phase") == "Completed":
            return
        if time.monotonic() > deadline:
            raise ValueError("Stopped-volume " + stage + " exceeded its deadline; maintenance ownership retained")
        time.sleep(5)


def recover(control: ModuleType, path: Path, journal: JsonObject) -> None:
    """Stop only our copy's helper, then reopen only the untouched original."""
    if journal.get("productionWriteAuthorized") is not False:
        raise ValueError(
            "Routine validation cannot recover an authorized production writer; use the restoration procedure"
        )
    if journal.get("phase") in ("PREPARED", "CLOSING_ADMISSION", "ADMISSION_CLOSED"):
        if control.read("statefulset", control.SERVER).object("spec").integer("replicas") == 0:
            # Complete only this request's stopped admission lease, then use the
            # existing untouched-original abort. No backup or candidate starts.
            control.acquire(path, journal)
        else:
            reopen_unstopped(control, path, journal, wait=False)
            return
    delivery_candidate.delete_pod(control, journal)
    if journal.get("phase") != "REOPENED":
        control.remove_readers(path, journal)
    control.abort(path, journal)
    if journal.get("phase") != "REOPENED":
        raise ValueError("Original server was not safely reopened")


def receipt(journal: JsonObject) -> JsonObject:
    proof = restoration_backup.whole_proof(
        Path(journal.object("restore").string("proofPath")), journal.object("restore").string("proofSha256")
    )
    candidate = journal.object("deliveryCandidate")
    for path_key, hash_key in (("gameplayProofPath", "gameplaySha256"), ("startupProofPath", "startupLogSha256")):
        evidence = Path(candidate.string(path_key))
        if evidence.is_symlink() or hashlib.sha256(evidence.read_bytes()).hexdigest() != candidate.string(hash_key):
            raise ValueError("Candidate compatibility evidence changed after verification")
    abort = journal.object("preInstallAbort")
    abort_path = Path(abort.string("path"))
    if abort_path.is_symlink() or hashlib.sha256(abort_path.read_bytes()).hexdigest() != abort.string("sha256"):
        raise ValueError("Untouched-source reopening proof changed")
    untouched = JsonObject.parse(abort_path.read_bytes())
    if (
        journal.get("productionWriteAuthorized") is not False
        or journal.get("phase") != "REOPENED"
        or candidate.get("status") != "VERIFIED"
        or candidate.get("gracefulStop") is not True
        or untouched.get("status") != "NO_PRODUCTION_WRITE_AUTHORIZATION"
        or untouched.get("requestId") != journal.string("requestId")
        or untouched.get("serverUid") != journal.string("serverUid")
        or untouched.get("volumeUid") != journal.string("volumeUid")
        or untouched.get("rollbackImage") != journal.string("rollbackImage")
        or proof.string("requestId") != journal.string("requestId")
        or proof.string("backupUid") != journal.object("backup").string("uid")
        or proof.string("sourceVolumeUid") != journal.string("volumeUid")
        or proof.string("restoredVolumeUid") != journal.object("restore").string("volumeUid")
        or journal.object("restore").integer("files") != len(proof.strings("files"))
    ):
        raise ValueError(
            "Independent validation lacks exact completed preservation, candidate and untouched-source evidence"
        )
    return validate_receipt(
        JsonObject(
            {
                "schemaVersion": 1,
                "kind": "storm-independent-restore",
                "status": "VERIFIED",
                "requestId": journal.string("requestId"),
                "completedAt": candidate.string("verifiedAt"),
                "candidateImage": journal.string("candidateImage"),
                "sourceImage": journal.string("rollbackImage"),
                "serverUid": journal.string("serverUid"),
                "source": {
                    "claimUid": journal.string("claimUid"),
                    "volumeUid": journal.string("volumeUid"),
                    "volumeSource": journal.strings("volumeSource"),
                },
                "restored": {
                    "namespace": journal.object("deliveryValidation").string("restoreNamespace"),
                    "claimUid": journal.object("restore").string("claimUid"),
                    "volumeUid": journal.object("restore").string("volumeUid"),
                    "volumeSource": journal.object("restore").strings("volumeSource"),
                },
                "backupUid": journal.object("backup").string("uid"),
                "restoreUid": journal.object("restore").string("uid"),
                "wholeVolumeProofSha256": journal.object("restore").string("proofSha256"),
                "originalUntouchedProofSha256": abort.string("sha256"),
                "files": journal.object("restore").integer("files"),
                "candidate": {
                    key: candidate[key]
                    for key in (
                        "podUid",
                        "imageId",
                        "containerId",
                        "restartCount",
                        "gracefulStop",
                        "safeModules",
                        "gameplaySha256",
                        "startupLogSha256",
                    )
                },
                "originalUntouched": True,
                "originalReopened": True,
                "scope": "restored-copy-startup-and-citizens-gameplay; production acceptance is separate",
            }
        )
    )


def validate(control: ModuleType, path: Path, journal: JsonObject) -> JsonObject:
    if journal.object("deliveryValidation", {}).get("completedReceipt") is not None:
        # A stable existing receipt is read back, not fabricated from a new
        # time or a possibly mutated candidate copy after restart.
        prior = journal.object("deliveryValidation").object("completedReceipt")
        if prior.string("candidateImage") != journal.string("candidateImage"):
            raise ValueError("Completed receipt selected a different candidate")
        return validate_receipt(prior)
    if journal.object("deliveryCandidate", {}).get("status") != "VERIFIED":
        try:
            control.acquire(path, journal)
        except control.MaintenanceBusy:
            return reopen_unstopped(control, path, journal, wait=True)
        wait_completed(control, path, journal, "backup")
        wait_completed(control, path, journal, "restore")
        control.verify_backup(path, journal)
        control.remove_readers(path, journal)
        delivery_candidate.check_candidate(control, path, journal)
    recover(control, path, journal)
    result = receipt(journal)
    cleanup_copy(control, path, journal)
    journal.object("deliveryValidation")["completedReceipt"] = result
    control.save(path, journal)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("eligibility", "snapshot", "verify", "recover", "report"))
    parser.add_argument("--journal", type=Path)
    parser.add_argument("--request", required=True)
    parser.add_argument("--context", choices=("admin@torvalds", "delivery-tsmc-validation"), required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--runtime-digest", action="append", default=[])
    arguments = parser.parse_args()
    control = load_control()
    control.__dict__["CONTEXT"] = arguments.context
    control.__dict__["RESTORED_NAMESPACE"] = control.DELIVERY_VALIDATION_NAMESPACE
    if arguments.command == "eligibility":
        print(json.dumps(validate_eligibility(eligibility(control))))
        return
    if arguments.journal is None:
        raise ValueError("Preservation effects require their durable private journal")
    require_private_workspace(arguments.journal)
    if arguments.receipt is not None:
        require_private_workspace(arguments.receipt)
    if any(not re.fullmatch(r"sha256:[a-f0-9]{64}", digest) for digest in arguments.runtime_digest):
        raise ValueError("Runtime image digests must come from the exact candidate artifact manifest")
    # Source-owned namespace permits a narrowly scoped controller identity.
    # Its one restored claim is UID-fenced and removed after verified success.
    namespace = control.DELIVERY_VALIDATION_NAMESPACE
    control.__dict__["RESTORED_NAMESPACE"] = namespace
    with control.journal_lock(arguments.journal):
        if arguments.command == "report":
            if arguments.journal.is_symlink() or not arguments.journal.is_file():
                raise ValueError("Independent recovery report requires the original durable journal")
            journal = control.initialize(arguments.journal, arguments.request, arguments.image)
            if journal.object("deliveryValidation").get("runtimeDigests") != arguments.runtime_digest:
                raise ValueError("Recovery report candidate manifest differs from the original request")
            print(json.dumps(delivery_recovery.report(control, arguments.journal, journal)))
            return
        journal = control.initialize(arguments.journal, arguments.request, arguments.image)
        validation = journal.object("deliveryValidation", {})
        if validation.get("restoreNamespace", namespace) != namespace:
            raise ValueError("Validation restore namespace changed")
        validation["restoreNamespace"] = namespace
        current_namespace = control.read("namespace", namespace, "")
        namespace_uid = current_namespace.object("metadata").string("uid")
        if validation.get("restoreNamespaceUid", namespace_uid) != namespace_uid:
            raise ValueError("Source-owned validation namespace changed")
        validation["restoreNamespaceUid"] = namespace_uid
        journal["managedRestoreNamespace"] = True
        control.assert_managed_restore_namespace(journal)
        if validation.get("runtimeDigests", arguments.runtime_digest) != arguments.runtime_digest:
            raise ValueError("Candidate runtime manifest digests changed")
        validation["runtimeDigests"] = arguments.runtime_digest
        delivery_recovery.capture_source(control, arguments.journal, journal)
        control.save(arguments.journal, journal)
        if arguments.command == "snapshot":
            print(
                json.dumps(
                    {
                        "status": "PREPARED_SOURCE",
                        "requestId": arguments.request,
                        "journalSha256": hashlib.sha256(arguments.journal.read_bytes()).hexdigest(),
                    }
                )
            )
            return
        if arguments.command == "recover":
            recover(control, arguments.journal, journal)
            cleanup_copy(control, arguments.journal, journal)
            print(json.dumps(delivery_recovery.report(control, arguments.journal, journal)))
            return
        if arguments.receipt is None or arguments.receipt.resolve() == arguments.journal.resolve():
            raise ValueError("Verification requires a separate immutable receipt path")
        result = validate(control, arguments.journal, journal)
        if result.get("status") == "waiting":
            print(json.dumps(result))
            return
        if arguments.receipt.is_symlink():
            raise ValueError("Receipt cannot be a symlink")
        if arguments.receipt.exists() and JsonObject.parse(arguments.receipt.read_bytes()) != result:
            raise ValueError("Existing immutable validation receipt changed")
        control.save(arguments.receipt, result)
        print(
            json.dumps(
                {
                    "status": "VERIFIED",
                    "requestId": arguments.request,
                    "receiptSha256": hashlib.sha256(arguments.receipt.read_bytes()).hexdigest(),
                }
            )
        )


if __name__ == "__main__":
    main()

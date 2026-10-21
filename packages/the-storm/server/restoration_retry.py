"""Retain failed native copies and renew rollback proof in the empty managed target."""

from pathlib import Path
from types import ModuleType

from restoration_json import JsonObject


def renew_restore(control: ModuleType, path: Path, journal: JsonObject) -> str:
    control.require_offline(journal)
    if journal.get("productionWriteAuthorized") is not False or journal.get("readers"):
        raise ValueError("Renewal requires no authorized writer or retained reader")
    if journal.get("managedRestoreNamespace") or journal.get("retainedRestoreAttempts"):
        raise ValueError("Managed rollback renewal is allowed only once")
    previous = journal.object("restore")
    restore = control.read("restore", previous.string("name"), "velero")
    status = restore.object("status")
    if (
        restore.object("metadata").get("uid") != previous.string("uid")
        or restore.object("metadata").strings("labels").get(control.LEASE) != journal.string("requestId")
        or status.get("phase") not in ("Failed", "PartiallyFailed", "FailedValidation")
        or not status.get("completionTimestamp")
        or restore.object("spec").get("namespaceMapping") != {control.NAMESPACE: control.restored_namespace}
        or restore.object("spec").get("backupName") != journal.object("backup").string("name")
    ):
        raise ValueError("Renewal requires the exact owned terminal failed restore")
    backup = control.backup(path, journal)
    if backup.object("status").get("phase") != "Completed":
        raise ValueError("Renewal requires the exact completed source backup")
    target = control.DELIVERY_VALIDATION_NAMESPACE
    namespace = control.read("namespace", target, "")
    if namespace.object("metadata").strings("labels").get(control.DELIVERY_VALIDATION_LABEL) != control.SERVER:
        raise ValueError("Renewal target is not the source-owned validation namespace")
    inventory = JsonObject.parse(control.run(["-n", target, "get", "pods,pvc", "-o", "json"]))
    if inventory.objects("items"):
        raise ValueError("Renewal refuses any existing target pod or claim")
    attempt = journal.integer("backupAttempt") if "backupAttempt" in journal else 0
    restore_attempt = journal.integer("restoreAttempt") if "restoreAttempt" in journal else 0
    if not 0 <= attempt < 9 or not 0 <= restore_attempt < 9:
        raise ValueError("Rollback renewal retry limit reached")
    # No existing PVC, PV, namespace, backup, restore, or dataset is modified or deleted.
    journal["retainedRestoreAttempts"] = [
        {
            "namespace": control.restored_namespace,
            "backup": journal.object("backup"),
            "restore": {**previous, "phase": status.string("phase")},
        }
    ]
    journal.pop("restore")
    journal.pop("backup")
    journal["backupAttempt"] = attempt + 1
    journal["restoreAttempt"] = restore_attempt + 1
    journal["restoreNamespace"] = target
    journal["managedRestoreNamespace"] = True
    journal["deliveryValidation"] = {"restoreNamespaceUid": namespace.object("metadata").string("uid")}
    control.save(path, journal)
    control.backup(path, journal)
    return target

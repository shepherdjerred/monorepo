"""Defer an occupied server without leaving request-owned admission closed."""

from pathlib import Path
from types import ModuleType

from restoration_json import JsonObject


def reopen_unstopped(control: ModuleType, path: Path, journal: JsonObject, *, wait: bool) -> JsonObject:
    if journal.get("phase") not in ("PREPARED", "CLOSING_ADMISSION", "ADMISSION_CLOSED"):
        raise ValueError("Busy deferral cannot reopen a stopped or ambiguous maintenance operation")
    if journal.get("productionWriteAuthorized") is not False or journal.get("writerCreationPending"):
        raise ValueError("Busy deferral cannot reopen production writer authorization")
    server = control.read("statefulset", control.SERVER)
    control.assert_owner(server, journal, allow_unheld=True)
    annotations = server.object("metadata").strings("annotations", {})
    if (
        any(key in annotations for key in (control.LEASE, control.PHASE, control.IMAGE))
        or server.object("spec").integer("replicas") != 1
        or server.object("status").get("replicas") != 1
    ):
        raise ValueError("Busy deferral requires the unchanged running original without maintenance ownership")
    claim = control.read("pvc", control.CLAIM)
    volume = control.read("pv", journal.string("volumeName"), "")
    if (
        claim.object("metadata").get("uid") != journal.string("claimUid")
        or claim.object("spec").get("volumeName") != journal.string("volumeName")
        or volume.object("metadata").get("uid") != journal.string("volumeUid")
        or control.volume_source(volume) != journal.strings("volumeSource")
    ):
        raise ValueError("Original storage changed before busy deferral")
    control.assert_rollback_template(server, journal)
    # The existing helper checks source/image/template and every owned Service
    # identity, then reopens Java last. It never changes a running replica count.
    journal["phase"] = "RELEASING"
    control.save(path, journal)
    control.reopen(path, journal, journal.string("rollbackImage"), journal.object("rollbackTemplate"))
    journal["maintenanceDeferred"] = {"reason": "players-online", "originalReopened": True}
    if wait:
        journal["phase"] = "PREPARED"
    control.save(path, journal)
    return JsonObject({"status": "waiting", "reason": "players-online", "originalReopened": True})

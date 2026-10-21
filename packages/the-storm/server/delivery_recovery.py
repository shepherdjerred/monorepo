"""Fresh, read-only proof that routine validation relinquished the untouched original."""

import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType

from restoration_json import JsonObject

SCHEMA = JsonObject.parse(
    Path(__file__).resolve().parents[2].joinpath("ops-model/src/minecraft-delivery-recovery.schema.json").read_bytes()
)


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def validate(value: object, rule: JsonObject = SCHEMA) -> None:
    """Validate exactly the neutral contract's supported JSON Schema vocabulary."""
    if "const" in rule:
        if set(rule) != {"const"} or type(value) is not type(rule["const"]) or value != rule["const"]:
            raise ValueError("Recovery report constant differs from the neutral contract")
        return
    kind = rule.string("type")
    if kind == "object":
        if set(rule) - {"title", "type", "additionalProperties", "required", "properties"}:
            raise ValueError("Unhandled recovery object constraint")
        item = JsonObject.require(value)
        properties = rule.object("properties")
        if rule.get("additionalProperties") is not False or set(item) != set(rule.string_list("required")):
            raise ValueError("Recovery object fields differ from the neutral contract")
        for key in item:
            validate(item[key], properties.object(key))
    elif kind == "array":
        if set(rule) != {"type", "items", "minItems", "maxItems"} or not isinstance(value, list):
            raise ValueError("Unhandled recovery array constraint")
        if not rule.integer("minItems") <= len(value) <= rule.integer("maxItems"):
            raise ValueError("Recovery report has the wrong number of identities")
        for element in value:
            validate(element, rule.object("items"))
    elif kind == "integer":
        if set(rule) != {"type", "minimum", "maximum"} or not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("Unhandled recovery integer constraint")
        if not rule.integer("minimum") <= value <= rule.integer("maximum"):
            raise ValueError("Recovery source replica policy changed")
    elif kind == "string":
        if set(rule) - {"type", "minLength", "enum", "pattern", "format"} or not isinstance(value, str):
            raise ValueError("Unhandled recovery string constraint")
        minimum = rule.integer("minLength") if "minLength" in rule else 0
        if len(value) < minimum or ("enum" in rule and value not in rule.string_list("enum")):
            raise ValueError("Recovery report contains an invalid identity")
        if "pattern" in rule and re.search(rule.string("pattern"), value) is None:
            raise ValueError("Recovery report checksum or image is invalid")
        if rule.get("format") == "uuid" and str(uuid.UUID(value)) != value:
            raise ValueError("Recovery request UUID is not canonical")
        if rule.get("format") == "date-time" and datetime.fromisoformat(value).tzinfo is None:
            raise ValueError("Recovery observation lacks a timezone")
        if rule.get("format") not in (None, "uuid", "date-time"):
            raise ValueError("Unhandled recovery string format")
    else:
        raise ValueError("Unhandled recovery report schema type")


def application(control: ModuleType) -> JsonObject:
    current = control.read("application", control.SERVER, "argocd")
    phase = current.object("status", {}).object("operationState", {}).get("phase", "none")
    if current.get("operation") is not None or phase not in ("none", "Succeeded", "Failed", "Error"):
        raise ValueError("Recovery cannot settle an active or unknown Argo operation")
    source = current.object("spec").object("source")
    metadata = current.object("metadata")
    return JsonObject(
        {
            "uid": metadata.string("uid"),
            "resourceVersion": metadata.string("resourceVersion"),
            "sourceSha256": digest(source),
            "operationPhase": phase,
        }
    )


def capture_source(control: ModuleType, path: Path, journal: JsonObject) -> None:
    validation = journal.object("deliveryValidation")
    current = application(control)
    identity = {"uid": current.string("uid"), "sourceSha256": current.string("sourceSha256")}
    if "sourceApplication" not in validation:
        if journal.get("phase") != "PREPARED" or any(
            key in journal for key in ("backup", "restore", "deliveryCandidate")
        ):
            raise ValueError("An admitted maintenance journal lacks its original Argo source binding")
        validation["sourceApplication"] = identity
        control.save(path, journal)
    if validation.object("sourceApplication") != identity:
        raise ValueError("Argo source changed after the original preservation snapshot")


def inspect_source(control: ModuleType, journal: JsonObject) -> tuple[JsonObject, JsonObject]:
    server = control.read("statefulset", control.SERVER)
    control.assert_owner(server, journal, allow_unheld=True)
    control.assert_rollback_template(server, journal)
    if any(key in control.annotations(server) for key in (control.LEASE, control.PHASE, control.IMAGE, control.MINING)):
        raise ValueError("Original server still has maintenance ownership")
    claim = control.read("pvc", control.CLAIM)
    volume = control.read("pv", journal.string("volumeName"), "")
    if (
        claim.object("metadata").get("uid") != journal.string("claimUid")
        or claim.object("status").get("phase") != "Bound"
        or claim.object("spec").get("volumeName") != journal.string("volumeName")
        or volume.object("metadata").get("uid") != journal.string("volumeUid")
        or control.volume_source(volume) != journal.strings("volumeSource")
    ):
        raise ValueError("Original native claim or CSI volume changed before recovery settlement")
    source = JsonObject(
        {
            "serverUid": server.object("metadata").string("uid"),
            "resourceVersion": server.object("metadata").string("resourceVersion"),
            "templateSha256": digest(server.object("spec").object("template")),
            "image": control.server_image(server),
            "claimUid": claim.object("metadata").string("uid"),
            "claimResourceVersion": claim.object("metadata").string("resourceVersion"),
            "volumeName": journal.string("volumeName"),
            "volumeUid": volume.object("metadata").string("uid"),
            "volumeResourceVersion": volume.object("metadata").string("resourceVersion"),
            "volumeSource": control.volume_source(volume),
            "replicas": server.object("spec").integer("replicas"),
        }
    )
    return source, server


def inspect_routes(control: ModuleType, journal: JsonObject) -> list[JsonObject]:
    result: list[JsonObject] = []
    for name in control.SERVICES:
        current = control.read("service", name)
        expected = journal.object("services").object(name)
        annotations = control.annotations(current)
        if (
            current.object("metadata").get("uid") != expected.string("uid")
            or current.object("spec").strings("selector") != expected.strings("selector")
            or control.LEASE in annotations
            or (name == control.SERVER and control.WAKE in annotations)
        ):
            raise ValueError("Recovered route no longer has its original identity and selector")
        result.append(
            JsonObject(
                {
                    "name": name,
                    "uid": current.object("metadata").string("uid"),
                    "resourceVersion": current.object("metadata").string("resourceVersion"),
                    "selectorSha256": digest(current.object("spec").strings("selector")),
                }
            )
        )
    return result


def inspect_pods(control: ModuleType, journal: JsonObject, source: JsonObject) -> list[JsonObject]:
    result: list[JsonObject] = []
    for namespace in (control.NAMESPACE, control.restored_namespace):
        pods = JsonObject.parse(control.run(["-n", namespace, "get", "pods", "-o", "json"])).objects("items")
        for pod in pods:
            if pod.object("metadata").strings("labels", {}).get(control.LEASE) == journal.string("requestId"):
                raise ValueError("Request-owned candidate or reader still exists")
            mounts = any(
                v.object("persistentVolumeClaim", {}).get("claimName") == control.CLAIM
                for v in pod.object("spec").objects("volumes", [])
            )
            if not mounts:
                continue
            if namespace != control.NAMESPACE or pod.object("metadata").get("name") != control.SERVER + "-0":
                raise ValueError("An unreviewed Pod still mounts a protected Storm claim")
            owners = pod.object("metadata").objects("ownerReferences", [])
            if not any(
                o.get("kind") == "StatefulSet"
                and o.get("uid") == source.string("serverUid")
                and o.get("controller") is True
                for o in owners
            ):
                raise ValueError("Original server Pod no longer belongs to the recorded StatefulSet")
            container = next(
                (c for c in pod.object("spec").objects("containers") if c.get("name") == control.SERVER), None
            )
            if (
                container is None
                or container.get("image") != source.string("image")
                or pod.object("metadata").get("deletionTimestamp") is not None
            ):
                raise ValueError("Original server Pod changed image or is still stopping")
            result.append(
                JsonObject(
                    {
                        "uid": pod.object("metadata").string("uid"),
                        "resourceVersion": pod.object("metadata").string("resourceVersion"),
                        "image": container.string("image"),
                        "ownerUid": source.string("serverUid"),
                        "claimName": control.CLAIM,
                    }
                )
            )
    if len(result) != source.integer("replicas"):
        raise ValueError("Original server Pod count differs from its captured replica policy")
    return result


def report(control: ModuleType, path: Path, journal: JsonObject) -> JsonObject:
    if journal.get("phase") != "REOPENED" or journal.get("productionWriteAuthorized") is not False:
        raise ValueError("Only a reopened original without production write authorization can settle")
    if any(
        key in journal for key in ("writerUid", "installation", "wholeVolumeRecovery", "privateStartup", "acceptance")
    ):
        raise ValueError("Historical restoration requires its independent operator procedure")
    control.assert_managed_restore_namespace(journal)
    capture_source(control, path, journal)
    control.assert_gitops_image(journal, journal.string("rollbackImage"))
    source, _ = inspect_source(control, journal)
    routes = inspect_routes(control, journal)
    pods = inspect_pods(control, journal, source)
    if control.run(
        ["-n", control.restored_namespace, "get", "pvc", control.CLAIM, "--ignore-not-found", "-o", "json"]
    ).strip():
        raise ValueError("Independent restored copy has not been removed")
    app = application(control)
    # Fence concurrent wake/route/status/source changes across the read sequence.
    if (
        inspect_source(control, journal)[0] != source
        or inspect_routes(control, journal) != routes
        or inspect_pods(control, journal, source) != pods
        or application(control) != app
    ):
        raise ValueError("Original recovery bindings changed during independent readback")
    result = JsonObject(
        {
            "schemaVersion": 1,
            "kind": "storm-preselection-recovery",
            "requestId": journal.string("requestId"),
            "observedAt": datetime.now(UTC).isoformat(),
            "journalSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "phase": "REOPENED",
            "productionWriteAuthorized": False,
            "originalReopened": True,
            "helpersAbsent": True,
            "copyAbsent": True,
            "source": source,
            "pods": pods,
            "routes": routes,
            "application": app,
        }
    )
    validate(result)
    return result

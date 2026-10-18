"""Per-language receipt boundary checks against the neutral JSON Schema.

The producer constructs this evidence itself. This function is not an API for
qualifying arbitrary caller-authored evidence as a verified restore drill.
"""

import re
import uuid
from datetime import datetime
from pathlib import Path

from restoration_json import JsonObject

SCHEMA = JsonObject.parse(
    Path(__file__).resolve().parents[2].joinpath("homelab/src/minecraft-delivery-receipt.schema.json").read_bytes()
)
ELIGIBILITY = JsonObject.parse(
    Path(__file__).resolve().parents[2].joinpath("homelab/src/minecraft-delivery-eligibility.schema.json").read_bytes()
)


def validate_eligibility(value: JsonObject) -> JsonObject:
    branches = ELIGIBILITY.objects("oneOf")
    branch = next(
        (branch for branch in branches if branch.object("properties").object("status")["const"] == value.get("status")),
        None,
    )
    if branch is None:
        raise ValueError("Unknown neutral eligibility status")
    if not set(branch.string_list("required")).issubset(value) or set(value) - set(branch.object("properties")):
        raise ValueError("Eligibility fields differ from the neutral contract")
    if value.get("status") == "eligible":
        if value.integer("players") != branch.object("properties").object("players").integer("const"):
            raise ValueError("Eligible server must have zero players")
    else:
        if value.string("reason") not in branch.object("properties").object("reason").string_list("enum"):
            raise ValueError("Unknown neutral eligibility reason")
        if "players" in value and value.integer("players") < branch.object("properties").object("players").integer(
            "minimum"
        ):
            raise ValueError("Waiting player count must be positive")
    return value


def check_object(value: JsonObject, definition: JsonObject) -> None:
    """Check this fixed wire shape; unhandled schema changes fail loudly."""
    properties = definition.object("properties")
    if set(definition) - {"title", "type", "additionalProperties", "required", "properties"}:
        raise ValueError("Unhandled neutral receipt object constraint")
    if definition.get("type") != "object" or definition.get("additionalProperties") is not False:
        raise ValueError("Neutral receipt objects must reject unknown fields")
    if set(value) != set(definition.string_list("required")) or set(properties) != set(value):
        raise ValueError("Receipt fields differ from the neutral contract")
    for key, raw in properties.items():
        rule = JsonObject.require(raw)
        if "const" in rule:
            if set(rule) != {"const"}:
                raise ValueError("Unhandled neutral receipt constant constraint")
            if value[key] != rule["const"] or type(value[key]) is not type(rule["const"]):
                raise ValueError("Receipt constant changed: " + key)
            continue
        kind = rule.string("type")
        if kind == "object":
            check_object(value.object(key), rule)
        elif kind == "array":
            if set(rule) != {"type", "prefixItems", "items", "minItems", "maxItems"} or rule["items"] is not False:
                raise ValueError("Unhandled neutral receipt tuple constraint")
            expected = [item.string("const") for item in rule.objects("prefixItems")]
            if rule.integer("minItems") != len(expected) or rule.integer("maxItems") != len(expected):
                raise ValueError("Neutral receipt tuple must have one exact length")
            if value.string_list(key) != expected:
                raise ValueError("Receipt sandbox policy differs from the neutral contract")
        elif kind == "integer":
            if set(rule) != {"type", "minimum"}:
                raise ValueError("Unhandled neutral receipt integer constraint")
            if value.integer(key) < rule.integer("minimum"):
                raise ValueError("Receipt count is incomplete: " + key)
        elif kind == "string":
            if set(rule) - {"type", "minLength", "pattern", "format"} or rule.get("minLength", 1) != 1:
                raise ValueError("Unhandled neutral receipt string constraint")
            if rule.get("format") not in (None, "uuid", "date-time"):
                raise ValueError("Unhandled neutral receipt string format")
            item = value.string(key)
            if not item or ("pattern" in rule and not re.search(rule.string("pattern"), item)):
                raise ValueError("Receipt identifier or checksum is invalid: " + key)
            if rule.get("format") == "uuid" and str(uuid.UUID(item)) != item:
                raise ValueError("Receipt request ID is not canonical")
            if rule.get("format") == "date-time" and datetime.fromisoformat(item).tzinfo is None:
                raise ValueError("Receipt completion time lacks a timezone")
        else:
            raise ValueError("Unhandled neutral receipt type: " + kind)


def validate_receipt(value: JsonObject) -> JsonObject:
    check_object(value, SCHEMA)
    original = value.object("source")
    restored = value.object("restored")
    if (
        original.string("claimUid") == restored.string("claimUid")
        or original.string("volumeUid") == restored.string("volumeUid")
        or original.object("volumeSource").string("driver") != restored.object("volumeSource").string("driver")
        or original.object("volumeSource").string("volumeHandle")
        == restored.object("volumeSource").string("volumeHandle")
    ):
        raise ValueError("Receipt storage must be an independent native restore")
    return value

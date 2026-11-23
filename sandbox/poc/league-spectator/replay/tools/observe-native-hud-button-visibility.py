"""Execute original authored button-state transitions on owned UI interfaces.

Child IDs are explicitly pre-resolved to original scene-detached icon interfaces.
This does not replace or establish archive/scene namespace lookup, text shaping
or rendering. All visibility changes execute original native virtual methods.
"""
import argparse
import hashlib
import inspect
import json
import struct
from pathlib import Path

from unicorn import UC_HOOK_CODE
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager


def sha(value):
    return hashlib.sha256(value).hexdigest()


def field_hash(value):
    if value.startswith("{") and value.endswith("}"):
        return int(value[1:-1], 16)
    result = 0x811C9DC5
    for byte in value.lower().encode():
        result = ((result ^ byte) * 0x1000193) & 0xFFFFFFFF
    return result


parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "closure", "source", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
sources = {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)}
closure_bytes, source_bytes = args.closure.read_bytes(), args.source.read_bytes()
closure, source = json.loads(closure_bytes), json.loads(source_bytes)
if source["kind"] != "original-hud-group-button-state-source":
    raise ValueError("Original canonical button-state source required")
registration = next(row for row in source["regions"] if row["startRva"] == 0x18A7830)
offsets, name_hash, offset = {}, None, None
for op in registration["instructions"]:
    if op["op"] == "mov" and op["args"].startswith("esi, 0x"):
        name_hash = int(op["args"].split(", ")[1], 16)
    if op["op"] == "mov" and op["args"].startswith("edx, 0x"):
        offset = int(op["args"].split(", ")[1], 16)
    if op["op"] == "call" and op["args"] == "0x18a7ac0":
        if name_hash in offsets or offset not in range(0x38, 0x119, 0x20):
            raise ValueError("Original button-state field registration is ambiguous")
        offsets[name_hash] = offset
if len(offsets) != 8:
    raise ValueError("Eight original button-state fields required")
objects, input_sources = {}, {}
for filename, digest in closure["uiSourceFiles"].items():
    path = Path(filename)
    raw = path.read_bytes()
    if sha(raw) != digest:
        raise ValueError("Original normalized HUD input changed")
    data = json.loads(raw)
    original = path.with_suffix(".bin").read_bytes()
    source_sha = data["tree"]["sourceSha256"]
    if sha(original) != source_sha:
        raise ValueError("Original HUD BIN input changed")
    input_sources[str(path.resolve())] = digest
    input_sources[str(path.with_suffix(".bin").resolve())] = source_sha
    for key, value in data["normalized"].items():
        objects[(source_sha, key)] = value
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
if sha(n.image) != source["imageSha256"]:
    raise ValueError("Original button-state source image differs")
calls, owners = [], {}


def visibility_call(uc, address, size, user):
    owner = uc.reg_read(r.UC_X86_REG_RDI)
    if owner not in owners:
        raise ValueError("Original visibility transition escaped supplied child interfaces")
    value = uc.reg_read(r.UC_X86_REG_RSI)
    if value not in [0, 1]:
        raise ValueError("Original child visibility argument is not boolean")
    calls.append({"child": owners[owner], "visible": bool(value)})


hook = n.u.hook_add(UC_HOOK_CODE, visibility_call, begin=n.base + 0x18B10C0, end=n.base + 0x18B10C0)
observations = []
for (source_sha, key), authored in objects.items():
    if authored["__type"] != "UiElementGroupButtonData":
        continue
    row = {"sourceSha256": source_sha, "objectHash": key, "boundary": None}
    try:
        n.call(0x18A7C0A, {}, end=0x18A7C1F)
        button = n.u.reg_read(r.UC_X86_REG_R14)
        if n.allocations.get(button) != 0x1D0:
            raise ValueError("Original group-button constructor allocation changed")
        children = authored.get("elements", [])
        if len(children) != len(set(children)) or any((source_sha, child) not in objects for child in children):
            raise ValueError("Unique original button child identities required")
        child_owners = {}
        for child in children:
            n.call(0x18AAC10, {}, end=0x18AAC25)
            owner = n.u.reg_read(r.UC_X86_REG_RBX)
            if (n.allocations.get(owner) != 0x168 or n.q(owner) != n.base + 0x2402CF0
                    or n.q(n.q(owner) + 0x98) != n.base + 0x18B10C0):
                raise ValueError("Original owned icon visibility interface changed")
            child_owners[child] = owner
            owners[owner] = child
        states = [None] * 8
        for field, value in authored.items():
            if not isinstance(value, dict) or value.get("__type") != "UiElementGroupButtonState":
                continue
            source_offset = offsets.get(field_hash(field))
            if source_offset is None:
                raise ValueError("Unbound authored button-state field")
            slot = (source_offset - 0x38) // 0x20
            if states[slot] is not None or set(value) - {"__type", "DisplayElementList", "TextElement"}:
                raise ValueError("Unsupported or ambiguous original state fields")
            listing, text = value.get("DisplayElementList", []), value.get("TextElement")
            refs = [*listing, *([] if text is None else [text])]
            if any(child not in child_owners for child in refs):
                raise ValueError("Original button state refers outside supplied child collection")
            pointer = n.allocate(len(listing) * 8) if listing else 0
            for index, child in enumerate(listing):
                n.put(pointer + index * 8, "Q", child_owners[child])
            destination = button + 0x98 + slot * 0x20
            n.put(destination, "QII", pointer, len(listing), len(listing))
            if text is not None:
                n.put(destination + 0x10, "Q", child_owners[text])
            states[slot] = {"field": field, "sourceDataOffset": source_offset,
                "display": listing, "text": text}
        cases = []
        for old in range(8):
            for new in range(8):
                for owner in child_owners.values():
                    n.call(0x18B10C0, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: 0})
                n.put(button + 0x1C0, "B", old)
                n.call(0x18BCAC0, {r.UC_X86_REG_RDI: button, r.UC_X86_REG_RSI: old})
                calls.clear()
                n.call(0x18BCAC0, {r.UC_X86_REG_RDI: button, r.UC_X86_REG_RSI: new})
                actual = sorted(child for child, owner in child_owners.items()
                    if struct.unpack("<I", n.u.mem_read(owner + 0x20, 4))[0] & 1)
                selected = states[new]
                expected = [] if selected is None else sorted(set([*selected["display"],
                    *([] if selected["text"] is None else [selected["text"]])]))
                if actual != expected or n.u.mem_read(button + 0x1C0, 1)[0] != new:
                    raise ValueError("Original state transition does not match its authored child membership")
                cases.append({"from": old, "to": new, "visibleChildren": actual, "originalVisibilityCalls": list(calls)})
        row.update(states=states, cases=cases)
    except Exception as error:
        row["boundary"] = {"kind": type(error).__name__, "message": str(error),
            "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(row)
n.u.hook_del(hook)
for path, digest in {**sources, **input_sources}.items():
    if sha(Path(path).read_bytes()) != digest:
        raise ValueError("Button visibility source changed during execution: " + path)
if args.closure.read_bytes() != closure_bytes or args.source.read_bytes() != source_bytes:
    raise ValueError("Button visibility input receipts changed during execution")
report = {"schema": 1, "kind": "original-authored-button-visibility-controls", "imageSha256": sha(n.image),
    "sourceDiscoverySha256": sha(source_bytes), "closureSha256": sha(closure_bytes),
    "sources": sources, "inputSources": input_sources, "observations": observations,
    "originalBlocks": list(n.blocks.values()),
    "scope": "Original group-button constructor and complete native18bcac0 transitions through original child visibility virtuals; actual authored state lists use explicit pre-resolved scene-detached original icon interfaces, not reconstructed full child resource types; archive namespace lookup, native widget text/resources and live rendering remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
failures = [row for row in observations if row["boundary"]]
print(json.dumps({"output": str(args.output), "buttons": len(observations),
    "transitions": sum(len(row.get("cases", [])) for row in observations), "failures": failures}))
if failures:
    raise SystemExit(1)

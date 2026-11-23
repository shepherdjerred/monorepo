"""Locate exact original replay-event strings and controller registrations.

Only original instruction boundaries are retained. Candidates are not executed
event semantics or a live controller binding.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import capstone
from capstone.x86_const import X86_OP_MEM, X86_REG_RIP, X86_OP_IMM


def fnv(name):
    value = 0x811C9DC5
    for byte in name.lower().encode():
        value = ((value ^ byte) * 0x1000193) & 0xFFFFFFFF
    return value


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("controller", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
    raise ValueError("Exact original replay-control image required")
controller_bytes = args.controller.read_bytes()
controller = json.loads(controller_bytes)
if (controller["tree"]["sourceSha256"] != "a4ff9252c5fa63a214f131756fc7f53a4c1b99eff27598cce1d7c224a8ac9d40"
        or hashlib.sha256(args.controller.with_suffix(".bin").read_bytes()).hexdigest() != controller["tree"]["sourceSha256"]):
    raise ValueError("Original replay controller archive bytes changed")
definition = controller["normalized"]["{788bc62d}"]
names = sorted({value["HotkeyEventString"] for value in definition.values()
    if isinstance(value, dict) and value.get("__type") == "ReplayControlsButton"})
strings = {}
for name in names:
    positions, start = [], 0
    while True:
        at = image.find(name.encode() + b"\0", start)
        if at < 0:
            break
        positions.append(at)
        start = at + len(name) + 1
    if not positions:
        raise ValueError("Authored replay event string is absent from the original image")
    strings[name] = positions
targets = {at: name for name, positions in strings.items() for at in positions}
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True
functions = {}


def function_for(site):
    start = image.rfind(b"\x55\x48\x89\xe5", max(0x9000, site - 16384), site + 4)
    if start < 0:
        raise ValueError("Original replay reference lacks a bounded function prefix")
    if start not in functions:
        end = image.find(b"\x55\x48\x89\xe5", max(start + 4, site + 1), site + 16384)
        if end < 0:
            raise ValueError("Original replay reference lacks a bounded next prefix")
        functions[start] = {"start": start, "end": end,
            "sha256": hashlib.sha256(image[start:end]).hexdigest(),
            "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
                for op in decoder.disasm(image[start:end], start)]}
    return functions[start]


references = []
for end in range(0x9004, 0x1FEF000):
    target = end + struct.unpack_from("<i", image, end - 4)[0]
    if target not in targets:
        continue
    for start in range(max(0x9000, end - 12), end - 4):
        decoded = list(decoder.disasm(image[start:end], start))
        if len(decoded) != 1:
            continue
        op = decoded[0]
        if op.address + op.size != end or not any(operand.type == X86_OP_MEM
                and operand.mem.base == X86_REG_RIP
                and op.address + op.size + operand.mem.disp == target for operand in op.operands):
            continue
        function = function_for(start)
        if not any(item["rva"] == start for item in function["instructions"]):
            continue
        references.append({"event": targets[target], "stringRva": target, "rva": start,
            "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str, "functionStart": function["start"]})

registrations = []
for name in ["ReplayControlsViewController", "ReplayControlsButton", "HudReplaySlider", "HudReplaySliderData"]:
    key = fnv(name)
    for prefix in [b"\xbe", b"\xba", b"\xb9", b"\xbf", b"\x41\xb8", b"\x41\xb9"]:
        at = 0x9000
        while True:
            at = image.find(prefix + struct.pack("<I", key), at, 0x1FEF000)
            if at < 0:
                break
            function = function_for(at)
            canonical = next((item for item in function["instructions"] if item["rva"] == at), None)
            if canonical:
                decoded = list(decoder.disasm(bytes.fromhex(canonical["bytes"]), at))
                if any(operand.type == X86_OP_IMM and operand.imm & 0xFFFFFFFF == key for operand in decoded[0].operands):
                    callbacks = []
                    for item in function["instructions"]:
                        if item["rva"] >= at:
                            break
                        if item["op"] != "lea" or "[rip " not in item["args"]:
                            continue
                        encoded = bytes.fromhex(item["bytes"])
                        target = item["rva"] + len(encoded) + struct.unpack("<i", encoded[-4:])[0]
                        if not 0x9000 <= target < 0x1FEF000:
                            continue
                        callback = function_for(target)
                        callbacks.append({"register": item["args"].split(",")[0], "rva": target, "functionStart": callback["start"]})
                    registrations.append({"nameHint": name, "hash": f"{key:08x}", "rva": at,
                        "functionStart": function["start"], "callbacks": callbacks})
            at += len(prefix) + 4
function_for(0x594A70)
report = {"schema": 1, "kind": "original-replay-control-event-source-candidates", "imageSha256": digest,
    "controllerSha256": hashlib.sha256(controller_bytes).hexdigest(), "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "authoredButtons": {key: value for key, value in definition.items() if isinstance(value, dict) and value.get("__type") == "ReplayControlsButton"},
    "strings": strings, "references": references, "registrations": registrations, "functions": list(functions.values()),
    "scope": "Exact original authored event strings, RIP references and typed-registration candidates; event consumption, button state updates and seek/rate policy require execution"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "references": [{**row, "rva": hex(row["rva"]), "functionStart": hex(row["functionStart"])} for row in references],
    "registrations": [{**row, "rva": hex(row["rva"]), "functionStart": hex(row["functionStart"])} for row in registrations], "functions": len(functions)}))

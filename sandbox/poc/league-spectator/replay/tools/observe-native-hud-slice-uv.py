"""Execute original sliced UI provider programs over archived authored fields.

The four SSE values are explicit ABI controls. Their native caller units, the
loaded texture resolver and vertex assembly are not established by this probe.
"""
import argparse
import hashlib
import inspect
import json
import math
import struct
from pathlib import Path

from unicorn import x86_const as r
from ui_manager_native import NativeUiManager
from vfx_spawn_native import ADDRESSES


def sha(value):
    return hashlib.sha256(value).hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "inputs", "abi", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
source_paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
sources = {str(file.resolve()): sha(file.read_bytes()) for file in sorted(source_paths)}
input_bytes, abi_bytes = args.inputs.read_bytes(), args.abi.read_bytes()
inputs, abi = json.loads(input_bytes), json.loads(abi_bytes)
if (inputs["kind"] != "original-ui-image-provider-inputs"
        or inputs["build"] != "16.21.829.8620"
        or inputs["protocol"] != "20e09df23c66b85e"
        or abi["kind"] != "original-hud-sliced-provider-abi-observations"):
    raise ValueError("Original authored inputs and sliced-provider ABI proof required")
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
if sha(n.image) != abi["imageSha256"]:
    raise ValueError("Original sliced-provider ABI image differs")
types = {
    "AtlasData3SliceV": (0x18EF6A0, 0x18A2010, 0x40, 2, 8,
        [("TextureUs", 0x20, 2), ("TextureVs", 0x28, 4), ("TopBottomHeights", 0x38, 2)]),
    "AtlasData9Slice": (0x18EF820, 0x18A2190, 0x50, 3, 16,
        [("TextureUs", 0x20, 4), ("TextureVs", 0x30, 4),
         ("TopBottomHeights", 0x40, 2), ("LeftRightWidths", 0x48, 2)]),
}
owners = {}
for name, (factory, method, size, kind, border_bytes, fields) in types.items():
    proof = next(row for row in abi["observations"] if row["nameHint"] == name)
    if proof["boundary"] is not None:
        raise ValueError("Original sliced-provider ABI construction failed")
    n.call(factory, {})
    owner = n.u.reg_read(r.UC_X86_REG_RAX)
    defaults = bytes(n.u.mem_read(owner, size))
    if (n.allocations.get(owner) != size or n.q(n.q(owner) + 5 * 8) != n.base + method
            or defaults.hex() != proof["defaultsHex"]):
        raise ValueError("Original sliced-provider constructor/interface changed")
    n.call(n.q(n.q(owner) + 6 * 8) - n.base, {r.UC_X86_REG_RDI: owner})
    if n.u.reg_read(r.UC_X86_REG_RAX) != kind:
        raise ValueError("Original sliced-provider kind changed")
    owners[name] = (owner, defaults)

flag_at, texture_out, uv_out, border_out = 0x10001000, 0x10002000, 0x10003000, 0x10004000
controls = [[1, 1, 1920, 1080], [2, 0.75, 1280, 720],
            [0.5, 1.25, 3840, 2160], [1, 1, 80, 30]]
xmm = [r.UC_X86_REG_XMM0, r.UC_X86_REG_XMM1, r.UC_X86_REG_XMM2, r.UC_X86_REG_XMM3]
observations = []
for index, row in enumerate(inputs["providers"]):
    authored = row["original"]
    name = authored["__type"]
    if name not in types:
        continue
    factory, method, size, kind, border_bytes, fields = types[name]
    owner, defaults = owners[name]
    observation = {"inputIndex": index, "baseHash": row["baseHash"],
        "objectHash": row["objectHash"], "path": row["path"], "boundary": None}
    try:
        allowed = {"__type", "{f9721a78}", "{abb79fd0}", "{9f9705c7}", *[key for key, _, _ in fields]}
        if set(authored) - allowed:
            raise ValueError("Unbound authored sliced-provider field")
        n.u.mem_write(owner, defaults)
        for key, offset in [("{abb79fd0}", 0x10), ("{9f9705c7}", 0x14)]:
            if key in authored:
                value = authored[key]
                if type(value) is not int or not 0 <= value <= 0xFFFFFFFF:
                    raise ValueError("Invalid original sliced-provider resolution")
                n.put(owner + offset, "I", value)
        for key, offset, count in fields:
            if key not in authored:
                continue
            values = authored[key]
            if len(values) != count or any(type(value) not in [int, float] or not math.isfinite(value) for value in values):
                raise ValueError("Invalid original sliced-provider vector")
            n.put(owner + offset, f"{count}f", *values)
        if n.q(owner + 0x18) != 0:
            raise ValueError("Original explicit unloaded texture owner changed")
        cases = []
        for scalars in controls:
            for flags in [0, 0x40, 0x80, 0xC0]:
                n.put(flag_at, "I", flags)
                n.put(texture_out, "Q", 0)
                n.u.mem_write(uv_out, bytes([0xA5]) * 40)
                n.u.mem_write(border_out, bytes([0xA5]) * 24)
                for offset, pointer in [(8, texture_out), (16, uv_out), (24, border_out)]:
                    n.put(ADDRESSES["stack"] + offset, "Q", pointer)
                registers = {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: flag_at}
                registers.update({register: struct.unpack("<I", struct.pack("<f", value))[0]
                    for register, value in zip(xmm, scalars)})
                n.call(method, registers)
                uv = bytes(n.u.mem_read(uv_out, 32))
                border = bytes(n.u.mem_read(border_out, border_bytes))
                values = list(struct.unpack("<8f", uv)) + list(struct.unpack(f"<{border_bytes // 4}f", border))
                if (not all(math.isfinite(value) for value in values) or n.q(texture_out) != 0
                        or bytes(n.u.mem_read(uv_out + 32, 8)) != bytes([0xA5]) * 8
                        or bytes(n.u.mem_read(border_out + border_bytes, 8)) != bytes([0xA5]) * 8):
                    raise ValueError("Original sliced output escaped bounds, changed owner or became nonfinite")
                cases.append({"controlFlags": flags, "sseF32": scalars,
                    "uvHex": uv.hex(), "uvF32": values[:8],
                    "borderHex": border.hex(), "borderF32": values[8:]})
        observation.update(type=name, methodRva=method, providerKind=kind,
            sourceSha256=row["sourceSha256"], authoredOwnerHex=bytes(n.u.mem_read(owner, size)).hex(), cases=cases)
    except Exception as error:
        observation["boundary"] = {"kind": type(error).__name__, "message": str(error),
            "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(observation)
for path, digest in sources.items():
    if sha(Path(path).read_bytes()) != digest:
        raise ValueError("Sliced UV control source changed during execution: " + path)
report = {"schema": 1, "kind": "original-authored-hud-sliced-uv-controls", "imageSha256": sha(n.image),
    "inputsSha256": sha(input_bytes), "abiSha256": sha(abi_bytes), "observations": observations,
    "originalBlocks": list(n.blocks.values()),
    "sources": sources,
    "scope": "Original provider constructors and complete UV/border programs over archived fields; SSE controls are explicit, unloaded texture owner remains original null; native caller units, loaded resource post-load, vertex assembly and rendered slices remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
failures = [row for row in observations if row["boundary"]]
print(json.dumps({"output": str(args.output), "providers": len(observations),
    "controls": sum(len(row.get("cases", [])) for row in observations), "failures": failures}))
if failures:
    raise SystemExit(1)

"""Execute original AtlasData UV function over original authored UI-base inputs."""
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

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "inputs", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
raw = args.inputs.read_bytes()
inputs = json.loads(raw)
if inputs["kind"] != "original-ui-image-provider-inputs" or inputs["build"] != "16.21.829.8620" or inputs["protocol"] != "20e09df23c66b85e":
    raise ValueError("Original authored UI-base provider inputs required")
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
n.call(0x18ef3a0, {})
owner = n.u.reg_read(r.UC_X86_REG_RAX)
if n.allocations.get(owner) != 0x38 or n.q(owner) != n.base + 0x2404d18 or n.q(n.q(owner) + 5 * 8) != n.base + 0x18a1c70:
    raise ValueError("Original AtlasData constructor/UV interface changed")
defaults = bytes(n.u.mem_read(owner, 0x38))
flag_at, texture_out, uv_out = 0x10001000, 0x10002000, 0x10003000
observations = []
for index, row in enumerate(inputs["providers"]):
    authored = row["original"]
    if authored["__type"] != "AtlasData": continue
    observation = {"inputIndex": index, "objectHash": row["objectHash"], "path": row["path"], "boundary": None}
    try:
        allowed = {"__type", "{f9721a78}", "{abb79fd0}", "{9f9705c7}", "mTextureUV"}
        if set(authored) - allowed: raise ValueError("Unbound authored AtlasData field")
        n.u.mem_write(owner, defaults)
        for key, offset in [("{abb79fd0}", 0x10), ("{9f9705c7}", 0x14)]:
            if key in authored:
                value = authored[key]
                if type(value) is not int or not 0 <= value <= 0xffffffff: raise ValueError("Invalid original source resolution")
                n.put(owner + offset, "I", value)
        if "mTextureUV" in authored:
            values = authored["mTextureUV"]
            if len(values) != 4 or any(type(value) not in [int, float] or not math.isfinite(value) for value in values):
                raise ValueError("Invalid original authored UV vector")
            n.put(owner + 0x28, "4f", *values)
        cases = []
        for flags in [0, 0x40, 0x80, 0xc0]:
            n.put(flag_at, "I", flags)
            n.put(texture_out, "Q", 0)
            n.put(ADDRESSES["stack"] + 8, "Q", texture_out)
            n.put(ADDRESSES["stack"] + 16, "Q", uv_out)
            n.call(0x18a1c70, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: flag_at,
                r.UC_X86_REG_RDX: row["image"]["width"], r.UC_X86_REG_RCX: row["image"]["height"],
                r.UC_X86_REG_R8: row["image"]["width"], r.UC_X86_REG_R9: row["image"]["height"]})
            uv = bytes(n.u.mem_read(uv_out, 16))
            values = list(struct.unpack("<4f", uv))
            if not all(math.isfinite(value) for value in values) or n.q(texture_out) != 0:
                raise ValueError("Original UV control produced nonfinite values or changed its explicit unloaded texture owner")
            cases.append({"controlFlags": flags, "uvHex": uv.hex(), "uvF32": values})
        observation["cases"] = cases
    except Exception as error:
        observation["boundary"] = {"kind": type(error).__name__, "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(observation)
sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-authored-hud-atlas-uv-controls", "imageSha256": hashlib.sha256(n.image).hexdigest(),
    "inputsSha256": hashlib.sha256(raw).hexdigest(), "constructorRva": 0x18ef3a0, "uvFunctionRva": 0x18a1c70,
    "defaultsHex": defaults.hex(), "observations": observations, "originalBlocks": list(n.blocks.values()),
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Original authored AtlasData UV conversion with explicit zero/flip control bits and original unloaded texture owner; runtime flag bindings, image-atlas UV composition, sliced providers and rendered HUD remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
failures = [row for row in observations if row["boundary"]]
print(json.dumps({"output": str(args.output), "providers": len(observations), "controls": sum(len(row.get("cases", [])) for row in observations), "failures": failures[:5]}))
if failures: raise SystemExit(1)

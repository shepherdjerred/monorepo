"""Execute the original icon/provider caller with source position ownership.

Root parent, viewport and flip flags are controlled inputs. This establishes
the original aspect/scale ABI and output ownership, not vertex assembly or
live controller visibility.
"""
import argparse
import hashlib
import inspect
import json
import math
import struct
from pathlib import Path

from unicorn import UC_HOOK_CODE
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager


def sha(value):
    return hashlib.sha256(value).hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "inputs", "rectangles", "defaults", "anchors", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
source_paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
sources = {str(file.resolve()): sha(file.read_bytes()) for file in sorted(source_paths)}
blobs = {key: getattr(args, key).read_bytes() for key in ["inputs", "rectangles", "defaults", "anchors"]}
inputs, rectangles, defaults, anchors = [json.loads(blobs[key]) for key in ["inputs", "rectangles", "defaults", "anchors"]]
if (inputs["kind"] != "original-ui-image-provider-inputs"
        or rectangles["defaultsSha256"] != sha(blobs["defaults"])):
    raise ValueError("Source-bound original provider/rectangle inputs required")
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
if any(proof["imageSha256"] != sha(n.image) for proof in [rectangles, defaults, anchors]):
    raise ValueError("Shared original UI image required")
position_ctor = next(row["placementConstructorRva"] for row in defaults["observations"] if row["classHint"] == "UiPositionRect")
rect_defaults = next(row["registeredFields"] for row in defaults["observations"] if row["classHint"] == "UiElementRect")
anchor_ctors = {row["nameHint"]: row["constructorRva"] for row in anchors["observations"]}
# The original icon factory's allocation and complete runtime constructor.
# Stop before external element registration, not inside the constructor.
n.call(0x18AAC10, {}, end=0x18AAC25)
icon = n.u.reg_read(r.UC_X86_REG_RBX)
if n.allocations.get(icon) != 0x168 or n.q(icon) != n.base + 0x2402CF0:
    raise ValueError("Original icon runtime ownership changed")
icon_defaults = bytes(n.u.mem_read(icon, 0x168))
manager = 0x10100000
n.construct_layout_manager(manager)
position, anchor_at = 0x10080000, 0x10090000
types = {
    "AtlasData3SliceV": (0x18EF6A0, 0x18A2010, 0x40, 2, 8,
        [("TextureUs", 0x20, 2), ("TextureVs", 0x28, 4), ("TopBottomHeights", 0x38, 2)]),
    "AtlasData9Slice": (0x18EF820, 0x18A2190, 0x50, 3, 16,
        [("TextureUs", 0x20, 4), ("TextureVs", 0x30, 4),
         ("TopBottomHeights", 0x40, 2), ("LeftRightWidths", 0x48, 2)]),
}
captures = []


def capture(uc, address, size, user):
    captures.append({"sseHex": [int(uc.reg_read(reg)).to_bytes(16, "little")[:4].hex()
        for reg in [r.UC_X86_REG_XMM0, r.UC_X86_REG_XMM1, r.UC_X86_REG_XMM2, r.UC_X86_REG_XMM3]],
        "integerArguments": [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDX, r.UC_X86_REG_RCX, r.UC_X86_REG_R8, r.UC_X86_REG_R9]]})


hook = n.u.hook_add(UC_HOOK_CODE, capture, begin=n.base + 0x18B1648, end=n.base + 0x18B1648)
observations = []
for index, row in enumerate(inputs["providers"]):
    authored = row["original"]
    name = authored["__type"]
    if name not in types:
        continue
    observation = {"inputIndex": index, "objectHash": row["objectHash"], "boundary": None}
    try:
        matching = [item for item in rectangles["observations"]
            if item["sourceSha256"] == row["sourceSha256"] and item["objectHash"] == row["objectHash"]]
        if len(matching) != 1:
            raise ValueError("Unique original icon position required")
        item = matching[0]
        value, rect = item["authoredPosition"], item["authored"]
        if set(value) - {"__type", "UIRect", "Anchors", "IgnoreGlobalScale", "DisablePixelSnappingX", "DisablePixelSnappingY", "DisableResolutionDownscale"}:
            raise ValueError("Unbound original position field")
        n.u.mem_write(icon, icon_defaults)
        n.call(position_ctor, {r.UC_X86_REG_RDI: position})
        n.put(position + 0x10, "4f", *rect.get("position", rect_defaults["position"]), *rect.get("Size", rect_defaults["size"]))
        n.put(position + 0x20, "HH", rect.get("SourceResolutionWidth", rect_defaults["sourceResolutionWidth"]),
            rect.get("SourceResolutionHeight", rect_defaults["sourceResolutionHeight"]))
        anchor = value.get("Anchors")
        if anchor is not None:
            kind = anchor["__type"]
            n.call(anchor_ctors[kind], {r.UC_X86_REG_RDI: anchor_at})
            if kind == "AnchorSingle":
                if set(anchor) - {"__type", "Anchor"}:
                    raise ValueError("Unbound original single-anchor input")
                if "Anchor" in anchor:
                    n.put(anchor_at + 8, "2f", *anchor["Anchor"])
            elif set(anchor) != {"__type"}:
                raise ValueError("Original selector/double-anchor overrides require binding")
            n.put(position + 0x28, "Q", anchor_at)
        for key, offset in [("IgnoreGlobalScale", 0x30), ("DisablePixelSnappingX", 0x31),
                ("DisablePixelSnappingY", 0x32), ("DisableResolutionDownscale", 0x33)]:
            if key in value:
                if type(value[key]) is not bool:
                    raise ValueError("Original position flag must be boolean")
                n.put(position + offset, "B", int(value[key]))
        n.call(0x18B0120, {r.UC_X86_REG_RDI: icon + 0x58, r.UC_X86_REG_RSI: position, r.UC_X86_REG_RDX: icon + 0x20})
        initialized_icon = bytes(n.u.mem_read(icon, 0x168))
        factory, method, size, kind, border_bytes, fields = types[name]
        n.call(factory, {})
        provider = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(provider) != size or n.q(n.q(provider) + 40) != n.base + method:
            raise ValueError("Original source sliced-provider factory changed")
        for key, offset in [("{abb79fd0}", 0x10), ("{9f9705c7}", 0x14)]:
            if key in authored:
                n.put(provider + offset, "I", authored[key])
        for key, offset, count in fields:
            if key in authored:
                n.put(provider + offset, f"{count}f", *authored[key])
        cases = []
        for width, height in [(1600, 1200), (1920, 1080), (1280, 720), (800, 600)]:
            for flags in [0, 0x40, 0x80, 0xC0]:
                n.u.mem_write(icon, initialized_icon)
                n.put(manager + 0xE8, "II", width, height)
                original_flags = struct.unpack("<I", n.u.mem_read(icon + 0x20, 4))[0]
                n.put(icon + 0x20, "I", original_flags & ~0xC0 | flags)
                before = len(captures)
                n.call(0x18B1510, {r.UC_X86_REG_RDI: icon, r.UC_X86_REG_RSI: provider,
                    r.UC_X86_REG_RDX: int(rect["Size"][0]), r.UC_X86_REG_RCX: int(rect["Size"][1])})
                if len(captures) != before + 1 or n.u.mem_read(icon + 0x108, 1)[0] != kind or n.q(icon + 0x100) != 0:
                    raise ValueError("Original caller did not own exactly one unloaded provider invocation")
                uv = bytes(n.u.mem_read(icon + 0x10C, 32))
                border = bytes(n.u.mem_read(icon + 0x12C, border_bytes))
                values = list(struct.unpack("<8f", uv)) + list(struct.unpack(f"<{border_bytes // 4}f", border))
                if not all(math.isfinite(number) for number in values):
                    raise ValueError("Original caller produced nonfinite sliced outputs")
                cases.append({"suppliedViewport": [width, height], "controlFlags": flags,
                    **captures[-1], "uvHex": uv.hex(), "borderHex": border.hex()})
        observation.update(type=name, sourceSha256=row["sourceSha256"], sourcePosition=value,
            initializedIconHex=initialized_icon.hex(), cases=cases)
    except Exception as error:
        observation["boundary"] = {"kind": type(error).__name__, "message": str(error),
            "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(observation)
n.u.hook_del(hook)
for path, digest in sources.items():
    if sha(Path(path).read_bytes()) != digest:
        raise ValueError("Sliced caller control source changed during execution: " + path)
report = {"schema": 1, "kind": "original-hud-sliced-provider-caller-controls", "imageSha256": sha(n.image),
    "inputs": {key: sha(blob) for key, blob in blobs.items()}, "observations": observations,
    "originalBlocks": list(n.blocks.values()),
    "sources": sources,
    "scope": "Original icon allocation/complete constructor, authored position initialization, original UI manager/default settings and complete 18b1510 provider caller; viewport/flip controls and null resource owner are explicit; native vertex assembly/live visibility remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
failures = [row for row in observations if row["boundary"]]
print(json.dumps({"output": str(args.output), "providers": len(observations),
    "controls": sum(len(row.get("cases", [])) for row in observations), "failures": failures}))
if failures:
    raise SystemExit(1)

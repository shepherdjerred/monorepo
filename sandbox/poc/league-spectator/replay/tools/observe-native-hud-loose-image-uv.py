"""Execute original UI image ownership and LooseUiTextureData UV composition.

The owned texture header is a CPU control input, never a substitute GPU texture.
Archived atlas rows supply their original UV bytes. Live resource post-load,
controller flag production and rendering remain separate boundaries.
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
for name in ["assets", "client", "inputs", "atlases", "textures", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
input_bytes, atlas_bytes, texture_bytes = args.inputs.read_bytes(), args.atlases.read_bytes(), args.textures.read_bytes()
inputs, atlases, textures = json.loads(input_bytes), json.loads(atlas_bytes), json.loads(texture_bytes)
if inputs["kind"] != "original-ui-image-provider-inputs" or atlases["kind"] != "original-archived-image-atlas-reader-observations":
    raise ValueError("Original authored UI and executed atlas-reader observations required")
rows = {
    (observation["reference"], index): (observation, row)
    for observation in atlases["observations"]
    if observation["boundary"] is None
    for index, row in enumerate(observation["imageRecords"])
}
texture_map = {row["reference"]: row for row in textures["textures"]}
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
# Original allocation, complete category-owner constructor and global store.
# Its +0x18 default category is subsequently consumed by the image constructor.
n.call(0x665F24, {}, end=0x665F40)
category_owner = n.q(n.base + 0x24712C8)
if n.allocations.get(category_owner) != 0x20 or not n.q(category_owner + 0x18):
    raise ValueError("Original UI image category owner was not initialized")
category_default = n.q(category_owner + 0x18)
n.call(0x18EF9F0, {})
provider = n.u.reg_read(r.UC_X86_REG_RAX)
if n.allocations.get(provider) != 0x20:
    raise ValueError("Original LooseUiTextureData allocation changed")
provider_defaults = bytes(n.u.mem_read(provider, 0x20))
if n.q(n.q(provider) + 5 * 8) != n.base + 0x18A2400:
    raise ValueError("Original loose-image UV virtual method changed")

frame, flag_at, texture_out, uv_out = 0x10030000, 0x10001000, 0x10002000, 0x10003000
observations = []
for index, item in enumerate(inputs["providers"]):
    if item["original"]["__type"] != "LooseUiTextureData":
        continue
    result = {"inputIndex": index, "objectHash": item["objectHash"], "path": item["path"], "boundary": None}
    try:
        image = item["image"]
        if set(item["original"]) != {"__type", "{b311d4ef}"} or item["original"]["{b311d4ef}"]["value"] != image["reference"]:
            raise ValueError("Unbound original loose-image provider fields")
        atlas, row = rows[(image["atlas"]["reference"], image["atlas"]["rowIndex"])]
        if (atlas["source"]["sha256"] != image["atlas"]["sourceSha256"]
                or row["key64"] != image["reference"]
                or row["indexedHeaderWord64"] != image["texture"]
                or bytes.fromhex(image["atlas"]["uvHex"]) != struct.pack("<4f", *row["valuesF32"])):
            raise ValueError("Original selected image-atlas row changed")
        texture = texture_map[image["texture"]]
        raw, png = Path(texture["raw"]).read_bytes(), Path(texture["file"]).read_bytes()
        width, height = image["width"], image["height"]
        if (sha(raw) != image["sourceSha256"] or sha(raw) != texture["sourceSha256"]
                or sha(png) != texture["pngSha256"] or raw[:3] != b"TEX"
                or struct.unpack_from(">II", png, 16) != (width, height)
                or not 0 < width <= 0xFFFF or not 0 < height <= 0xFFFF):
            raise ValueError("Original decoded texture dimension/source lineage changed")
        header = n.allocate(0x28, 0xA5)
        n.put(ADDRESSES["stack"] + 8, "Q", 1)
        n.put(ADDRESSES["stack"] + 16, "Q", 1)
        n.call(0x19175E0, {r.UC_X86_REG_RDI: header, r.UC_X86_REG_RSI: 0,
            r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: 2,
            r.UC_X86_REG_R8: width, r.UC_X86_REG_R9: height})
        key_at, view_key_at, uv_at = n.allocate(8), n.allocate(8), n.allocate(16)
        n.put(key_at, "Q", int(image["texture"]))
        n.put(view_key_at, "Q", int(image["reference"]))
        n.u.mem_write(uv_at, bytes.fromhex(image["atlas"]["uvHex"]))
        n.put(frame - 0x50, "Q", header)
        n.put(frame - 0x48, "Q", category_default)
        # Original first-registration wrapper allocation and complete stores,
        # stopped before insertion into the external texture cache.
        n.call(0x17DEC2C, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_R15: key_at}, end=0x17DEC85)
        wrapper = n.u.reg_read(r.UC_X86_REG_R14)
        if n.allocations.get(wrapper) != 0x30 or n.q(wrapper + 0x28) != header:
            raise ValueError("Original texture wrapper/header binding changed")
        n.put(frame - 0x50, "Q", uv_at)
        n.put(frame - 0x48, "Q", 0)
        # Original image-view allocation and complete constructor stores.
        n.call(0x17E396F, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_R13: view_key_at,
            r.UC_X86_REG_R14: wrapper}, end=0x17E39D1)
        view = n.u.reg_read(r.UC_X86_REG_RBX)
        if (n.allocations.get(view) != 0x48 or n.q(view + 0x28) != wrapper
                or n.q(view + 0x10) != category_default or n.q(view + 8) != int(image["reference"])):
            raise ValueError("Original image-view owner chain changed")
        info_method = n.q(n.q(view) + 8) - n.base
        n.call(info_method, {r.UC_X86_REG_RDI: view})
        info = n.u.reg_read(r.UC_X86_REG_RAX)
        if struct.unpack("<HH", n.u.mem_read(info + 8, 4)) != (width, height):
            raise ValueError("Original image-view info virtual did not return its constructed texture dimensions")
        n.u.mem_write(provider, provider_defaults)
        # The source method consumes the explicitly owned, resolved view here;
        # execution of the original hashed-resource post-load remains unclaimed.
        n.put(provider + 0x10, "Q", view)
        cases = []
        for flags in [0, 0x40, 0x80, 0xC0]:
            n.put(flag_at, "I", flags)
            n.put(texture_out, "Q", 0)
            n.put(ADDRESSES["stack"] + 8, "Q", texture_out)
            n.put(ADDRESSES["stack"] + 16, "Q", uv_out)
            n.call(0x18A2400, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: flag_at,
                r.UC_X86_REG_RDX: width, r.UC_X86_REG_RCX: height,
                r.UC_X86_REG_R8: width, r.UC_X86_REG_R9: height})
            uv = bytes(n.u.mem_read(uv_out, 16))
            values = list(struct.unpack("<4f", uv))
            if not all(math.isfinite(value) for value in values) or n.q(texture_out) != wrapper:
                raise ValueError("Original loose-image UV output lost its owned texture or became nonfinite")
            cases.append({"controlFlags": flags, "uvHex": uv.hex(), "uvF32": values})
        result.update(texture=image["texture"], width=width, height=height,
            atlasSourceSha256=atlas["source"]["sha256"], originalAtlasUvHex=image["atlas"]["uvHex"],
            imageInfoMethodRva=info_method, imageInfoIsHeader=info == header,
            headerHex=bytes(n.u.mem_read(header, 0x11)).hex(), cases=cases)
    except Exception as error:
        result["boundary"] = {"kind": type(error).__name__, "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(result)
sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-hud-loose-image-uv-controls", "imageSha256": sha(n.image),
    "inputsSha256": sha(input_bytes), "atlasObservationsSha256": sha(atlas_bytes), "texturesSha256": sha(texture_bytes),
    "categoryOwnerDefaultsHex": bytes(n.u.mem_read(category_owner, 0x20)).hex(),
    "observations": observations, "originalBlocks": list(n.blocks.values()),
    "sources": {str(file.resolve()): sha(file.read_bytes()) for file in sorted(sources)},
    "scope": "Original category owner, texture header/wrapper and image-view construction plus LooseUiTextureData UV composition over actual archived atlas rows; CPU header controls are not GPU uploads, original hashed-resource post-load/controller bindings and rendered HUD remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
failures = [row for row in observations if row["boundary"]]
print(json.dumps({"output": str(args.output), "providers": len(observations), "controls": sum(len(row.get("cases", [])) for row in observations), "failures": failures}))
if failures:
    raise SystemExit(1)

"""Recover exact image-provider registrations, constructor candidates and authored field offsets."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7": raise ValueError("Exact original image-provider image required")
names = ["IUiTextureDataProvider", "AtlasDataBase", "AtlasData", "AtlasData3SliceH", "AtlasData3SliceV", "AtlasData9Slice", "LooseUiTextureDataBase", "LooseUiTextureData", "UiElementIconData", "mTextureName", "mTextureSourceResolutionWidth", "mTextureSourceResolutionHeight", "mTextureUV", "TextureData", "textureName", "FlipX", "FlipY", "UseAlpha", "PerPixelUvsX", "PerPixelUvsY"]
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
def instructions(start, end):
    return [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str} for op in decoder.disasm(image[start:end], start)]
registrations = []
for name in names:
    key = 0x811c9dc5
    for byte in name.lower().encode(): key = ((key ^ byte) * 0x1000193) & 0xffffffff
    candidates = []
    for prefix in [b"\xbe", b"\xba", b"\xb9", b"\xbf", b"\x41\xb8"]:
        at = 0
        while True:
            at = image.find(prefix + struct.pack("<I", key), at)
            if at < 0: break
            start = image.rfind(b"\x55\x48\x89\xe5", max(0x9000, at - 16384), at)
            if start >= 0:
                callbacks = []
                for op in decoder.disasm(image[max(start, at - 128):at], max(start, at - 128)):
                    if op.mnemonic == "lea" and "[rip " in op.op_str:
                        target = op.address + op.size + struct.unpack("<i", op.bytes[-4:])[0]
                        callbacks.append({"register": op.op_str.split(",")[0], "rva": target, "instructions": instructions(target, target + 256)})
                candidates.append({"rva": at, "functionStart": start, "prefix": instructions(start, at), "suffix": instructions(at, at + 128), "callbacks": callbacks})
            at += len(prefix) + 4
    registrations.append({"nameHint": name, "hash": f"{key:08x}", "candidates": candidates})
report = {"schema": 1, "kind": "original-ui-image-registration-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "registrations": registrations,
    "scope": "Original native registration candidates only; data constructors, provider instantiation, defaults and authored UV operations require execution"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "classesAndFields": [{"name": row["nameHint"], "candidates": len(row["candidates"])} for row in registrations]}))

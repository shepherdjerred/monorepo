"""Locate original UI field registration instructions without inventing defaults."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image_path = args.assets / "decoder-16.21-macos/image.bin"
image = image_path.read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
    raise ValueError("Exact approved native 16.21 image required")
names = ["UiPositionRect", "UiElementRect", "AnchorSingle", "AnchorDouble", "{f090d2e7}", "Anchors", "UIRect", "Anchor", "anchorLeft", "anchorRight", "SourceResolutionWidth", "SourceResolutionHeight", "IgnoreGlobalScale", "DisablePixelSnappingY", "DisablePixelSnappingX", "DisableResolutionDownscale", "GameFontDescription", "FontResolutionData", "FontDescription", "TextAlignmentHorizontal", "TextAlignmentVertical"]
def name_hash(name):
    if name.startswith("{") and name.endswith("}"): return int(name[1:-1], 16)
    value = 0x811c9dc5
    for byte in name.lower().encode():
        value = ((value ^ byte) * 0x1000193) & 0xffffffff
    return value
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
results = []
for name in names:
    key = name_hash(name)
    locations = []
    for prefix, register in [(b"\xbe", "esi"), (b"\xba", "edx"), (b"\xb9", "ecx"), (b"\xbf", "edi"), (b"\x41\xb8", "r8d")]:
        pattern = prefix + struct.pack("<I", key)
        at = 0
        while True:
            at = image.find(pattern, at)
            if at < 0: break
            instructions = [{"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str} for item in decoder.disasm(image[at:at + 128], at)]
            prologue = image.rfind(b"\x55\x48\x89\xe5", max(0, at - 16384), at)
            prefix_native = [] if prologue < 0 else list(decoder.disasm(image[prologue:at], prologue))
            prefix_instructions = [{"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str} for item in prefix_native]
            callbacks = []
            if name in ["UiPositionRect", "UiElementRect", "GameFontDescription", "AnchorSingle", "AnchorDouble", "{f090d2e7}"]:
                for item in prefix_native:
                    if item.address >= at - 96 and item.mnemonic == "lea" and "[rip " in item.op_str:
                        target = item.address + item.size + struct.unpack("<i", item.bytes[-4:])[0]
                        callbacks.append({"register": item.op_str.split(",")[0], "rva": target,
                            "instructions": [{"rva": op.address, "op": op.mnemonic, "args": op.op_str} for op in decoder.disasm(image[target:target + 96], target)]})
            locations.append({"rva": at, "register": register, "instructions": instructions,
                              "functionPrefix": prefix_instructions, "callbackCandidates": callbacks})
            at += len(pattern)
    results.append({"nameHint": name, "fieldHash": f"{key:08x}", "candidates": locations})
report = {"schema": 1, "kind": "original-ui-registration-instruction-candidates", "build": "16.21.829.8620", "imageSha256": digest, "fields": results,
          "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          "scope": "Exact native instruction candidates only; names are metadata hints, constructor/layout consumers and defaults not executed"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "fields": len(results), "candidates": sum(len(field["candidates"]) for field in results)}))

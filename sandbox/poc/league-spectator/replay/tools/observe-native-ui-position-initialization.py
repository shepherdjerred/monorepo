"""Execute the original UI position-data initialization consumer on an authored single-anchor rectangle."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from unicorn import x86_const as registers
from vfx_spawn_native import NativeSpawn

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "defaults", "rectangles", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
defaults_bytes, rectangles_bytes = args.defaults.read_bytes(), args.rectangles.read_bytes()
defaults, rectangles = json.loads(defaults_bytes), json.loads(rectangles_bytes)
if rectangles["defaultsSha256"] != hashlib.sha256(defaults_bytes).hexdigest(): raise ValueError("Original rectangle/default source changed")
native = NativeSpawn(args.assets / "decoder-16.21-macos", args.client)
entry = next(item for item in defaults["observations"] if item["classHint"] == "UiPositionRect")
source = next(item for item in rectangles["observations"] if item["originalAnchorDefinition"] and item["originalAnchorDefinition"].get("__type") == "AnchorSingle" and not item["appliedConstructorDefaults"])
position, runtime, flags = 0x10080000, 0x10090000, 0x100a0000
native.u.mem_write(runtime, bytes(0x1000))
native.u.mem_write(flags, bytes(16))
native.call(entry["placementConstructorRva"], {registers.UC_X86_REG_RDI: position})
rect = source["authored"]
native.put(position + 0x10, "ffff", *rect["position"], *rect["Size"])
native.put(position + 0x20, "HH", rect["SourceResolutionWidth"], rect["SourceResolutionHeight"])
anchor = native.q(position + 0x28)
native.put(anchor + 8, "ff", *source["originalAnchorDefinition"]["Anchor"])
native.call(0x18b0120, {registers.UC_X86_REG_RDI: runtime, registers.UC_X86_REG_RSI: position, registers.UC_X86_REG_RDX: flags})
raw = bytes(native.u.mem_read(runtime, 0x90))
report = {"schema": 1, "kind": "original-ui-authored-position-data-initialization", "imageSha256": hashlib.sha256(native.image).hexdigest(),
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "defaultsSha256": hashlib.sha256(defaults_bytes).hexdigest(),
    "rectanglesSha256": hashlib.sha256(rectangles_bytes).hexdigest(), "authoredSource": source,
    "originalConsumerRva": 0x18b0120, "runtimeObjectHex": raw.hex(), "flagsHex": bytes(native.u.mem_read(flags, 16)).hex(),
    "normalizedRect": list(struct.unpack_from("<4f", raw, 0x50)), "anchorEndpoints": [list(struct.unpack_from("<2f", raw, offset)) for offset in [0x10, 0x18]],
    "originalBlocks": [native.blocks[key] for key in sorted(native.blocks)],
    "scope": "Original data-to-runtime position initialization with one complete authored single-anchor rectangle; runtime owner constructor, viewport/global scaling, clipping and final HUD rendering remain separate"}
if report["normalizedRect"] != source["originalNormalizedRect"]: raise ValueError("Original initialization did not retain the authored normalized rectangle")
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "normalizedRect": report["normalizedRect"], "anchorEndpoints": report["anchorEndpoints"], "originalBlocks": len(native.blocks)}))

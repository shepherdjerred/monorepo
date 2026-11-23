"""Execute the original UiPositionRect normalized-rectangle provider on authored HUD BIN values."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import math
from unicorn import x86_const as registers
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "defaults", "layouts", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
defaults_bytes, layout_bytes = args.defaults.read_bytes(), args.layouts.read_bytes()
defaults, layouts = json.loads(defaults_bytes), json.loads(layout_bytes)
native = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
native.initialize_layout_constants()
if hashlib.sha256(native.image).hexdigest() != defaults["imageSha256"]:
    raise ValueError("Original HUD constructor and rectangle provider image differ")
entry = next(item for item in defaults["observations"] if item["classHint"] == "UiPositionRect")
provider = next(item["rva"] for item in entry["vtableCandidates"] if item["slot"] == 5)
rect_defaults = next(item["registeredFields"] for item in defaults["observations"] if item["classHint"] == "UiElementRect")
if provider != 0x18adc10: raise ValueError("Original UiPositionRect provider changed")
address, output = 0x10080000, 0x10081000
def f32(value): return struct.unpack("<f", struct.pack("<f", value))[0]
observations, seen = [], set()
for controller in layouts["controllers"]:
    for binding in controller["bindings"]:
        for match in binding["matches"]:
            for layout in match["layout"]:
                value = layout["authored"]
                if value.get("__type") != "UiPositionRect": continue
                source = (match["sourceSha256"], match["objectHash"], layout["path"])
                if source in seen: continue
                seen.add(source)
                rect = value.get("UIRect", {"__type": "UiElementRect"})
                if rect.get("__type") != "UiElementRect": raise ValueError("Original typed UiElementRect required")
                position, size = rect.get("position", rect_defaults["position"]), rect.get("Size", rect_defaults["size"])
                width, height = rect.get("SourceResolutionWidth", rect_defaults["sourceResolutionWidth"]), rect.get("SourceResolutionHeight", rect_defaults["sourceResolutionHeight"])
                if any(not isinstance(vector, list) or len(vector) != 2 or any(type(number) not in [int, float] or not math.isfinite(number) for number in vector) for vector in [position, size]):
                    raise ValueError("Authored or original-constructor rectangle vectors required")
                if not all(type(number) is int and 0 <= number <= 65535 for number in [width, height]):
                    raise ValueError("Original authored rectangle source dimensions required")
                native.u.mem_write(address, bytes([0xa5]) * 0x48)
                native.call(entry["placementConstructorRva"], {registers.UC_X86_REG_RDI: address})
                native.put(address + 0x10, "ffff", *position, *size)
                native.put(address + 0x20, "HH", width, height)
                native.u.mem_write(output, bytes([0xa5]) * 16)
                native.call(provider, {registers.UC_X86_REG_RDI: address, registers.UC_X86_REG_RSI: output})
                result = list(struct.unpack("<4f", native.u.mem_read(output, 16)))
                if width and height:
                    expected = [f32(f32(position[0]) / width), f32(f32(position[1]) / height),
                                f32(f32(f32(position[0]) + f32(size[0])) / width),
                                f32(f32(f32(position[1]) + f32(size[1])) / height)]
                    if result != expected: raise ValueError("Original authored normalization differs from measured float32 operations")
                observations.append({"sourceSha256": source[0], "objectHash": source[1], "layoutPath": source[2],
                    "authored": rect, "authoredPosition": value, "appliedConstructorDefaults": [key for key in ["position", "Size", "SourceResolutionWidth", "SourceResolutionHeight"] if key not in rect],
                    "originalNormalizedRect": result, "originalAnchorDefinition": value.get("Anchors")})
report = {"schema": 1, "kind": "original-authored-hud-normalized-rectangle-observations", "build": "16.21.829.8620",
    "imageSha256": defaults["imageSha256"], "defaultsSha256": hashlib.sha256(defaults_bytes).hexdigest(),
    "layoutsSha256": hashlib.sha256(layout_bytes).hexdigest(), "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "originalProviderRva": provider, "observations": observations,
    "originalBlocks": [native.blocks[key] for key in sorted(native.blocks)],
    "scope": "Actual original UiPositionRect provider and authored source-resolution normalization only; anchor/viewport/global-scale consumers, clipping and final native HUD rendering remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
anchor_types = {}
for item in observations:
    kind = (item["originalAnchorDefinition"] or {}).get("__type", "original-constructor-default")
    anchor_types[kind] = anchor_types.get(kind, 0) + 1
print(json.dumps({"output": str(args.output), "authoredRectangles": len(observations), "anchorTypes": anchor_types,
    "originalProviderRva": provider, "allFloat32ComparisonsPassed": True}))

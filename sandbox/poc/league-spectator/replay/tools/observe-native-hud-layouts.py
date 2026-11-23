"""Execute original viewport layout for every authored HUD rectangle in an explicit root-parent control."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import math
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "defaults", "rectangles", "anchors", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
default_bytes, rectangle_bytes, anchor_bytes = args.defaults.read_bytes(), args.rectangles.read_bytes(), args.anchors.read_bytes()
defaults, rectangles, anchors = json.loads(default_bytes), json.loads(rectangle_bytes), json.loads(anchor_bytes)
if rectangles["defaultsSha256"] != hashlib.sha256(default_bytes).hexdigest(): raise ValueError("Original layout/default lineage changed")
native = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
native.initialize_layout_constants()
if any(source["imageSha256"] != hashlib.sha256(native.image).hexdigest() for source in [defaults, rectangles, anchors]): raise ValueError("Exact shared original UI image required")
position_ctor = next(item["placementConstructorRva"] for item in defaults["observations"] if item["classHint"] == "UiPositionRect")
rect_defaults = next(item["registeredFields"] for item in defaults["observations"] if item["classHint"] == "UiElementRect")
anchor_ctors = {item["nameHint"]: item["constructorRva"] for item in anchors["observations"]}
position, anchor_object, translation, parent, output = 0x10080000, 0x10090000, 0x100a0000, 0x100a1000, 0x100a2000
native.call(0x18abc40, {r.UC_X86_REG_RDI: 0}, end=0x18abd67)
element = native.u.reg_read(r.UC_X86_REG_R14)
if native.allocations.get(element) != 0x108: raise ValueError("Original element factory allocation changed")
original_element = bytes(native.u.mem_read(element, 0x108))
state = element + 0x58
manager = 0x10100000
native.construct_layout_manager(manager)
parent_getter = native.q(native.q(element) + 0x140) - native.base
observations = []
for source in rectangles["observations"]:
    value, rect = source["authoredPosition"], source["authored"]
    if set(value) - {"__type", "UIRect", "Anchors", "IgnoreGlobalScale", "DisablePixelSnappingX", "DisablePixelSnappingY", "DisableResolutionDownscale"}:
        raise ValueError("Unbound authored UI position field")
    native.u.mem_write(element, original_element)
    native.call(position_ctor, {r.UC_X86_REG_RDI: position})
    native.put(position + 0x10, "4f", *rect.get("position", rect_defaults["position"]), *rect.get("Size", rect_defaults["size"]))
    native.put(position + 0x20, "HH", rect.get("SourceResolutionWidth", rect_defaults["sourceResolutionWidth"]), rect.get("SourceResolutionHeight", rect_defaults["sourceResolutionHeight"]))
    anchor = value.get("Anchors")
    if anchor is not None:
        kind = anchor["__type"]
        if kind not in anchor_ctors: raise ValueError("Original registered anchor constructor required")
        native.call(anchor_ctors[kind], {r.UC_X86_REG_RDI: anchor_object})
        if kind == "AnchorSingle":
            if set(anchor) - {"__type", "Anchor"}: raise ValueError("Unbound original single-anchor input")
            if "Anchor" in anchor: native.put(anchor_object + 8, "2f", *anchor["Anchor"])
        elif set(anchor) != {"__type"}: raise ValueError("Authored selector/double-anchor overrides require original binding")
        native.put(position + 0x28, "Q", anchor_object)
    for name, offset in [("IgnoreGlobalScale", 0x30), ("DisablePixelSnappingX", 0x31), ("DisablePixelSnappingY", 0x32), ("DisableResolutionDownscale", 0x33)]:
        if name in value:
            if type(value[name]) is not bool: raise ValueError("Original authored UI flag must be boolean")
            native.put(position + offset, "B", int(value[name]))
    native.call(0x18b0120, {r.UC_X86_REG_RDI: state, r.UC_X86_REG_RSI: position, r.UC_X86_REG_RDX: element + 0x20})
    initialized_state = bytes(native.u.mem_read(state, 0x90))
    results = []
    for width, height in [(1600, 1200), (1920, 1080), (1280, 720), (800, 600)]:
        native.u.mem_write(state, initialized_state)
        native.put(manager + 0xe8, "II", width, height)
        native.put(translation, "2f", 0, 0)
        native.call(parent_getter, {r.UC_X86_REG_RDI: element, r.UC_X86_REG_RSI: 1, r.UC_X86_REG_RDX: parent})
        native.call(0x18af630, {r.UC_X86_REG_RDI: state, r.UC_X86_REG_RSI: translation, r.UC_X86_REG_RDX: element + 0x20, r.UC_X86_REG_RCX: parent, r.UC_X86_REG_R8: output})
        result = list(struct.unpack("<4f", native.u.mem_read(output, 16)))
        if not all(math.isfinite(number) for number in result): raise ValueError("Original root-parent layout produced nonfinite values")
        results.append({"suppliedViewport": [width, height], "originalOutputRect": result})
    observations.append({"source": source, "originalInitializedStateHex": initialized_state.hex(), "results": results})
report = {"schema": 1, "kind": "original-authored-hud-root-parent-layout-control", "imageSha256": hashlib.sha256(native.image).hexdigest(),
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "nativeHelperSha256": hashlib.sha256((Path(__file__).parent / "ui_manager_native.py").read_bytes()).hexdigest(),
    "defaultsSha256": hashlib.sha256(default_bytes).hexdigest(), "rectanglesSha256": hashlib.sha256(rectangle_bytes).hexdigest(), "anchorsSha256": hashlib.sha256(anchor_bytes).hexdigest(),
    "originalMathInitialization": {"startRva": 0x14aa3bf, "endRva": 0x14aa5f9, "sha256": hashlib.sha256(native.image[0x14aa3bf:0x14aa5f9]).hexdigest()},
    "layoutRva": 0x18af630, "parentGetterRva": parent_getter,
    "observations": observations, "originalBlocks": [native.blocks[key] for key in sorted(native.blocks)],
    "scope": "Every authored rectangle/flag and registered anchor under original root-parent/layout methods, default UI settings and supplied viewport; scene hierarchy, controller updates, localized text and final rendered HUD remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "rectangles": len(observations), "viewportObservations": sum(len(item["results"]) for item in observations), "originalBlocks": len(native.blocks)}))

"""Close original HUD source/control outputs into a static browser QA package.

Visibility, ordering, button state and text are explicit QA inputs. This does not
recover live controllers, sliced/material providers or native text shaping.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def sha(value):
    return hashlib.sha256(value).hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("receipts", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--layout-controls", default="native-hud-layouts-root-control.json")
parser.add_argument("--layout-comparison", default="native-hud-layout-wasm-comparison.json")
args = parser.parse_args()
receipts = args.receipts.resolve()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
(output / "assets").mkdir(exist_ok=True)
sources = {}


def read(name):
    raw = (receipts / name).read_bytes()
    sources[name] = sha(raw)
    return json.loads(raw)


def asset(raw, extension):
    digest = sha(raw)
    name = digest + extension
    (output / "assets" / name).write_bytes(raw)
    return {"url": "/assets/" + name, "sha256": digest, "bytes": len(raw)}


layouts = read(args.layout_controls)
layout_comparison = read(args.layout_comparison)
if layout_comparison["nativeSha256"] != sources[args.layout_controls] or layout_comparison["mismatches"]:
    raise ValueError("Original native/WASM rectangle comparison changed")
images = read("native-hud-image-resources.json")
inputs = read("native-hud-image-provider-inputs.json")
atlas_uv = read("native-hud-authored-uv.json")
loose_uv = read("native-hud-loose-image-uv.json")
font_closure = read("native-hud-font-closure.json")
font_directory = read("native-hud-font-byte-directory.json")
if (inputs["sourceReceipts"]["images"] != sources["native-hud-image-resources.json"]
        or atlas_uv["inputsSha256"] != sources["native-hud-image-provider-inputs.json"]
        or loose_uv["inputsSha256"] != sources["native-hud-image-provider-inputs.json"]):
    raise ValueError("Original image provider/control lineage changed")
uvs = {}
for controls in [atlas_uv, loose_uv]:
    for row in controls["observations"]:
        if row["boundary"] is not None:
            raise ValueError("A native UV control has an unresolved boundary")
        control = [case for case in row["cases"] if case["controlFlags"] == 0]
        if len(control) != 1:
            raise ValueError("Unique explicit zero-flag UV control required")
        if row["inputIndex"] in uvs:
            raise ValueError("UV controls contain duplicate provider ownership")
        uvs[row["inputIndex"]] = control[0]

objects = {}
for filename, expected in font_closure["uiSourceFiles"].items():
    source_file = Path(filename)
    raw = source_file.read_bytes()
    if sha(raw) != expected:
        raise ValueError("Normalized original UI-base source changed")
    data = json.loads(raw)
    source_sha = data["tree"]["sourceSha256"]
    original = source_file.with_suffix(".bin").read_bytes()
    if sha(original) != source_sha:
        raise ValueError("Original UI-base archive bytes changed")
    sources[str(source_file)] = expected
    sources[str(source_file.with_suffix(".bin"))] = source_sha
    for key, value in data["normalized"].items():
        identity = (source_sha, key)
        if identity in objects:
            raise ValueError("Duplicate original UI object owner")
        objects[identity] = value

rectangles = {}
for row in layouts["observations"]:
    source = row["source"]
    if source["layoutPath"] != "/{934f4e0a}":
        continue
    identity = (source["sourceSha256"], source["objectHash"])
    if identity in rectangles:
        raise ValueError("Ambiguous original object rectangle")
    rectangles[identity] = row["results"]

textures = {}
for image in images["images"]:
    texture = image["texture"]
    if texture["reference"] in textures:
        continue
    png = Path(texture["file"]).read_bytes()
    original = Path(texture["raw"]).read_bytes()
    if (sha(png) != texture["pngSha256"] or sha(original) != texture["sourceSha256"]
            or struct.unpack_from(">II", png, 16) != (texture["width"], texture["height"])):
        raise ValueError("Original texture/decoded PNG source changed")
    textures[texture["reference"]] = {**asset(png, ".png"), "width": texture["width"], "height": texture["height"], "originalSha256": texture["sourceSha256"]}

primitives, unsupported, source_bases = [], [], {}
for index, provider in enumerate(inputs["providers"]):
    previous_base = source_bases.setdefault(provider["sourceSha256"], provider["baseHash"])
    if previous_base != provider["baseHash"]:
        raise ValueError("Original source file has ambiguous QA base ownership")
    identity = (provider["sourceSha256"], provider["objectHash"])
    original = objects[identity]
    reasons = []
    if original["__type"] != "UiElementIconData" or provider["path"] != ["TextureData"]:
        reasons.append("provider-is-not-a-standalone-icon")
    if identity not in rectangles:
        reasons.append("root-rectangle-not-established")
    if index not in uvs:
        reasons.append("sliced-or-material-uv-not-established")
    if reasons:
        unsupported.append({"id": provider["sourceSha256"] + ":" + provider["objectHash"], "type": original["__type"], "provider": provider["original"]["__type"], "reasons": reasons})
        continue
    primitives.append({
        "id": provider["sourceSha256"] + ":" + provider["objectHash"],
        "baseHash": provider["baseHash"],
        "objectHash": provider["objectHash"], "sourceSha256": provider["sourceSha256"],
        "name": original.get("{8d39bde6}"), "scene": original.get("{2063cb13}"),
        "authoredLayer": original.get("{07a640f6}"),
        "texture": provider["image"]["texture"], "uv": uvs[index]["uvF32"],
        "provider": provider["original"]["__type"],
        "rectangles": [{"viewport": row["suppliedViewport"], "rect": row["originalOutputRect"]} for row in rectangles[identity]],
    })
buttons = []
for (source_sha, key), original in objects.items():
    if original["__type"] != "UiElementGroupButtonData":
        continue
    states = {}
    for field in ["DefaultStateElements", "HoverStateElements", "ClickedStateElements", "selectedStateElements", "SelectedHoverStateElements", "SelectedClickedStateElements", "DisabledStateElements"]:
        if field in original:
            state = original[field]
            if state["__type"] != "UiElementGroupButtonState":
                raise ValueError("Original button state type changed")
            states[field] = state.get("DisplayElementList", [])
    buttons.append({"id": source_sha + ":" + key, "sourceSha256": source_sha,
        "baseHash": source_bases[source_sha],
        "objectHash": key, "scene": original.get("{2063cb13}"), "name": original.get("{8d39bde6}"),
        "elements": original.get("elements", []), "states": states,
        "hitRegion": original.get("hitRegionElement")})

fonts = []
for font in font_directory["fonts"]:
    location = font["originalLocation"]
    raw = (receipts / "native-hud-font-bytes" / location["filename"]).read_bytes()
    if sha(raw) != location["sha256"] or len(raw) != location["bytes"]:
        raise ValueError("Original font archive bytes changed")
    labels = [row["value"] for row in font["names"] if row["nameId"] == 6]
    if not labels:
        raise ValueError("Original font lacks an authored PostScript name")
    fonts.append({**asset(raw, ".otf" if raw[:4] == b"OTTO" else ".ttf"), "label": labels[0], "family": "native-" + location["sha256"]})

manifest = {"schema": 1, "kind": "original-native-hud-static-qa", "build": inputs["build"], "protocol": inputs["protocol"],
    "scenes": images["scenes"], "primitives": primitives, "buttons": buttons, "textures": textures, "fonts": fonts,
    "unsupported": unsupported, "sources": sources, "producerSha256": sha(Path(__file__).read_bytes()),
    "scope": {"originalRootRectangles": True, "originalImagePixels": True, "originalUvProgramOutputs": True,
        "explicitQaVisibilityAndOrdering": True, "explicitQaButtonStates": True, "originalFontBytes": True,
        "nativeTextShaping": False, "nativeControllerBindings": False, "nativeLayerDefaults": False,
        "slicedOrMaterialProviders": False, "nativeHudParity": False}}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"output": str(output), "manifestSha256": sha((output / "manifest.json").read_bytes()),
    "primitives": len(primitives), "buttons": len(buttons), "textures": len(textures), "fonts": len(fonts), "unsupported": len(unsupported)}))

"""Close original control outputs for a browser-owned ReplaySession bridge.

The finite native state/label/rate outputs are retained verbatim. Browser input
ownership and the SDK actions do not establish native event-service admission.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
for name in ["receipts", "qa", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
sources = {}


def read(root, name, kind):
    raw = (root / name).read_bytes()
    sources[name] = hashlib.sha256(raw).hexdigest()
    value = json.loads(raw)
    if value["kind"] != kind:
        raise ValueError("Unexpected native control receipt kind: " + name)
    return value


qa = read(args.qa, "manifest.json", "original-native-hud-static-qa")
closure_raw = (args.receipts / "native-hud-font-closure.json").read_bytes()
closure = json.loads(closure_raw)
sources["native-hud-font-closure.json"] = hashlib.sha256(closure_raw).hexdigest()
objects = {}
for filename, digest in closure["uiSourceFiles"].items():
    raw = Path(filename).read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError("Original normalized UI input changed")
    document = json.loads(raw)
    original = Path(filename).with_suffix(".bin").read_bytes()
    source_sha = document["tree"]["sourceSha256"]
    if hashlib.sha256(original).hexdigest() != source_sha:
        raise ValueError("Original UI archive bytes changed")
    for key, value in document["normalized"].items():
        objects[(source_sha, key)] = value
selection = read(args.receipts, "native-hud-button-selection.json", "original-authored-button-selected-state-controls")
visibility_raw = Path(selection["visibilityReceipt"]).read_bytes()
if hashlib.sha256(visibility_raw).hexdigest() != selection["visibilityReceiptSha256"]:
    raise ValueError("Original completed native child-visibility controls changed")
sources[Path(selection["visibilityReceipt"]).name] = selection["visibilityReceiptSha256"]
rates = read(args.receipts, "native-replay-rate-controls.json", "original-replay-rate-index-controls")
labels = read(args.receipts, "native-replay-rate-labels.json", "original-replay-rate-label-controls")
display = read(args.receipts, "native-replay-display-policy.json", "original-replay-display-policy-controls")
events = read(args.receipts, "native-replay-control-events.json", "original-replay-control-event-source-candidates")
layouts = read(args.receipts, "native-hud-element-layouts-root-control.json", "original-authored-hud-root-parent-layout-control")
comparison_raw = (args.receipts / "native-hud-element-layout-wasm-comparison.json").read_bytes()
comparison = json.loads(comparison_raw)
sources["native-hud-element-layout-wasm-comparison.json"] = hashlib.sha256(comparison_raw).hexdigest()
if comparison["mismatches"] or comparison["nativeSha256"] != sources["native-hud-element-layouts-root-control.json"]:
    raise ValueError("Original native/WASM layout proof differs")
image = selection["imageSha256"]
if any(value["imageSha256"] != image for value in [rates, labels, display, events, layouts]) or display["boundary"]:
    raise ValueError("Mixed or incomplete original control image")
if (len(selection["observations"]) != 12 or any(row["boundary"] or len(row["cases"]) != 32 for row in selection["observations"])
        or sum(len(row["cases"]) for row in selection["observations"]) != 384):
    raise ValueError("Complete 384 original state controls required")
buttons = []
primitives = {}
for name in ["SkipBack", "Play", "SpeedDown", "SpeedUp"]:
    authored = events["authoredButtons"][name]
    candidate = [row for row in qa["buttons"] if row["objectHash"] == authored["Button"]]
    if len(candidate) != 1:
        raise ValueError("Unique original authored action button required")
    button = candidate[0]
    rows = [row for row in selection["observations"] if row["sourceSha256"] == button["sourceSha256"]
        and row["objectHash"] == button["objectHash"]]
    if len(rows) != 1 or rows[0]["boundary"] or len(rows[0]["cases"]) != 32:
        raise ValueError("Complete original action-button state controls required")
    states = {}
    for case in rows[0]["cases"]:
        key = "".join(str(case["controlledBytes"][offset]) for offset in ["1c1", "1c3", "1c4", "1c5", "1c6"])
        if key in states:
            raise ValueError("Duplicate original control input")
        ids = []
        for child in case["visibleChildren"]:
            identity = button["sourceSha256"] + ":" + child
            found = [row for row in qa["primitives"] if row["id"] == identity]
            if len(found) != 1:
                raise ValueError("Native control child is not an admitted original image")
            primitives[identity] = found[0]
            ids.append(identity)
        states[key] = {"slot": case["sourceStateSlot"], "visibleIds": ids}
    original_button = objects[(button["sourceSha256"], button["objectHash"])]
    hit_region = original_button["hitRegionElement"]
    rects = [row["results"] for row in layouts["observations"] if row["source"]["sourceSha256"] == button["sourceSha256"]
        and row["source"]["objectHash"] == hit_region and row["source"]["layoutPath"] == "/{934f4e0a}"]
    if len(rects) != 1:
        raise ValueError("Native action-button rectangle is unresolved")
    buttons.append({"action": name, "event": authored["HotkeyEventString"], "id": button["id"],
        "hitRegionElement": hit_region,
        "rectangles": [{"viewport": row["suppliedViewport"], "rect": row["originalOutputRect"]} for row in rects[0]],
        "states": states})
rate_rows = []
for index in range(6):
    controls = [row for row in rates["controls"] if row["before"] == index]
    values = {row["rate"]["f32"] for row in rates["controls"] if row["after"] == index}
    text = [row for row in labels["labels"] if row["sourceIndex"] == index]
    if len(controls) != 2 or len(values) != 1 or len(text) != 1:
        raise ValueError("Original rate controls are incomplete")
    rate_rows.append({"index": index, "value": values.pop(), "label": text[0]["text"],
        "increase": next(row["after"] for row in controls if row["action"] == "increase"),
        "decrease": next(row["after"] for row in controls if row["action"] == "decrease")})
args.output.parent.mkdir(parents=True, exist_ok=True)
texture_assets = {key: value for key, value in qa["textures"].items()
    if key in {row["texture"] for row in primitives.values()}}
for asset in texture_assets.values():
    relative = Path(asset["url"].removeprefix("/"))
    if relative.parts != ("assets", asset["sha256"] + ".png"):
        raise ValueError("Unconfined original control texture")
    raw = (args.qa / relative).read_bytes()
    if len(raw) != asset["bytes"] or hashlib.sha256(raw).hexdigest() != asset["sha256"]:
        raise ValueError("Original control texture bytes changed")
    (args.output.parent / "assets").mkdir(exist_ok=True)
    (args.output.parent / relative).write_bytes(raw)
manifest = {"schema": 1, "kind": "original-native-replay-controls-bridge", "build": qa["build"],
    "protocol": qa["protocol"], "imageSha256": image, "sources": sources,
    "producerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "buttons": buttons, "rates": rate_rows, "pauseCases": display["pauseCases"],
    "seekCases": display["seekCases"],
    "art": {**qa, "primitives": list(primitives.values()), "buttons": [], "fonts": [],
        "textures": texture_assets},
    "scope": {"nativeStateControls": 384, "browserOwnsInput": True, "sdkOwnsPlayback": True,
        "nativeEventServicesAdmitted": False, "nativeHudParity": False, "recordingSupported": False}}
args.output.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "buttons": len(buttons), "primitives": len(primitives),
    "manifestSha256": hashlib.sha256(args.output.read_bytes()).hexdigest()}))

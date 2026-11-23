"""Inventory every original UI-base element position, including button children.

The wrapper shape is consumed by the existing native rectangle observer. These
are original source elements, not additional inferred live controller bindings.
"""
import argparse
import hashlib
import json
from pathlib import Path


def positions(value, prefix=""):
    found = []
    if not isinstance(value, dict):
        return found
    if value.get("__type") == "UiPositionRect":
        found.append({"path": prefix, "authored": value})
    for key, child in value.items():
        if isinstance(child, dict):
            found.extend(positions(child, prefix + "/" + key))
    return found


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("font_closure", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
raw = args.font_closure.read_bytes()
closure = json.loads(raw)
controllers = []
for filename, digest in closure["uiSourceFiles"].items():
    source = Path(filename)
    content = source.read_bytes()
    if hashlib.sha256(content).hexdigest() != digest:
        raise ValueError("Original normalized UI-base bytes changed")
    data = json.loads(content)
    source_sha = data["tree"]["sourceSha256"]
    if hashlib.sha256(source.with_suffix(".bin").read_bytes()).hexdigest() != source_sha:
        raise ValueError("Original UI-base archive bytes changed")
    matches = []
    for key, value in data["normalized"].items():
        layout = positions(value)
        if not layout:
            continue
        matches.append({"sourceSha256": source_sha, "objectHash": key,
            "authored": value, "layout": layout})
    controllers.append({"type": "original-ui-base-element-inventory", "sourceSha256": source_sha,
        "bindings": [{"matches": matches}]})
report = {"schema": 1, "build": "16.21.829.8620", "protocol": "20e09df23c66b85e",
    "kind": "original-ui-base-element-position-inventory", "controllers": controllers,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "fontClosureSha256": hashlib.sha256(raw).hexdigest(),
    "scope": "Complete original UI-base element positions, including authored button-state children; no added live controller binding"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "baseFiles": len(controllers),
    "elements": sum(len(row["bindings"][0]["matches"]) for row in controllers),
    "positions": sum(len(match["layout"]) for row in controllers for match in row["bindings"][0]["matches"])}))

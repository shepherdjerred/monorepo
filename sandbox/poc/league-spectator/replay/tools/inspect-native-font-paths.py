"""Inspect original native string references for font/resource mount hints."""
import argparse
import hashlib
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
    raise ValueError("Exact original 16.21 native image required")
strings = []
for match in re.finditer(rb"[\x20-\x7e]{4,1024}", image):
    text = match.group().decode("ascii")
    if "font" in text.lower(): strings.append({"rva": match.start(), "text": text})
report = {"schema": 1, "kind": "original-native-font-resource-string-hints", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "strings": strings,
    "scope": "Original image strings are path/consumer investigation hints only; no archive existence, runtime selection or font asset admission implied"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "strings": len(strings), "pathHints": [item for item in strings if re.search(r"\.(bin|ttf|otf|tex|txt|wad)", item["text"], re.I)]}))

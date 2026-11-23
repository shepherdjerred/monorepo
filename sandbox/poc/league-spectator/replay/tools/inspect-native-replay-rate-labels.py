"""Locate original replay-rate label initialization and consumer functions."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

from macho import MachImage
from native_function_starts import native_function_starts

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
helper_path = Path(__file__).with_name("inspect-native-ui-image-owner.py")
spec = importlib.util.spec_from_file_location("native_rate_label_source_discovery", helper_path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
source = MachImage(args.client.read_bytes())
if (hashlib.sha256(source.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or hashlib.sha256(image).hexdigest() != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7"):
    raise ValueError("Exact original replay label image/function metadata required")
starts = native_function_starts(source.binary)
rows = [helper.inspect(image, 0x2509F10 + index * 16, (), starts) for index in range(6)]
paths = [Path(__file__), helper_path, Path(__file__).with_name("native_function_starts.py"), Path(__file__).with_name("macho.py")]
report = {"schema": 1, "kind": "original-replay-rate-label-source-discovery",
    "imageSha256": hashlib.sha256(image).hexdigest(), "rows": rows,
    "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
    "scope": "Canonical complete original functions referencing the six rate-label globals; initialization and live localized text remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "globals": [{"rva": hex(row["globalRva"]),
    "references": [(hex(item["rva"]), item["op"], item["args"]) for item in row["references"]],
    "functions": [(hex(item["start"]), hex(item["end"])) for item in row["functions"]]} for row in rows]}))

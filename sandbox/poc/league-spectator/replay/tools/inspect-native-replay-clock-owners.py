"""Discover original owners used by replay-control engine-service boundaries."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from macho import MachImage
from native_function_starts import native_function_starts

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("client", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
helper_path = Path(__file__).with_name("inspect-native-ui-image-owner.py")
spec = importlib.util.spec_from_file_location("native_rip_owner_discovery", helper_path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
client_bytes = args.client.read_bytes()
source = MachImage(client_bytes)
if hashlib.sha256(source.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b":
    raise ValueError("Exact original Mach-O function metadata required")
starts = native_function_starts(source.binary)
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
    raise ValueError("Exact original replay-clock consumer image required")
owners = []
for name, target in [("controller-context", 0x2470B70), ("pause-owner", 0x2472360), ("clock-service-owner", 0x246D000)]:
    owners.append({"nameHint": name, **helper.inspect(image, target, (), starts)})
report = {"schema": 1, "kind": "original-replay-clock-owner-source-candidates", "imageSha256": digest,
    "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__), helper_path, Path(__file__).with_name("native_function_starts.py"), Path(__file__).with_name("macho.py")]},
    "functionBoundarySource": "LC_FUNCTION_STARTS", "clientSha256": hashlib.sha256(client_bytes).hexdigest(),
    "owners": owners,
    "scope": "Exact original global owner reads/writes and complete surrounding function bytes; owner construction and external replay-clock service semantics require execution"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "owners": [{"name": row["nameHint"], "globalRva": hex(row["globalRva"]),
    "references": len(row["references"]), "functions": len(row["functions"]),
    "writers": [{"rva": hex(ref["rva"]), "op": ref["op"], "args": ref["args"]} for ref in row["references"] if ref["args"].startswith("qword ptr")]} for row in owners]}))

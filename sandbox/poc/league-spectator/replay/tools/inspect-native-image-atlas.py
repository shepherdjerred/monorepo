"""Locate exact original IMAA header consumers and retain raw atlas source bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import capstone

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "links", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7": raise ValueError("Exact original image-atlas reader image required")
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
locations, at = [], 0
while True:
    at = image.find(b"IMAA", at)
    if at < 0: break
    if 0x9000 <= at < 0x1fef000:
        start = image.rfind(b"\x55\x48\x89\xe5", max(0, at - 4096), at)
        if start >= 0:
            instructions = list(decoder.disasm(image[start:at + 2048], start))
            if any(item.address <= at < item.address + item.size and "0x41414d49" in item.op_str for item in instructions):
                locations.append({"entryRva": start, "magicRva": at, "instructions": [{"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str} for item in instructions]})
    at += 4
link_bytes = args.links.read_bytes()
links, atlases = json.loads(link_bytes), []
for row in links["results"]:
    for location in row["locations"]:
        if location["magic"] != "IMAA": continue
        raw = (args.links.parent / location["filename"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != location["sha256"] or len(raw) != location["bytes"]: raise ValueError("Original IMAA WAD source changed")
        atlases.append({"reference": row["value"], "source": location, "rawHex": raw.hex()})
report = {"schema": 1, "kind": "original-image-atlas-reader-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "linksSha256": hashlib.sha256(link_bytes).hexdigest(),
    "atlases": atlases, "locations": locations,
    "scope": "Original IMAA bytes and native magic-consumer instruction candidates; format fields and lookup/UV composition require native execution"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "atlases": len(atlases), "candidates": [{"entry": hex(item["entryRva"]), "magic": hex(item["magicRva"])} for item in locations]}))

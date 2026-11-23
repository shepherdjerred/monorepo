"""Execute original startup construction for replay-control clock owners.

No global pointer, flags or nested replay object is fabricated. An unadmitted
platform service remains an explicit original-code boundary.
"""
import argparse
import hashlib
import inspect
import json
from pathlib import Path

from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "candidates", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
candidate_bytes = args.candidates.read_bytes()
candidates = json.loads(candidate_bytes)
if candidates["functionBoundarySource"] != "LC_FUNCTION_STARTS":
    raise ValueError("Original function metadata ownership required")
for source, expected in candidates["sources"].items():
    if hashlib.sha256(Path(source).read_bytes()).hexdigest() != expected:
        raise ValueError("Original clock-owner discovery producer changed")
observations = []
for name, entry, end, global_at, expected_size in [
    ("pause-owner", 0x66D6C0, None, 0x2472360, 0x140),
    ("clock-service-owner", 0x665BAB, 0x665BC7, 0x246D000, 0x60),
    ("controller-context", 0x6FF453, 0x6FF46F, 0x2470B70, 0x640),
]:
    n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
    n.initialize_layout_constants()
    if hashlib.sha256(n.image).hexdigest() != candidates["imageSha256"]:
        raise ValueError("Original clock-owner image differs")
    row = {"nameHint": name, "entryRva": entry, "endRva": end, "globalRva": global_at, "boundary": None}
    try:
        n.call(entry, {}, end=end)
        owner = n.q(n.base + global_at)
        if n.allocations.get(owner) != expected_size:
            raise ValueError("Original clock owner allocation/global store changed")
        row.update(ownerBytes=expected_size, defaultsHex=bytes(n.u.mem_read(owner, expected_size)).hex(),
            ownedAllocationCount=len(n.allocations), ownedAllocationBytes=sum(n.allocations.values()))
    except Exception as error:
        from unicorn import x86_const as r
        row["boundary"] = {"kind": type(error).__name__, "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    row["originalBlocks"] = list(n.blocks.values())
    observations.append(row)
sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-replay-clock-owner-construction-observations", "imageSha256": candidates["imageSha256"],
    "candidatesSha256": hashlib.sha256(candidate_bytes).hexdigest(), "observations": observations,
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Original startup constructors and global owner stores; no fabricated replay/service flags, current match state or live controller admission"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "owners": [{"name": row["nameHint"], "boundary": row["boundary"],
    "bytes": row.get("ownerBytes"), "allocations": row.get("ownedAllocationCount")} for row in observations]}))
if any(row["boundary"] for row in observations):
    raise SystemExit(1)

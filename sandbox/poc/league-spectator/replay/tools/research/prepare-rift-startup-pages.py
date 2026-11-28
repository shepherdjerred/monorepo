"""Capture the original .8428 startup reader pages used by two saved matches."""

import argparse
import json
import runpy
import subprocess
import sys
from hashlib import sha256
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("rift_replay", type=Path)
    parser.add_argument("mayhem_replay", type=Path)
    args = parser.parse_args()
    tools = Path(__file__).resolve().parents[1]
    root = tools.parents[4]
    output = args.output.resolve()
    if root / ".cache" not in output.parents:
        raise ValueError("Startup capture output must use a new private cache directory")
    sys.path.insert(0, str(tools))
    source = runpy.run_path(str(tools / "inspect-8428-replay-startup.py"))
    uc = source["uc"]
    archive = args.archive.read_bytes()
    image = source["read_replication_image"](archive, source["CURRENT_BUILD"])
    pages = set()
    used_imports = set()

    def record(at, size):
        offset = at - image.base
        if 0 <= offset and offset + size <= len(image.image):
            pages.update(range(offset & ~0xFFF, offset + size, 0x1000))

    def code(_cpu, address, size, _):
        record(address, size)
        if address - image.base in image.imports:
            used_imports.add(address - image.base)

    def memory(_cpu, _access, address, size, _value, _):
        record(address, size)

    for replay, expected in (
        (args.rift_replay, {"configuredMapId": 11, "mode": "CLASSIC"}),
        (args.mayhem_replay, {"configuredMapId": 12, "mode": "KIWI"}),
    ):
        report = subprocess.run(
            ["bun", "-e", source["TRANSPORT"], str(replay.resolve())],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        row = json.loads(report.stdout)
        if (row["stream"], row["opcode"], row["chunkId"], row["offset"]) != (3, 1022, 1, 0):
            raise ValueError("Unexpected recorded startup envelope")
        wire = bytes.fromhex(row["payloadHex"])
        native = source["NativeStartupReader"](image)
        native.cpu.hook_add(uc.UC_HOOK_CODE, code)
        native.cpu.hook_add(uc.UC_HOOK_MEM_READ | uc.UC_HOOK_MEM_WRITE, memory)
        if native.read(wire) != expected:
            raise ValueError("Original startup map/mode differs from the capture role")
        for malformed in (wire[:-1], wire + b"\0"):
            try:
                native.read(malformed)
            except ValueError as error:
                if str(error) != "Original startup reader did not consume the entire body":
                    raise
            else:
                raise ValueError("Malformed packet passed the original startup reader")

    guard = [rva for rva, name in image.data_imports.items() if name == "___stack_chk_guard"]
    for rva in guard:
        record(image.base + rva, 8)
    ordered = sorted(pages)
    page_bytes = b"".join(bytes(image.image[page : page + 0x1000]) for page in ordered)
    profile = {
        "base": image.base,
        "pages": ordered,
        "guard": guard,
        "imports": {rva: image.imports[rva] for rva in sorted(used_imports)},
        "imageSha256": sha256(image.image).hexdigest(),
        "archiveSha256": sha256(archive).hexdigest(),
        "pageSha256": sha256(page_bytes).hexdigest(),
        "maxWireBytes": 0x8000,
    }
    output.mkdir()
    (output / "pages.bin").write_bytes(page_bytes)
    (output / "profile.json").write_bytes(json.dumps(profile, indent=2).encode("utf-8"))
    print(json.dumps({"pages": len(ordered), "bytes": len(page_bytes), "sha256": profile["pageSha256"]}))


if __name__ == "__main__":
    main()

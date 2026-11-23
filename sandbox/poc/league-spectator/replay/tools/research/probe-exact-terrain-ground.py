"""Run archived Map11 native height queries at supplied world XZ coordinates."""

import argparse
import json
import math
import runpy
import struct
from pathlib import Path

from unicorn import x86_const as r


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("executable", "navgrid", "requests", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cache = (Path.cwd() / ".cache").resolve()
    if not args.output.parent.resolve().is_relative_to(cache) or args.output.exists():
        raise ValueError("Expected a fresh private .cache output")
    research = Path(__file__).resolve().parent
    ground = runpy.run_path(str(research / "probe-exact-projectile-ground.py"))
    native = runpy.run_path(str(research.parent / "probe-exact-fog-navgrid.py"))
    binary, navgrid, request_bytes = (path.read_bytes() for path in (args.executable, args.navgrid, args.requests))
    sha = ground["sha"]
    if sha(binary) != ground["EXECUTABLE_SHA"] or sha(navgrid) != ground["NAVGRID_SHA"]:
        raise ValueError("Expected the exact 16.23 executable and Map11 navgrid")
    points = json.loads(request_bytes)
    if not isinstance(points, list) or not points:
        raise ValueError("Expected a nonempty array of world XZ coordinates")
    for point in points:
        if (
            not isinstance(point, list)
            or len(point) != 2
            or any(type(value) not in (int, float) or not math.isfinite(value) for value in point)
        ):
            raise ValueError("Expected finite numeric [x,z] coordinates")

    oracle = native["FogNavgrid"](native["MachImage"](binary), navgrid)
    runtime = oracle.load()
    minimum = [oracle.get(runtime + offset, "f") for offset in (0xBC, 0xC0, 0xC4)]
    maximum = [oracle.get(runtime + offset, "f") for offset in (0xDC, 0xE0, 0xE4)]
    dimensions = [oracle.get(runtime + offset, "I") for offset in (0x110, 0x114)]
    step = [oracle.get(runtime + offset, "f") for offset in (0x118, 0x11C)]
    cells_offset = ground["HEIGHTS_BYTE_OFFSET"]
    cells_bytes = math.prod(dimensions) * 4
    cells = bytes(oracle.cpu.mem_read(oracle.get(runtime + 0x108), cells_bytes))
    if cells != navgrid[cells_offset : cells_offset + cells_bytes]:
        raise ValueError("Native map height cells differ from the archived span")

    out = oracle.ARENA + 0x800
    queries = []
    for point in points:
        x, z = (ground["f32"](coordinate) for coordinate in point)
        if not math.isfinite(x) or not math.isfinite(z):
            raise ValueError("Expected world coordinates representable as finite Float32")
        oracle.cpu.mem_write(out, ground["UNWRITTEN"])
        status = (
            oracle.call(
                ground["NAVGRID_RVA"],
                {
                    r.UC_X86_REG_RDI: out,
                    r.UC_X86_REG_XMM0: ground["f32bits"](x),
                    r.UC_X86_REG_XMM1: ground["f32bits"](z),
                },
            )
            & 255
        )
        observed = bytes(oracle.cpu.mem_read(out, 4))
        if status == 1:
            (height,) = struct.unpack("<f", observed)
            if not math.isfinite(height):
                raise ValueError(f"Native in-bounds height is nonfinite at {[x, z]}")
        elif status == 0 and observed == ground["UNWRITTEN"]:
            height = None
        else:
            raise ValueError(f"Unexpected native height status or output at {[x, z]}")
        queries.append({"xz": [x, z], "inside": bool(status), "height": height})

    with args.output.open("x", encoding="utf-8") as file:
        json.dump(
            {
                "build": "16.23.840.6595",
                "decoderSha256": sha(binary),
                "requestsSha256": sha(request_bytes),
                "map11": {
                    "path": "assets/maps/navgrid/map11/aipath_srx_3.aimesh_ngrid",
                    "sha256": sha(navgrid),
                    "nativeBytesConsumed": oracle.position,
                    "groundCellsByteOffset": cells_offset,
                    "groundCellsBytes": cells_bytes,
                    "groundCellsSha256": sha(cells),
                    "minimum": minimum,
                    "maximum": maximum,
                    "dimensions": dimensions,
                    "step": step,
                },
                "originalEntries": {
                    "loader": oracle.LOAD,
                    "heightWrapper": ground["NAVGRID_RVA"],
                    "heightSampler": ground["NAVGRID_SAMPLER_RVA"],
                },
                "queries": queries,
            },
            file,
            allow_nan=False,
            indent=2,
        )


if __name__ == "__main__":
    main()

"""Compare the original 16.23 missile height query to exact Map11 grid bytes."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import runpy
import struct
import sys

from unicorn import x86_const as r


TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
NAVGRID_RVA = 0x16DEAC0
NAVGRID_SAMPLER_RVA = 0x16DF910
NAVGRID_SHA = "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9"
EXECUTABLE_SHA = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
REPLAY_SHA = "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b"
HEIGHTS_BYTE_OFFSET = 4716391
UNWRITTEN = bytes.fromhex("2133c07f")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def f32bits(value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


def project(point, minimum, maximum, dimensions, step, heights):
    x, z = point
    if not minimum[0] <= x <= maximum[0] or not minimum[2] <= z <= maximum[2]:
        return None, []
    columns, rows = dimensions
    axes = [f32(f32(value - low) / spacing)
            for value, low, spacing in zip(point, minimum[::2], step, strict=True)]
    ix, iz = (int(value) for value in axes)
    edge_x, edge_z = (ix >= columns - 1, iz >= rows - 1)
    lo_x, hi_x = ix - edge_x, ix + (not edge_x)
    lo_z, hi_z = iz - edge_z, iz + (not edge_z)
    indices = [row * columns + column
               for row in (lo_z, hi_z) for column in (lo_x, hi_x)]
    count = columns * rows
    if min(indices) < 0 or max(indices) >= count:
        raise ValueError("Asset projection escaped the archived height grid")
    a, b, c, d = [struct.unpack_from("<f", heights, index * 4)[0] for index in indices]
    u = 1.0 if edge_x else f32(axes[0] - ix)
    v = 1.0 if edge_z else f32(axes[1] - iz)
    u_inv, v_inv = f32(1 - u), f32(1 - v)
    near = f32(f32(f32(a * u_inv) + f32(b * u)) * v_inv)
    far = f32(f32(f32(c * u_inv) + f32(d * u)) * v)
    return f32(far + near), indices


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("executable", "navgrid", "projectile_receipt", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    private_cache = (Path.cwd() / ".cache").resolve()
    if not args.output.parent.resolve().is_relative_to(private_cache) or args.output.exists():
        raise ValueError("Expected a fresh private .cache output")
    binary, navgrid, evidence = (
        path.read_bytes() for path in (args.executable, args.navgrid, args.projectile_receipt)
    )
    replay = json.loads(evidence)
    if (sha(binary) != EXECUTABLE_SHA or sha(navgrid) != NAVGRID_SHA
            or replay["decoderSha256"] != EXECUTABLE_SHA or replay["replaySha256"] != REPLAY_SHA
            or replay["build"] != "16.23.840.6595" or replay["protocol"] != "8bbfcd5af2bc92db"):
        raise ValueError("Expected exact archived executable, Map11 navgrid and short replay")
    loader_tools = runpy.run_path(str(TOOLS / "probe-exact-fog-navgrid.py"))
    image = loader_tools["MachImage"](binary)
    oracle = loader_tools["FogNavgrid"](image, navgrid)
    runtime = oracle.load()
    minimum = struct.unpack_from("<3f", navgrid, 3)
    maximum = struct.unpack_from("<3f", navgrid, 15)
    dimensions = struct.unpack_from("<2I", navgrid, HEIGHTS_BYTE_OFFSET - 16)
    step = struct.unpack_from("<2f", navgrid, HEIGHTS_BYTE_OFFSET - 8)
    if minimum != tuple(oracle.get(runtime + offset, "f") for offset in (0xBC, 0xC0, 0xC4)):
        raise ValueError("Serialized Map11 minimum differs from native loader")
    if maximum != tuple(oracle.get(runtime + offset, "f") for offset in (0xDC, 0xE0, 0xE4)):
        raise ValueError("Serialized Map11 maximum differs from native loader")
    if (dimensions != (591, 593)
            or dimensions != tuple(oracle.get(runtime + o, "I") for o in (0x110, 0x114))
            or step != tuple(oracle.get(runtime + o, "f") for o in (0x118, 0x11C))):
        raise ValueError("Serialized Map11 interpolation grid differs from native loader")
    byte_count = 4 * dimensions[0] * dimensions[1]
    pointer = oracle.get(runtime + 0x108)
    heights = navgrid[HEIGHTS_BYTE_OFFSET:HEIGHTS_BYTE_OFFSET + byte_count]
    if bytes(oracle.cpu.mem_read(pointer, byte_count)) != heights:
        raise ValueError("Original loaded Map11 height cells differ from the archive span")

    # The native routine returns false without writing for out-of-bounds
    # queries. Use a distinctive poison rather than interpreting default zero.
    out = oracle.ARENA + 0x800

    def compare(point, cells=heights):
        oracle.cpu.mem_write(out, UNWRITTEN)
        status = oracle.call(NAVGRID_RVA, {
            r.UC_X86_REG_RDI: out, r.UC_X86_REG_XMM0: f32bits(point[0]),
            r.UC_X86_REG_XMM1: f32bits(point[1]),
        }) & 255
        expected, indices = project(point, minimum, maximum, dimensions, step, cells)
        observed = bytes(oracle.cpu.mem_read(out, 4))
        if expected is None:
            if status != 0 or observed != UNWRITTEN:
                raise ValueError("Original Map11 wrapper wrote outside bounds")
        elif status != 1 or observed != struct.pack("<f", expected):
            raise ValueError(f"Original Map11 interpolation disagrees at {point}: {observed.hex()}")
        return {"xz": point, "inside": bool(status), "height": expected, "assetCellIndices": indices}

    queries = {}

    def observe(position):
        xz = (position[0], position[2])
        if xz not in queries:
            queries[xz] = compare(xz)
        return queries[xz]

    events = []
    for event in replay["events"]:
        if event["missileSpell"] != "ZoeQMis2":
            continue
        spawn = event["verifiedBirthPositionXYZ"]
        height = observe(spawn)["height"]
        offset = f32(spawn[1] - height)
        if not math.isfinite(offset):
            raise ValueError("Nonfinite original launch height offset")
        events.append({
            "entity": event["entity"], "spawnXYZ": spawn, "spawnGroundHeight": height,
            "recordedSourcePlaneHeightOffset": offset,
            "castTargetGroundHeight": observe(event["castTargetXYZ"])["height"],
            "controllerGroundHeights": [
                {"clock": row["timeSeconds"], "bodySha256": row["bodySha256"],
                 "height": observe(row["vector"])["height"]}
                for row in event["recordedControllerVectors"]
            ],
        })
    if [event["entity"] for event in events] != [1073742880, 1073743207]:
        raise ValueError("Expected both saved Zoe recast ground-query cohorts")
    controls = [
        compare((minimum[0], minimum[2])),
        compare((maximum[0], maximum[2])),
        compare((f32(minimum[0] - 1), minimum[2])),
        compare((maximum[0], f32(maximum[2] + 1))),
    ]
    interior = queries[(events[0]["spawnXYZ"][0], events[0]["spawnXYZ"][2])]
    modified = bytearray(heights)
    for index in interior["assetCellIndices"]:
        cell = struct.unpack_from("<f", heights, index * 4)[0]
        encoded = struct.pack("<f", cell + 16)
        modified[index * 4:index * 4 + 4] = encoded
        oracle.cpu.mem_write(pointer + index * 4, encoded)
    perturbed = compare(interior["xz"], modified)
    if perturbed["height"] == interior["height"]:
        raise ValueError("Native height query ignored a changed set of asset cells")
    for index in interior["assetCellIndices"]:
        oracle.cpu.mem_write(pointer + index * 4, heights[index * 4:index * 4 + 4])
    if compare(interior["xz"]) != interior:
        raise ValueError("Restoring four original Map11 cells changed native interpolation")
    output = {
        "build": replay["build"], "protocol": replay["protocol"], "replaySha256": REPLAY_SHA,
        "decoderSha256": EXECUTABLE_SHA, "sourceProjectileReceiptSha256": sha(evidence),
        "map11": {"path": "assets/maps/navgrid/map11/aipath_srx_3.aimesh_ngrid", "sha256": NAVGRID_SHA,
                  "nativeBytesConsumed": oracle.position, "groundCellsSha256": sha(heights),
                  "groundCellsByteOffset": HEIGHTS_BYTE_OFFSET, "groundCellsBytes": byte_count,
                  "minimum": minimum, "maximum": maximum, "dimensions": dimensions, "step": step},
        "originalEntries": {"manager": oracle.MANAGER_GLOBAL, "loader": oracle.LOAD,
                            "heightWrapper": NAVGRID_RVA, "heightSampler": NAVGRID_SAMPLER_RVA},
        "queries": list(queries.values()), "events": events, "boundsControls": controls,
        "fourCellControl": {"original": interior, "modified": perturbed, "restored": True},
        "scope": "Original Map11 height queries match a separate Float32 projection from exact archived cells at the saved Zoe spawn and target coordinates. Match collision, frame cadence and VFX retirement remain unverified.",
    }
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(output, file, allow_nan=False, indent=2)


if __name__ == "__main__":
    main()

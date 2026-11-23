"""Check native Map11 raster sensitivity to two controlled turret movement seeds."""

import argparse
import importlib
import json
from pathlib import Path

provider = importlib.import_module("probe-exact-fog-keyframe-provider")
reg = provider.reg
MOTION_SHAS = (
    "48f280fb9d2f8463a937f65b17a38fd1d524cf502c0378559a4789840251ab00",
    "7e2e67d3b264a66b02ec2d8d06a77c163aa3eeb47360c07134c613cfc78c57fb",
)


def read_receipt(path, expected_sha):
    data = path.read_bytes()
    if provider.sha(data) != expected_sha:
        raise ValueError(f"Unexpected input receipt {path}")
    return json.loads(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in (
        "binary",
        "navgrid",
        "definition",
        "materials",
        "provider_receipt",
        "movement_a",
        "movement_b",
        "output",
    ):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()

    registered = read_receipt(args.provider_receipt, provider.PROVIDER_INPUT_SHA)
    rows = {
        row["providerId"]: row
        for row in registered["rows"]
        if (row["match"], row["stream"], row["chunk"]) == provider.KEYFRAME and row["opcode"] == 1158
    }
    movements = [
        read_receipt(path, sha) for path, sha in zip((args.movement_a, args.movement_b), MOTION_SHAS, strict=True)
    ]
    oracle = provider.navgrid.FogNavgrid(provider.MachImage(args.binary.read_bytes()), args.navgrid.read_bytes())
    oracle.load()
    config = provider.map_configuration(oracle, args.definition.read_bytes(), args.materials.read_bytes())
    side = config["side"]
    size = side * side
    plane = oracle.ARENA + 0x1000000
    counts = plane + 0x20000
    counts_pointer = oracle.ARENA + 0x3000
    oracle.put(counts_pointer, counts)
    oracle.call(0x7B49A0, {reg.UC_X86_REG_RDI: oracle.ARENA + 0x3400})
    cases = {}
    for experiment, movement in enumerate(movements):
        keyframe = [row for row in movement["rows"] if row["chunk"] == 2]
        if len(keyframe) != 11:
            raise ValueError("Unexpected turret cohort")
        for index, move in enumerate(keyframe):
            recorded = rows[move["providerId"]]
            if recorded["ownerId"] != move["ownerId"] or recorded["sourceEntityId"] != 0:
                raise ValueError("Motion/provider join differs")
            x, _, z = move["nativeControlPositionXYZ"]
            address = oracle.ARENA + 0x5000 + (experiment * 16 + index) * 0x100
            # Keep the packet registration scalars and terrain mode. Detach the
            # owner in both arms to isolate the center from team/radius state.
            control = {**recorded, "ownerId": 0, "positionXZ": [x, z]}
            radius = provider.construct_provider(oracle, control, address)
            oracle.cpu.mem_write(plane, bytes(size))
            oracle.cpu.mem_write(counts, bytes(size * 4))
            oracle.call(
                0x214370,
                {
                    reg.UC_X86_REG_RDI: address,
                    reg.UC_X86_REG_RSI: plane,
                    reg.UC_X86_REG_RDX: counts_pointer,
                    reg.UC_X86_REG_RCX: side,
                    reg.UC_X86_REG_XMM0: provider.float_words(config["extentXZ"])[0],
                },
            )
            data = bytes(oracle.cpu.mem_read(plane, size))
            cases.setdefault(move["providerId"], []).append((control["positionXZ"], radius, data))
    results = []
    for provider_id, cases_for_id in cases.items():
        (_, _, first), (_, _, second) = cases_for_id
        differences = [
            [i % side, i // side, a, b] for i, (a, b) in enumerate(zip(first, second, strict=True)) if a != b
        ]
        results.append(
            {
                "providerId": provider_id,
                "xZ": [item[0] for item in cases_for_id],
                "detachedControlRadius": [item[1] for item in cases_for_id],
                "visibleCellCounts": [item[2].count(255) for item in cases_for_id],
                "gridSha256": [provider.sha(item[2]) for item in cases_for_id],
                "changedCellsXZOldNew": differences,
            }
        )
    if {r["providerId"] for r in results if r["changedCellsXZOldNew"]} != {1073742451, 1073742454}:
        raise ValueError("Native Map11 sensitivity witness differs")
    grids = [
        bytes(max(cases_for_id[experiment][2][index] for cases_for_id in cases.values()) for index in range(size))
        for experiment in range(len(movements))
    ]
    pixels = [provider.Raster(oracle.image, side, grid).run() for grid in grids]
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(
            {
                "mapConfiguration": config,
                "startupTicks": [movement["rngStartupControlTick"] for movement in movements],
                "motionReceiptSha256": MOTION_SHAS,
                "providerReceiptSha256": provider.PROVIDER_INPUT_SHA,
                "results": results,
                "controlledCohortUnion": {
                    "gridSha256": [provider.sha(grid) for grid in grids],
                    "changedCells": sum(a != b for a, b in zip(*grids, strict=True)),
                    "pixelsSha256": [provider.sha(texture) for texture in pixels],
                    "changedPixels": sum(a != b for a, b in zip(*pixels, strict=True)),
                },
                "ownerDetachedInBothControls": True,
                "ownedProvidersAdmitted": 0,
            },
            output,
            indent=2,
            allow_nan=False,
        )


if __name__ == "__main__":
    main()

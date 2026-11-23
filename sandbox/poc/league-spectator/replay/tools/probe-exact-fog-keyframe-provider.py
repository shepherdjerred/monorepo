"""Extract recorded ownerless Map11 providers' native terrain contribution.

Use the exact Mach-O archive, the three Map11 WAD entries and the reviewed
packet-dispatch receipt. The entries are assets/maps/navgrid/map11/
aipath_srx_3.aimesh_ngrid, data/maps/shipping/map11/map11.bin, and
data/maps/mapgeometry/map11/base_srx.materials.bin. The output PGM contains
the original CPU raster's pre-upload bytes, including allocator-filled corners.

To restore the other providers, restore the clock-specific native entity
dictionary for the recorded source and owner IDs. Provider +0x3c carries its
resolved owner, +0x40 its source and +0x39 its team slot. In 0x214200 the owner
lookup 0x5587f0 must expose +0x15c and the native team-mapping table for the
same-team test, then the +0x130 virtual owner component and its +0x3e8
modifier for the radius scale and offset at provider +0x14 and +0x18.
The second lookup supplies live owner +0x160/+0x168 XZ or the movement
component (+0x128, then +0x690 and 0xac070). An absent nonzero owner
invalidates the provider; returning null for unresolved owners changes fog.

The terrain path in 0x21dcb0 may also consult the owner's +0x130 component,
its +0x2b8 eligibility, and the registered restriction rows. Rebuilding the
team raster needs the original 0x221900 provider selection and visibility
walk, clock and lifetime state, followed by native raster and postprocess.
The two ownerless contributions only require null ID zero. The other 23
registrations stay unresolved, including 11 whose distinct captured
post-registration +0x6c field is zero despite their nonzero owner ID.
"""

import argparse
import importlib
import json
import struct
from collections import Counter
from pathlib import Path

from macho import MachImage
from unicorn import UC_HOOK_CODE
from unicorn import x86_const as reg

navgrid = importlib.import_module("probe-exact-fog-navgrid")
Raster = importlib.import_module("probe-exact-team-fog-raster").Raster
sha = navgrid.sha
MAP_DEFINITION_SHA = "338a12c915c8fc2c38a7d5ac9e4ae1e15a1a4ccd0115f2e4f6050e15497ca0f6"
PROVIDER_INPUT_SHA = "cb604f00a79883ac58cc9771e7daefab4fe7fb44f436bba862f1b177f45a27f5"
OWNERLESS_OFFSETS = (110379, 110412)
XMM = (reg.UC_X86_REG_XMM0, reg.UC_X86_REG_XMM1, reg.UC_X86_REG_XMM2, reg.UC_X86_REG_XMM3, reg.UC_X86_REG_XMM4)


def float_words(values):
    return [struct.unpack("<I", struct.pack("<f", value))[0] for value in values]


def map_configuration(oracle, definition, materials):
    if sha(definition) != MAP_DEFINITION_SHA or sha(materials) != navgrid.MATERIAL_SHA:
        raise ValueError("Expected exact Map11 definition and base materials")
    config_link = definition[7302:7311]
    config = definition[3436359:3436493]
    bound_field = materials[1675416:1675429]
    if (
        config_link != bytes.fromhex("8dbb2e8384a520b2ae")
        or struct.unpack_from("<IIH", config) != (130, 0xAEB220A5, 4)
        or any(struct.pack("<I", field) in config for field in (0xEBA1B3C5, 0x0204A122))
        or bound_field[:5] != bytes.fromhex("663556bf0b")
        or bytes.fromhex("a49742b10b") in materials[1674941:1675756]
    ):
        raise ValueError("Map11 fog resolution, scale or bounds fields differ")

    config_address = oracle.ARENA + 0x3600
    bounds_address = oracle.ARENA + 0x3800
    oracle.call(0x2303B0, {reg.UC_X86_REG_RDI: config_address})
    oracle.call(0x167F400, {reg.UC_X86_REG_RDI: bounds_address})
    side = oracle.get(config_address + 0x18, "I")
    upscale = oracle.get(config_address, "B")
    minimum = [oracle.get(bounds_address + offset, "f") for offset in (0x20, 0x24)]
    maximum = list(struct.unpack_from("<ff", bound_field, 5))
    if side != 128 or upscale != 1 or minimum != [0.0, 0.0]:
        raise ValueError("Original Map11 fog constructor defaults differ")
    return {
        "side": side,
        "upscale": 4,
        "minimumXZ": minimum,
        "maximumXZ": maximum,
        "extentXZ": [high - low for high, low in zip(maximum, minimum, strict=True)],
    }


def construct_provider(oracle, row, provider):
    if row["sourceEntityId"] != 0 or row["ownerId"] != 0:
        raise ValueError("A recorded ownerless provider is required")
    writes = bytes.fromhex(row["postRegistrationWrites6c"])
    if int.from_bytes(writes[:4], "little") or writes[8] != 1:
        raise ValueError("Recorded provider did not request the expected terrain path")

    def lookup(cpu, _address, _size, _data):
        if cpu.reg_read(reg.UC_X86_REG_ESI) != 0:
            raise ValueError("Original provider requested an entity outside the ownerless proof")
        stack = cpu.reg_read(reg.UC_X86_REG_RSP)
        cpu.reg_write(reg.UC_X86_REG_RAX, 0)
        cpu.reg_write(reg.UC_X86_REG_RSP, stack + 8)
        cpu.reg_write(reg.UC_X86_REG_RIP, oracle.get(stack))

    boundary = oracle.base + 0x5587F0
    lookup_hook = oracle.cpu.hook_add(UC_HOOK_CODE, lookup, begin=boundary, end=boundary)
    first, second, third, fourth = row["registrationScalars"]
    position = int.from_bytes(struct.pack("<ff", *row["positionXZ"]), "little")
    oracle.put(oracle.STACK + 8, 0)
    oracle.call(
        0x210EF0,
        {
            reg.UC_X86_REG_RDI: provider,
            reg.UC_X86_REG_RSI: 0,
            reg.UC_X86_REG_RDX: row["providerId"],
            reg.UC_X86_REG_RCX: row["registrationTag"],
            reg.UC_X86_REG_R8: row["teamSlot"],
            reg.UC_X86_REG_R9: row["registrationFlags"],
            **dict(zip(XMM, [position, *float_words([second, third, fourth, first])], strict=True)),
        },
    )
    # The packet oracle captured these writes at the typed registration dispatch.
    oracle.put(provider, oracle.base + 0x237CF68)
    oracle.cpu.mem_write(provider + 0x6C, writes)
    oracle.call(
        0x2141B0,
        {
            reg.UC_X86_REG_RDI: provider,
            **dict(zip(XMM, float_words(row["postRegistrationScalars"]), strict=True)),
        },
    )
    oracle.call(0x214200, {reg.UC_X86_REG_RDI: provider})
    oracle.cpu.hook_del(lookup_hook)
    return oracle.get(provider + 0x10, "f")


def terrain_contribution(oracle, rows, config):
    plane = oracle.ARENA + 0x1000000
    counts = plane + 0x20000
    counts_pointer = oracle.ARENA + 0x3000
    oracle.put(counts_pointer, counts)
    oracle.call(0x7B49A0, {reg.UC_X86_REG_RDI: oracle.ARENA + 0x3400})
    traces = Counter()

    def track(_cpu, _address, _size, rva):
        traces[f"{rva:#x}"] += 1

    for rva in (*oracle.TERRAIN_QUERIES, 0x16DDA50, 0x16E0B80, 0x213720, 0x2201D0):
        address = oracle.base + rva
        oracle.cpu.hook_add(UC_HOOK_CODE, track, rva, begin=address, end=address)
    side = config["side"]
    contributions = []
    for index, row in enumerate(rows):
        provider = oracle.ARENA + 0x2000 + index * 0x100
        radius = construct_provider(oracle, row, provider)
        oracle.call(
            0x214370,
            {
                reg.UC_X86_REG_RDI: provider,
                reg.UC_X86_REG_RSI: plane,
                reg.UC_X86_REG_RDX: counts_pointer,
                reg.UC_X86_REG_RCX: side,
                reg.UC_X86_REG_XMM0: float_words(config["extentXZ"])[0],
            },
        )
        cells = bytes(oracle.cpu.mem_read(plane, side * side))
        contributions.append({"provider": row, "nativeRadius": radius, "combinedCellsAfterProvider": cells.count(255)})
    if (
        [item["nativeRadius"] for item in contributions] != [900.0, 900.0]
        or contributions[0]["combinedCellsAfterProvider"] != 116
        or contributions[1]["combinedCellsAfterProvider"] != 157
        or set(cells) != {0, 255}
        or any(traces[rva] != 2 for rva in ("0x16dd4c0", "0x213720", "0x2201d0"))
    ):
        raise ValueError("Recorded provider did not reproduce its expected native terrain contribution")
    return contributions, cells, traces


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("binary", "navgrid", "definition", "materials", "provider_receipt", "output", "texture"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    receipt_bytes = args.provider_receipt.read_bytes()
    if sha(receipt_bytes) != PROVIDER_INPUT_SHA:
        raise ValueError("Expected the reviewed exact-build recorded provider receipt")
    receipt = json.loads(receipt_bytes)
    short, _long = receipt["fixtures"]
    keyframe = (short["match"], 2, 2)
    cohort = [
        row
        for row in receipt["rows"]
        if row["opcode"] == 1158
        and row["teamSlot"] == 2
        and tuple(row[key] for key in ("match", "stream", "chunk")) == keyframe
    ]
    ownerless = [row for row in cohort if row["ownerId"] == 0 and row["sourceEntityId"] == 0]
    if [row["offset"] for row in ownerless] != list(OWNERLESS_OFFSETS) or len(cohort) != 25:
        raise ValueError("Expected two ownerless registrations in the recorded team-200 keyframe")
    image = MachImage(args.binary.read_bytes())
    oracle = navgrid.FogNavgrid(image, args.navgrid.read_bytes())
    oracle.load()
    config = map_configuration(oracle, args.definition.read_bytes(), args.materials.read_bytes())
    contributions, cells, traces = terrain_contribution(oracle, ownerless, config)
    pixels = Raster(image, config["side"], cells).run()
    width = config["side"] * config["upscale"]
    with args.texture.open("xb") as texture:
        texture.write(f"P5\n{width} {width}\n255\n".encode("ascii") + pixels)
    report = {
        "build": "16.23.840.6595",
        "protocol": "8bbfcd5af2bc92db",
        "replaySha256": "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
        "navgridSha256": navgrid.MAP_SHA,
        "mapDefinitionSha256": MAP_DEFINITION_SHA,
        "materialsSha256": navgrid.MATERIAL_SHA,
        "providerReceiptSha256": PROVIDER_INPUT_SHA,
        "providers": contributions,
        "mapConfiguration": config,
        "unresolvedOwnedProviders": [
            {
                "providerId": row["providerId"],
                "ownerId": row["ownerId"],
                "postRegistrationOwnerId": int.from_bytes(bytes.fromhex(row["postRegistrationWrites6c"])[:4], "little"),
            }
            for row in cohort
            if row["ownerId"] != 0
        ],
        "knownContributionCells": cells.count(255),
        "contributionGridSha256": sha(cells),
        "nativeRaster": {
            "instructionRva": Raster.ENTRY,
            "width": width,
            "height": width,
            "preUploadBytesSha256": sha(pixels),
            "unwrittenCornerFillByte": 0xCD,
        },
        "originalTerrainCalls": traces,
        "scope": {
            "allOwnerlessTeamRegistrationsAtKeyframe": True,
            "nativeTerrainOcclusionExecuted": True,
            "providerModeConstructedWithNativeDefault": True,
            "fullTeamStencil": False,
            "fullMatchTexture": False,
            "rendererAdmission": False,
        },
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)


if __name__ == "__main__":
    main()

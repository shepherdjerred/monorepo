"""Observe initial .8428 Map11 navigation mask inputs and native fourfold expansion."""

import argparse
import json
import runpy
import struct
import sys
from pathlib import Path

from unicorn import x86_const as registers

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))
native = runpy.run_path(str(TOOLS / "probe-exact-fog-navgrid.py"))
sha = native["sha"]

ARCHIVE_SHA = "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
MAP11_NAVGRID_SHA = native["MAP_SHA"]
MAP11_DIMENSIONS = (295, 296)
EXPANSION_TABLE_SHA = "dd7549d63f4dbe9cde8ba813fe2be5e9db334b0e54d65edaa0ad5bc4ca100fd6"
ARGB_START = 0x14D51D0
ARGB_END = 0x14D5202
TRANSFORM_START = 0x622CED
TRANSFORM_END = 0x622D28
TRANSFORM_GLOBAL = 0x25C0B80
EXPANSION_START = 0x77D3FA
EXPANSION_END = 0x77D73B


class Map11MaskProbe(native["FogNavgrid"]):
    EXECUTABLE_SLICE_SHA256 = "de6db1683eb61358d0aaf9fac44ef722850a927263eae7f68212add8621a500e"

    def __init__(self, image, navgrid):
        super().__init__(image, navgrid)
        self.hook(self.base + 0x14C55B0, "copy_mask_row")

    def operation(self, cpu, address, size, name):
        if name != "copy_mask_row":
            super().operation(cpu, address, size, name)
            return
        target = cpu.reg_read(registers.UC_X86_REG_RDI)
        target_size = cpu.reg_read(registers.UC_X86_REG_RSI)
        source = cpu.reg_read(registers.UC_X86_REG_RDX)
        source_size = cpu.reg_read(registers.UC_X86_REG_RCX)
        if target_size != source_size or target_size != MAP11_DIMENSIONS[0] * 4:
            raise ValueError("Original row copy has unexpected bounds")
        self.check_arena(target, target_size)
        self.check_arena(source, source_size)
        cpu.mem_write(target, bytes(cpu.mem_read(source, source_size)))
        stack = cpu.reg_read(registers.UC_X86_REG_RSP)
        cpu.reg_write(registers.UC_X86_REG_RIP, self.get(stack))
        cpu.reg_write(registers.UC_X86_REG_RSP, stack + 8)
        self.calls[name] += 1

    def expand(self, rgba_pointer, width, height, prior):
        pixels = width * height * 16
        output = self.next_allocation + 16
        self.check_arena(output - 16, pixels + 32)
        self.next_allocation += pixels + 32
        guards = bytes([0xA5]) * 16
        self.cpu.mem_write(output - 16, guards + prior + guards)
        frame = self.STACK + 0x400
        for offset, value in (
            (0x38, output),
            (0x40, width),
            (0x48, height),
            (0x60, height * 4),
            (0x70, width * 4),
        ):
            self.put(frame - offset, value)
        self.call(
            EXPANSION_START,
            {
                registers.UC_X86_REG_RBP: frame,
                registers.UC_X86_REG_R12: width * 4,
                registers.UC_X86_REG_R13: rgba_pointer,
            },
            stop_rva=EXPANSION_END,
        )
        if self.cpu.mem_read(output - 16, 16) != guards or self.cpu.mem_read(output + pixels, 16) != guards:
            raise ValueError("Original mask expansion escaped its destination")
        return bytes(self.cpu.mem_read(output, pixels))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", type=Path, help="exact archived macOS executable")
    parser.add_argument("navgrid", type=Path, help="authored Map11 Final NavGrid")
    parser.add_argument("output", type=Path, help="new private JSON receipt")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Native proofs require Python assertions enabled")
    client, navgrid = args.client.read_bytes(), args.navgrid.read_bytes()
    if sha(client) != ARCHIVE_SHA:
        raise ValueError("Unexpected .8428 executable archive digest")
    if sha(navgrid) != MAP11_NAVGRID_SHA:
        raise ValueError("Unexpected authored Map11 Final NavGrid digest")
    image = native["MachImage"](client)
    table = image.image[0x21409C0 : 0x21409C0 + 256]
    if sha(table) != EXPANSION_TABLE_SHA:
        raise ValueError("Unexpected .8428 native expansion table")
    probe = Map11MaskProbe(image, navgrid)
    probe.call(ARGB_START, {}, stop_rva=ARGB_END)
    runtime = probe.load()
    width, height = struct.unpack("<2I", probe.cpu.mem_read(runtime + 0xD4, 8))
    if (width, height) != MAP11_DIMENSIONS or probe.get(runtime + 0x5C8, "B") != 1:
        raise ValueError("Original Map11 dimensions or initial dirty state differs")
    transform_pointer = probe.base + TRANSFORM_GLOBAL
    probe.call(
        TRANSFORM_START,
        {registers.UC_X86_REG_RBP: probe.STACK + 0x400},
        stop_rva=TRANSFORM_END,
    )
    transform = struct.unpack("<4f", probe.cpu.mem_read(transform_pointer, 16))
    if not (0 < transform[0] < 1 and 0 < transform[1] < 1):
        raise ValueError("Original Map11 scene transform was not written")
    count = width * height
    rgba_pointer = probe.get(runtime + 0x5C0)
    cells_pointer = probe.get(runtime + 0xF0)
    probe.check_arena(rgba_pointer, count * 4)
    probe.check_arena(cells_pointer, count * 16)
    rgba = bytes(probe.cpu.mem_read(rgba_pointer, count * 4))
    cells = bytes(probe.cpu.mem_read(cells_pointer, count * 16))
    flags = bytearray()
    for index in range(count):
        overlay, packed = struct.unpack_from("<QH", cells, 16 * index)
        if overlay:
            raise ValueError("Unexpected dynamic overlay in initial Map11 source")
        flags.extend(struct.pack("<H", packed))
        expected = b"\x00\x00\x00\xff" if packed & 0xC02 == 2 else b"\xff" * 4
        if rgba[4 * index : 4 * index + 4] != expected:
            raise ValueError(f"Initial native Map11 RGBA differs at tile {index}")
    prior = bytes(count * 16)
    expanded = probe.expand(rgba_pointer, width, height, prior)
    if probe.cpu.mem_read(rgba_pointer, count * 4) != rgba:
        raise ValueError("Original mask expansion modified the source")
    if probe.calls["copy_mask_row"] != 4 or set(expanded) != {0, 127, 255}:
        raise ValueError("Original mask expansion did not complete")
    receipt = {
        "schema": 1,
        "build": "16.23.841.8428",
        "kind": "initial-map11-native-mask-source",
        "scope": "Archived initial Map11 source and zero-prior fourfold CPU expansion",
        "unproven": ["replay-time overlays", "actual quality setting", "fade and blur history"],
        "clientSha256": ARCHIVE_SHA,
        "navgridSha256": MAP11_NAVGRID_SHA,
        "native": {
            "argbStartupRva": [ARGB_START, ARGB_END],
            "navgridLoadRva": probe.LOAD,
            "activeRgbaFieldOffset": 0x5C0,
            "navmeshSourceDispatchRva": [0x77CDFD, 0x77CE14],
            "worldToUvRva": [TRANSFORM_START, TRANSFORM_END],
            "worldToUvGlobalRva": TRANSFORM_GLOBAL,
            "expansionRva": [EXPANSION_START, EXPANSION_END],
            "expansionTableRva": 0x21409C0,
        },
        "rgba": {
            "width": width,
            "height": height,
            "cellSize": probe.get(runtime + 0xC8, "f"),
            "origin": struct.unpack("<3f", probe.cpu.mem_read(runtime + 0xBC, 12)),
            "sha256": sha(rgba),
            "hex": rgba.hex(),
            "cellFlagsHex": flags.hex(),
        },
        "worldToUv": dict(zip(("xScale", "zScale", "xBias", "zBias"), transform, strict=True)),
        "expanded": {
            "width": width * 4,
            "height": height * 4,
            "tableSha256": EXPANSION_TABLE_SHA,
            "previousSha256": sha(prior),
            "sha256": sha(expanded),
            "hex": expanded.hex(),
        },
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(receipt, file, separators=(",", ":"))
        file.write("\n")
    print(json.dumps({key: receipt[key]["sha256"] for key in ("rgba", "expanded")}))


if __name__ == "__main__":
    main()

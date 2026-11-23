"""Load archived Map11 navigation bytes and execute exact fog terrain queries."""

import argparse
import hashlib
import json
import struct
from collections import Counter
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as reg

MAP_SHA = "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9"
MACH_SHA = "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa"
MATERIAL_SHA = "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a"


def sha(data):
    return hashlib.sha256(data).hexdigest()


class FogNavgrid:
    ARENA = 0x10000000
    ARENA_SIZE = 0x4000000
    STREAM = ARENA + 0x100
    TABLE = ARENA + 0x200
    STACK = ARENA + 0xF008
    MANAGER = ARENA + 0x500
    MANAGER_GLOBAL = 0x24E2A10
    CONSTRUCT = 0x16D7ED0
    LOAD = 0x16DB710
    TERRAIN_QUERIES = (0x16DD420, 0x16DD4C0, 0x16E15B0)

    def __init__(self, image, navgrid):
        if sha(image.binary) != MACH_SHA or sha(navgrid) != MAP_SHA:
            raise ValueError("Expected archived 16.23.840.6595 and exact Map11 navgrid")
        self.image = image
        self.base = image.base
        self.data = navgrid
        self.position = 0
        self.next_allocation = self.ARENA + 0x10000
        self.calls = Counter()
        self.cpu = Uc(UC_ARCH_X86, UC_MODE_64)
        self.cpu.mem_map(self.base, len(image.image))
        self.cpu.mem_write(self.base, bytes(image.image))
        self.cpu.mem_map(self.ARENA, self.ARENA_SIZE)
        if image.data_imports.get(0x24DC310) != "___stack_chk_guard":
            raise ValueError("Unexpected exact-build stack guard binding")
        self.put(self.base + 0x24DC310, self.ARENA + 0x400)
        for rva, operation in {
            **image.imports,
            0x14A0300: "allocate",
            0x14A2030: "allocate",
            0x14A0240: "release",
            0x14A46F0: "release",
        }.items():
            self.hook(self.base + rva, operation)
        self.put(self.STREAM, self.TABLE)
        for index, (offset, operation) in enumerate([(0x10, "read"), (0x28, "tell"), (0x30, "seek")]):
            callback = self.ARENA + 0x300 + index * 16
            self.put(self.TABLE + offset, callback)
            self.hook(callback, operation)

    def get(self, address, fmt="Q"):
        return struct.unpack("<" + fmt, self.cpu.mem_read(address, struct.calcsize(fmt)))[0]

    def put(self, address, value):
        self.cpu.mem_write(address, struct.pack("<Q", value))

    def check_arena(self, address, size):
        if not self.ARENA <= address <= self.ARENA + self.ARENA_SIZE - size:
            raise ValueError("Original native operation escaped the owned arena")

    def hook(self, address, operation):
        self.cpu.hook_add(UC_HOOK_CODE, self.operation, operation, begin=address, end=address)

    def operation(self, cpu, address, size, name):
        self.calls[name] += 1
        first = cpu.reg_read(reg.UC_X86_REG_RDI)
        second = cpu.reg_read(reg.UC_X86_REG_RSI)
        third = cpu.reg_read(reg.UC_X86_REG_RDX)
        result = 0
        if name == "allocate":
            result = self.next_allocation
            self.check_arena(result, first)
            self.next_allocation = (result + first + 15) & ~15
        elif name == "release":
            if first:
                self.check_arena(first, 1)
        elif name == "___bzero":
            self.check_arena(first, second)
            cpu.mem_write(first, bytes(second))
        elif name == "_memset":
            self.check_arena(first, third)
            cpu.mem_write(first, bytes([second & 255]) * third)
            result = first
        elif first == self.STREAM and name == "read":
            self.check_arena(second, third)
            end = self.position + third
            if end > len(self.data):
                raise ValueError("Original stream read exceeded the Map11 bytes")
            cpu.mem_write(second, self.data[self.position : end])
            self.position = end
            result = third
        elif first == self.STREAM and name == "tell":
            result = self.position
        elif first == self.STREAM and name == "seek":
            if second > len(self.data):
                raise ValueError("Original stream seek exceeded the Map11 bytes")
            self.position = second
        else:
            raise ValueError(f"Unsupported native boundary {name} at {address - self.base:#x}")
        stack = cpu.reg_read(reg.UC_X86_REG_RSP)
        cpu.reg_write(reg.UC_X86_REG_RAX, result)
        cpu.reg_write(reg.UC_X86_REG_RIP, self.get(stack))
        cpu.reg_write(reg.UC_X86_REG_RSP, stack + 8)

    def call(self, rva, registers, *, stop_rva=None):
        self.put(self.STACK, self.ARENA)
        self.cpu.reg_write(reg.UC_X86_REG_RSP, self.STACK)
        for register, value in registers.items():
            self.cpu.reg_write(register, value)
        address = self.base + rva
        stop = self.ARENA if stop_rva is None else self.base + stop_rva
        for _ in range(32):
            self.cpu.emu_start(address, stop, count=5_000_000)
            address = self.cpu.reg_read(reg.UC_X86_REG_RIP)
            if address == stop:
                return self.cpu.reg_read(reg.UC_X86_REG_RAX)
        raise ValueError(f"Native navgrid call exceeded its instruction budget at {address - self.base:#x}")

    def load(self):
        self.call(self.CONSTRUCT, {reg.UC_X86_REG_RDI: self.MANAGER})
        if self.get(self.base + self.MANAGER_GLOBAL) != self.MANAGER or self.get(self.MANAGER + 8):
            raise ValueError("Native manager publication differs before loading")
        self.call(
            self.LOAD,
            {
                reg.UC_X86_REG_RDI: self.MANAGER,
                reg.UC_X86_REG_RSI: 0,
                reg.UC_X86_REG_RDX: self.STREAM,
            },
        )
        runtime = self.get(self.MANAGER + 8)
        if (
            self.position != len(self.data)
            or self.get(runtime + 0x6E8) != self.MANAGER
            or self.get(runtime + 0x6F0)
            or self.get(runtime + 0xBA, "B") != 1
        ):
            raise ValueError("Native navigation load did not close the exact archive input")
        return runtime

    def query(self, x, z, radius):
        registers = dict(
            zip(
                (reg.UC_X86_REG_XMM0, reg.UC_X86_REG_XMM1, reg.UC_X86_REG_XMM2),
                struct.unpack("<III", struct.pack("<fff", x, z, radius)),
                strict=True,
            )
        )
        return [self.call(rva, registers) & 255 for rva in self.TERRAIN_QUERIES]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("binary", "navgrid", "materials", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    materials = args.materials.read_bytes()
    bound_field = materials[1675416:1675429]
    if sha(materials) != MATERIAL_SHA or bound_field[:5] != bytes.fromhex("663556bf0b"):
        raise ValueError("Expected the exact Map11 authored maximum bound field")
    oracle = FogNavgrid(MachImage(args.binary.read_bytes()), args.navgrid.read_bytes())
    runtime = oracle.load()
    dimensions = [oracle.get(runtime + offset, "I") for offset in (0xD4, 0xD8)]
    if dimensions != [295, 296] or oracle.get(runtime + 0xC8, "f") != 50.0:
        raise ValueError("Original terrain query grid dimensions differ")
    report = {
        "build": "16.23.840.6595",
        "protocol": "8bbfcd5af2bc92db",
        "machSliceSha256": MACH_SHA,
        "navgridSha256": MAP_SHA,
        "materialsSha256": MATERIAL_SHA,
        "nativeManagerConstructorRva": oracle.CONSTRUCT,
        "nativeNavgridLoaderRva": oracle.LOAD,
        "nativeNavgridGlobalRva": oracle.MANAGER_GLOBAL,
        "nativeNavigationBytesConsumed": oracle.position,
        "nativeQueryDimensions": dimensions,
        "nativeQueryCellWorldUnits": oracle.get(runtime + 0xC8, "f"),
        "authoredMapMaximumXZ": struct.unpack_from("<ff", bound_field, 5),
        "authoredMapMaximumFieldHex": bound_field.hex(),
        "sampleQueryRvas": oracle.TERRAIN_QUERIES,
        "sampleQueries": [
            {"arguments": point, "results": oracle.query(*point)}
            for point in [(1000, 1000, 0), (7000, 7000, 0), (3345, 11379, 130), (11531, 3853, 125), (11822, 9899, 0)]
        ],
        "hostBoundaryCalls": oracle.calls,
        "scope": {
            "nativeMap11TerrainQueriesExecuted": True,
            "mapOwnerSupplied": False,
            "matchFogReconstructed": False,
            "rendererAdmission": False,
        },
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)


if __name__ == "__main__":
    main()

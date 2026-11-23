"""Verify health group prefixes with the pinned archived replay-build instructions."""

import argparse
import json
import struct
from collections import Counter
from hashlib import sha256
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_MODE_64, Uc
from unicorn import x86_const as r

SLICE_SHA256 = "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa"
ARENA = 0x20000000
STOP, STACK = ARENA, ARENA + 0x3FF8
ENTITY, DESCRIPTOR, SLOT, INPUT = (ARENA + offset for offset in (0x5000, 0x7000, 0x8000, 0x9000))
CURRENT, MAXIMUM = 0x920, 0x948


def verify(archive, groups):
    image = MachImage(archive)
    if sha256(image.binary).hexdigest() != SLICE_SHA256:
        raise ValueError("Wrong archived health decoder")
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))
    vm.mem_map(ARENA, 0xA000)
    vm.mem_write(SLOT, struct.pack("<Q", DESCRIPTOR))

    def execute(start, registers, stop=STOP):
        vm.mem_write(STACK, struct.pack("<Q", STOP))
        vm.reg_write(r.UC_X86_REG_RSP, STACK)
        for register, value in registers.items():
            vm.reg_write(register, value)
        vm.emu_start(image.base + start, stop, count=2048)
        if vm.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError("Native health probe exceeded its instruction budget")
        return vm.reg_read(r.UC_X86_REG_RAX)

    # Hero registration fragments use native field addresses and name hashes.
    for index, (start, end) in enumerate(((0xEE140, 0xEE159), (0xEE1D1, 0xEE1ED))):
        actual = execute(
            start,
            {
                r.UC_X86_REG_RDI: ENTITY,
                r.UC_X86_REG_RSI: ENTITY,
                r.UC_X86_REG_R14: ENTITY,
                r.UC_X86_REG_RBX: ENTITY,
                r.UC_X86_REG_R15: DESCRIPTOR,
            },
            image.base + end,
        )
        if actual != index:
            raise ValueError("Native health registration order changed")
    fields, float_mask, current, maximum = struct.unpack("<I4xQII", vm.mem_read(DESCRIPTOR, 24))
    if (fields, float_mask, current, maximum) != (2, 3, CURRENT, MAXIMUM):
        raise ValueError("Unexpected native health descriptor")

    # The hero vtable slots are the ones immediately preceding maxHealth and
    # currentHealth in the same-build Live Client API serializer.
    vtable = 0x235F778
    getter_rvas = {
        name: struct.unpack_from("<Q", image.image, vtable + slot)[0] - image.base
        for name, slot in (("current", 0x6D0), ("max", 0x708))
    }
    if getter_rvas != {"current": 0xCD200, "max": 0xCD1E0}:
        raise ValueError("Native health getter slots changed")
    for name, offset in (("current", CURRENT), ("max", MAXIMUM)):
        vm.mem_write(ENTITY + offset, struct.pack("<f", 123.5 + offset))
        execute(getter_rvas[name], {r.UC_X86_REG_RDI: ENTITY})
        bits = vm.reg_read(r.UC_X86_REG_XMM0) & 0xFFFFFFFF
        if struct.pack("<I", bits) != struct.pack("<f", 123.5 + offset):
            raise ValueError(f"Native {name} getter reads unexpected storage")

    counts = Counter()
    for row in groups:
        encoded = bytes.fromhex(row["bytes"])
        if len(encoded) > 255:
            raise ValueError("Recorded group exceeds the one-byte length field")
        vm.mem_write(ENTITY + CURRENT, bytes(MAXIMUM - CURRENT + 4))
        vm.mem_write(INPUT, encoded + bytes(8))
        prefix = execute(
            0x1D7700,
            {
                r.UC_X86_REG_RDI: SLOT,
                r.UC_X86_REG_RSI: ENTITY,
                r.UC_X86_REG_RDX: row["fieldMask"],
                r.UC_X86_REG_RCX: INPUT,
            },
        )
        if prefix != row["prefixBytes"] or prefix > len(encoded):
            raise ValueError("Native group prefix consumed different bytes")
        for bit, name, offset in ((1, "current", CURRENT), (2, "max", MAXIMUM)):
            if row["fieldMask"] & bit and (
                bytes(vm.mem_read(ENTITY + offset, 4)) != struct.pack("<f", row["values"][name])
            ):
                raise ValueError(f"Native replay disagrees with decoded {name} health")
        counts[row["stream"]] += 1
    return {"getterRvas": getter_rvas, "floatOffsets": [current, maximum], "groupsByStream": dict(counts)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("groups", type=Path)
    parser.add_argument("receipt", type=Path)
    args = parser.parse_args()
    source = args.groups.read_bytes()
    payload = json.loads(source)
    result = verify(args.archive.read_bytes(), payload["groups"])
    result.update(replaySha256=payload["identity"], groupsSha256=sha256(source).hexdigest(), sliceSha256=SLICE_SHA256)
    receipt = json.dumps(result, sort_keys=True)
    with args.receipt.open("x", encoding="utf-8") as output:
        output.write(receipt + "\n")
    print(receipt)

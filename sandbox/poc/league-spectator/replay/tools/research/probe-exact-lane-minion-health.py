"""Verify group-8 lane-minion health in the archived .8428 reader and getters.

The input uses the same group-prefix JSON shape as probe-exact-champion-health.
Its original replay SHA and expected field bits are retained in the receipt.
The factory chain is checked statically, and only the health caller, field
reader, and minion getters execute inside an owned Unicorn arena.
"""

import argparse
import json
import re
import struct
import sys
from collections import Counter
from hashlib import sha256
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_MODE_64, Uc
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image


def native_anchors(image):
    def target(start, opcode):
        assert image.image[start : start + len(opcode)] == opcode
        offset = start + len(opcode)
        return offset + 4 + struct.unpack_from("<i", image.image, offset)[0]

    # The previously verified AIMinionClient registry type and its factory use
    # the same descriptor. The registered constructor publishes this vtable.
    assert image.image[0x198556:0x19855B] == bytes.fromhex("beb28ca5ca")
    descriptor = target(0x198533, bytes.fromhex("488d3d"))
    assert target(0x19853A, bytes.fromhex("488d15")) == 0x196690
    assert target(0x1966A7, b"\xe8") == 0x17F460
    vtable = target(0x17F48F, bytes.fromhex("488d05"))
    assert image.image[0x17F496:0x17F499] == bytes.fromhex("488903")
    assert target(0x17A192, bytes.fromhex("488d3d")) == descriptor + 8
    assert target(0x17A1A6, b"\xe8") == 0xC1790
    assert image.image[0x17A1AB:0x17A1AE] == bytes.fromhex("4889c3")
    assert target(0x17A40B, b"\xe8") == 0x17A570
    assert target(0x17A6D0, b"\xe8") == 0x17AD70
    assert image.image[0x17AE26:0x17AE2E] == bytes.fromhex("8b40648945bca808")
    assert image.image[0x17AF44:0x17AF49] == bytes.fromhex("b908000000")
    assert target(0x17AF49, b"\xe8") == 0xEE120
    current_getter, max_getter = (
        struct.unpack_from("<Q", image.image, vtable + slot)[0] - image.base for slot in (0x6D8, 0x710)
    )
    assert (descriptor, vtable) == (0x2509020, 0x236F000)
    assert (current_getter, max_getter) == (0xCD200, 0xCD1E0)
    return descriptor, vtable, current_getter, max_getter


def verify(image, groups):
    descriptor, vtable, current_getter, max_getter = native_anchors(image)
    base = 0x20000000
    stack = base + 0x2FF8
    entity, group, slot, body = (base + offset for offset in (0x4000, 0x9000, 0xA000, 0xB000))
    runtime = Uc(UC_ARCH_X86, UC_MODE_64)
    runtime.mem_map(image.base, len(image.image))
    runtime.mem_write(image.base, bytes(image.image))
    runtime.mem_map(base, 0xC000)

    def put(address, format_string, *values):
        runtime.mem_write(address, struct.pack(format_string, *values))

    def read(address, format_string):
        return struct.unpack(format_string, runtime.mem_read(address, struct.calcsize(format_string)))

    def call(start, registers, end=base):
        runtime.reg_write(r.UC_X86_REG_RSP, stack)
        put(stack, "<Q", base)
        for register, value in registers.items():
            runtime.reg_write(register, value)
        runtime.emu_start(image.base + start, end, count=2048)
        assert runtime.reg_read(r.UC_X86_REG_RIP) == end
        return runtime.reg_read(r.UC_X86_REG_RAX)

    put(entity, "<Q", image.base + vtable)
    put(slot, "<Q", group)
    # Pre-initialize optional pointer-backed configuration to disabled so
    # the caller and getters exercise the original direct float stores.
    put(image.base + 0x25D4B08, "<3B", 1, 0, 0)
    call(
        0x17AF37,
        {r.UC_X86_REG_RBX: entity, r.UC_X86_REG_R15: group, r.UC_X86_REG_RBP: stack + 0x400},
        image.base + 0x17AF4E,
    )
    assert read(group, "<I4xQII") == (11, 1023, 0x920, 0x948)
    assert read(entity + 0x924, "<IB") == (0, 8)
    assert read(entity + 0x94C, "<IB") == (1, 8)

    counts = Counter()
    for row in groups:
        encoded = bytes.fromhex(row["bytes"])
        mask = row["fieldMask"]
        stream = row["stream"]
        if not (1 <= len(encoded) <= 255 and 0 < mask <= 0xFFFFFFFF and mask & 3 and stream in (1, 2)):
            raise ValueError("Invalid minion group prefix input")
        runtime.mem_write(body, encoded + bytes(8))
        consumed = call(
            0x1D7700,
            {r.UC_X86_REG_RDI: slot, r.UC_X86_REG_RSI: entity, r.UC_X86_REG_RDX: mask & 3, r.UC_X86_REG_RCX: body},
        )
        if consumed != row["prefixBytes"] or consumed > len(encoded):
            raise ValueError("Native minion reader consumed a different prefix")
        for name, bit, getter in (("current", 1, current_getter), ("max", 2, max_getter)):
            if mask & bit:
                call(getter, {r.UC_X86_REG_RDI: entity})
                bits = runtime.reg_read(r.UC_X86_REG_XMM0) & 0xFFFFFFFF
                if struct.pack("<I", bits) != struct.pack("<f", row["values"][name]):
                    raise ValueError(f"Native minion {name} getter disagrees with the prefix")
        counts[stream] += 1
    return {
        "typeHash": "0xcaa58cb2",
        "descriptorRva": hex(descriptor),
        "vtableRva": hex(vtable),
        "registrationRva": "0x17ad70",
        "group": 8,
        "current": {"index": 0, "storage": "0x920", "getterRva": hex(current_getter)},
        "max": {"index": 1, "storage": "0x948", "getterRva": hex(max_getter)},
        "agreementByStream": dict(counts),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("groups", type=Path)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--groups-sha256", required=True)
    if not __debug__:
        parser.error("Run without Python optimization so native validation is active")
    args = parser.parse_args()
    inputs = args.groups.read_bytes()
    digest = sha256(inputs).hexdigest()
    if digest != args.groups_sha256:
        parser.error("Group-prefix evidence differs from its reviewed SHA-256")
    payload = json.loads(inputs)
    if (
        payload["build"] != CURRENT_BUILD
        or not re.fullmatch(r"[a-f0-9]{64}", payload["identity"])
        or not isinstance(payload["groups"], list)
        or not payload["groups"]
    ):
        parser.error("Expected nonempty .8428 evidence bound to a replay")
    archive = args.archive.read_bytes()
    result = {
        "schema": 1,
        "build": CURRENT_BUILD,
        "archiveSha256": sha256(archive).hexdigest(),
        "groupsSha256": digest,
        "replaySha256": payload["identity"],
        **verify(read_replication_image(archive, CURRENT_BUILD), payload["groups"]),
    }
    receipt = json.dumps(result, sort_keys=True)
    with args.receipt.open("x", encoding="utf-8") as output:
        output.write(receipt + "\n")
    print(receipt)

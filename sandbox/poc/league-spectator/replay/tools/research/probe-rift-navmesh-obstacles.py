"""Verify the original transient-obstacle reader against the reviewed Rift replay census."""

import argparse
import json
import struct
import sys
from hashlib import sha256
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image

FACTORY = 0x1018E8D
READER = 0x11C2990
DISPATCH = 0x6E4AB0
DISPATCH_TABLE = 0x6F5F28
STOP, STACK, PACKET, INPUT, CURSOR, OUTPUT = (
    0x10000000 + offset for offset in (0, 0xFF8, 0x1000, 0x2000, 0x2010, 0x2020)
)
CENSUS_SHA = "098ec322df6c6b129b9159cb1bbbf240d6723603f116061719da7bad93d5edf4"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", type=Path)
    parser.add_argument("census", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not __debug__:
        parser.error("Native proofs require Python assertions enabled")

    source = args.census.read_bytes()
    if sha256(source).hexdigest() != CENSUS_SHA:
        raise ValueError("Expected the exact complete .8428 Rift obstacle census")
    census = json.loads(source)
    rows = census["rows"]
    archive = args.client.read_bytes()
    image = read_replication_image(archive, CURRENT_BUILD)
    callbacks = {
        41: (0x6F3256, 0x6F3263, 0x1C4A70),
        493: (0x6E7EA0, 0x6E7ED3, 0x1C3980),
        1055: (0x6E86F3, 0x6E8700, 0x1C37D0),
    }
    for opcode, (case, call, callback) in callbacks.items():
        lookup = DISPATCH_TABLE + struct.unpack_from("<i", image.image, DISPATCH_TABLE + (opcode - 12) * 4)[0]
        target = call + 5 + struct.unpack_from("<i", image.image, call + 1)[0]
        if lookup != case or image.image[call] != 0xE8 or target != callback:
            raise ValueError(f"Original obstacle dispatch differs for {opcode}")

    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))
    vm.mem_map(STOP, 0x10000)
    vm.mem_write(image.base + 0x24DC310, struct.pack("<Q", STOP + 0x40))
    event_trace = []

    def scalar(at, fmt="Q"):
        return struct.unpack("<" + fmt, vm.mem_read(at, struct.calcsize(fmt)))[0]

    def hook(engine, address, _size, name):
        first = engine.reg_read(r.UC_X86_REG_RDI)
        if name == "allocate":
            if first != 0x20:
                raise ValueError("Unexpected archived obstacle packet allocation")
            engine.mem_write(PACKET, bytes(first))
            result = PACKET
        elif name == "transport":
            engine.mem_write(first + 12, bytes(4))
            result = 1
        elif name == "active-grid":
            result = 1
        elif name in ("clear", "refresh"):
            event_trace.append(name)
            result = 0
        else:
            raise ValueError("The original dispatcher tried to create an obstacle")
        stack = engine.reg_read(r.UC_X86_REG_RSP)
        engine.reg_write(r.UC_X86_REG_RAX, result)
        engine.reg_write(r.UC_X86_REG_RIP, scalar(stack))
        engine.reg_write(r.UC_X86_REG_RSP, stack + 8)

    for address, name in {
        0x14A0300: "allocate",
        0x1637CB0: "transport",
        0x16DDD70: "active-grid",
        0x16DFA90: "clear",
        0x221030: "refresh",
        0x1C3980: "create",
    }.items():
        address += image.base
        vm.hook_add(UC_HOOK_CODE, hook, name, begin=address, end=address)

    def call(start, by_register, stop=STOP):
        vm.mem_write(STACK, struct.pack("<Q", STOP))
        vm.reg_write(r.UC_X86_REG_RSP, STACK)
        for register, value in by_register.items():
            vm.reg_write(register, value)
        vm.emu_start(image.base + start, stop, count=1000)
        if vm.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError("Original obstacle fragment escaped its execution bound")
        return vm.reg_read(r.UC_X86_REG_AL)

    if len(rows) != 41 or [row["chunk"] for row in rows] != census["keyframeChunks"]:
        raise ValueError("Expected a complete obstacle keyframe sequence")
    for row in rows:
        if (row["stream"], row["context"], row["opcode"], row["body"]) != (2, 0, 493, "1c"):
            raise ValueError("Unexpected obstacle envelope in the reviewed replay")
        call(FACTORY, {r.UC_X86_REG_RBX: OUTPUT}, image.base + 0x101C304)
        if (
            scalar(OUTPUT) != PACKET
            or scalar(PACKET + 8, "H") != 493
            or scalar(scalar(PACKET) + 8) != image.base + READER
        ):
            raise ValueError("Original obstacle factory did not publish the expected packet")
        vm.mem_write(INPUT, bytes.fromhex(row["body"]))
        vm.mem_write(CURSOR, struct.pack("<Q", INPUT))
        ok = call(READER, {r.UC_X86_REG_RDI: PACKET, r.UC_X86_REG_RSI: CURSOR, r.UC_X86_REG_RDX: INPUT + 1})
        if ok != 1 or scalar(CURSOR) != INPUT + 1 or scalar(PACKET + 0x18, "I") != 0:
            raise ValueError("Original reader did not consume an empty obstacle list")
        event_trace.clear()
        if call(DISPATCH, {r.UC_X86_REG_RDI: 0, r.UC_X86_REG_RSI: PACKET}) != 1:
            raise ValueError("Original obstacle dispatch failed")
        if event_trace != ["clear", "refresh"]:
            raise ValueError("Unexpected original obstacle snapshot operations")

    ring = (1712.7284140625, 1714.7334140625)
    receipt = {
        "schema": 1,
        "kind": "native-rift-persistent-obstacle-window",
        "build": CURRENT_BUILD,
        "replaySha256": census["replaySha256"],
        "censusSha256": CENSUS_SHA,
        "clientSha256": sha256(archive).hexdigest(),
        "physicalEnvelopesScanned": census["physicalEnvelopesScanned"],
        "emptyNativeKeyframes": len(rows),
        "ordinaryObstacleEnvelopes": 0,
        "ringWindow": ring,
        "before": max(row["timeSeconds"] for row in rows if row["timeSeconds"] <= ring[0]),
        "after": min(row["timeSeconds"] for row in rows if row["timeSeconds"] >= ring[1]),
        "scope": "Physical obstacle packet ingress and empty native reader with active-grid dispatch control",
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(receipt, file, separators=(",", ":"))
        file.write("\n")
    print(f"Verified {len(rows)} empty native obstacle keyframes.")


if __name__ == "__main__":
    main()

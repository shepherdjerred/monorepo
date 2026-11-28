"""Decode exact-build Map11 particle creations through the archived packet handler."""

import argparse
import json
import math
import re
import struct
import sys
from hashlib import sha256
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import (
    CURRENT_ARCHIVE_SHA256,
    CURRENT_BUILD,
    read_replication_image,
)

REPLAY_SHA256 = "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
PROTOCOL = "8bbfcd5af2bc92db"
PACKET_COUNT = 17711
RESOURCE_KEY = 0x0FB3CB06
HEIMER_OWNER = 1073742161
STOP = 0x10000000
OBJECT, CURSOR, BODY, CONFIG, GRID = (STOP + x for x in (0x100, 0x400, 0x1000, 0x3000, 0x5000))
STACK = STOP + 0xF008
HEAP = STOP + 0x10000
EMPTY = bytes(0x100000)
MAP_BOUNDS_XZ = (-1.1048965454101562, 32.75579833984375, 14718.400390625, 14792.2109375)
BLOOM_TERRAIN_SHA256 = "b3e29e66817b13c4104f68e2a33f7ec2d65eab8f51f0bd01f8b48dd1f0f73cf4"
ALLOCATORS = {0x14A0300, 0x14A2030, 0x14C5B20}


def rotate(value, count):
    return ((value << count) | (value >> (8 - count))) & 255


def swap(value):
    return ((value << 1) & 170) | ((value >> 1) & 85)


class GroupedReader:
    def __init__(self, image, map_bounds_xz=MAP_BOUNDS_XZ):
        self.image = image
        self.map_bounds_xz = map_bounds_xz
        self.machine = Uc(UC_ARCH_X86, UC_MODE_64)
        self.machine.mem_map(image.base, len(image.image))
        self.machine.mem_write(image.base, bytes(image.image))
        self.machine.mem_map(STOP, len(EMPTY))
        table = image.image[0x2141640:0x2141740]
        self.key = bytes(swap(rotate((rotate((0x5B - x) & 255, 3) + 0xEC) & 255, 4)) for x in range(256))
        self.owner = bytes(table[(~rotate(rotate((x + 0x20) & 255, 1) ^ 0x47, 4)) & 255] for x in range(256))
        self.handle = bytes(
            rotate(table[rotate(table[((swap(x) ^ 0xA0) + 0x43) & 255] ^ 0x25, 6)], 7) for x in range(256)
        )
        self.parent = bytes((0xE0 - swap((swap(x) + 0x3E) & 255)) & 255 for x in range(256))
        for address in set(image.imports) | ALLOCATORS | {0x1637CB0}:
            self.hook(address, self.on_call)
        for address in (0x558830, 0x5564C0, 0x361090, 0x864870, 0x14A0240, 0x866394, 0x866458):
            self.hook(address, self.on_placement)
        for address, name in image.data_imports.items():
            if name == "___stack_chk_guard":
                self.put_pointer(image.base + address, STOP + 0x2000)

    def hook(self, address, callback):
        absolute = self.image.base + address
        self.machine.hook_add(UC_HOOK_CODE, callback, begin=absolute, end=absolute)

    def read(self, address, width):
        return int.from_bytes(self.machine.mem_read(address, width), "little")

    def put_pointer(self, address, target):
        self.machine.mem_write(address, struct.pack("<Q", target))

    def call(self, rva, first=0, second=0, third=0, end=STOP):
        self.put_pointer(STACK, STOP)
        for register, value in (
            (r.UC_X86_REG_RDI, first),
            (r.UC_X86_REG_RSI, second),
            (r.UC_X86_REG_RDX, third),
            (r.UC_X86_REG_RSP, STACK),
            (r.UC_X86_REG_RBP, 0),
        ):
            self.machine.reg_write(register, value)
        self.machine.emu_start(self.image.base + rva, end, count=1_000_000)
        if self.machine.reg_read(r.UC_X86_REG_RIP) != end:
            raise ValueError(f"Archived execution exited at unexpected address for {rva:#x}")

    def return_value(self, value):
        stack = self.machine.reg_read(r.UC_X86_REG_RSP)
        self.machine.reg_write(r.UC_X86_REG_RAX, value)
        self.machine.reg_write(r.UC_X86_REG_RIP, self.read(stack, 8))
        self.machine.reg_write(r.UC_X86_REG_RSP, stack + 8)

    def on_call(self, machine, address, _size, _data):
        rva = address - self.image.base
        name = self.image.imports.get(rva)
        first = machine.reg_read(r.UC_X86_REG_RDI)
        second = machine.reg_read(r.UC_X86_REG_RSI)
        third = machine.reg_read(r.UC_X86_REG_RDX)
        if rva == 0x1637CB0:
            # ROFL transport already decoded the outer context field.
            machine.mem_write(first + 12, struct.pack("<I", self.context))
            value = 1
        elif rva in ALLOCATORS or name == "_malloc":
            value = self.heap
            self.heap += max(32, (first + 31) & ~31)
            if self.heap > STOP + len(EMPTY):
                raise ValueError("Grouped packet allocation exceeded owned heap")
        elif name == "___cxa_guard_acquire":
            value = int(self.read(first, 1) == 0)
        elif name == "___cxa_guard_release":
            machine.mem_write(first, b"\x01")
            value = 0
        elif name in {"___cxa_atexit", "_pthread_mutex_lock", "_pthread_mutex_unlock"}:
            value = 0
        elif name == "___bzero":
            machine.mem_write(first, bytes(second))
            value = first
        elif name in {"_memcpy", "_memmove"}:
            machine.mem_write(first, bytes(machine.mem_read(second, third)))
            value = first
        else:
            raise ValueError(f"Unowned archived call {name} at {rva:#x}")
        self.return_value(value)

    def on_placement(self, machine, address, _size, _data):
        rva = address - self.image.base
        if rva in (0x866394, 0x866458):
            if rva != 0x866394:
                raise ValueError("Detached particle selected a different placement path")
            base = machine.reg_read(r.UC_X86_REG_RBP) - 0x198
            data = machine.mem_read(base, 0xC0)
            self.descriptor = {
                "resourceKey": struct.unpack_from("<I", data, 8)[0],
                "flags": struct.unpack_from("<I", data, 0x48)[0],
                "positions": [struct.unpack_from("<3f", data, at) for at in (0x54, 0x60, 0x6C)],
                "scaleRate": struct.unpack_from("<2f", data, 0x78),
            }
            machine.emu_stop()
            return
        caller = self.read(machine.reg_read(r.UC_X86_REG_RSP), 8) - self.image.base
        self.lookups[caller] = machine.reg_read(r.UC_X86_REG_ESI)
        # These imports need an initialized live object registry; a detached
        # placement takes the verified null branch before publishing anything.
        self.return_value(0)

    def decode(self, payload, context):
        if len(payload) > CONFIG - BODY:
            raise ValueError("Grouped packet exceeded its owned input span")
        self.machine.mem_write(STOP, EMPTY)
        self.heap = HEAP
        self.context = context
        self.put_pointer(self.image.base + 0x24E8590, CONFIG)
        self.machine.mem_write(CONFIG + 8, b"\x04")
        self.machine.mem_write(CONFIG + 0x70, b"\x01")
        self.machine.reg_write(r.UC_X86_REG_RBX, OBJECT)
        self.call(0x101276D, end=self.image.base + 0x101C304)
        packet = self.read(OBJECT, 8)
        if self.read(packet + 8, 2) != 938:
            raise ValueError("Wrong archived packet constructor")
        self.machine.mem_write(BODY, payload)
        self.put_pointer(CURSOR, BODY)
        self.call(0x1145C10, packet, CURSOR, BODY + len(payload))
        consumed = self.read(CURSOR, 8) - BODY
        if self.machine.reg_read(r.UC_X86_REG_AL) != 1 or consumed != len(payload):
            return None
        pointer, count = self.read(packet + 16, 8), self.read(packet + 24, 4)
        if count and not HEAP <= pointer <= pointer + count * 80 <= self.heap:
            raise ValueError("Grouped packet exceeded its allocated group span")
        return [(pointer + index * 80) for index in range(count)]

    def entries(self, group):
        pointer, count = self.read(group + 0x40, 8), self.read(group + 0x48, 4)
        if count and not HEAP <= pointer <= pointer + count * 192 <= self.heap:
            raise ValueError("Grouped packet exceeded its allocated entry span")
        return range(pointer, pointer + count * 192, 192)

    def field(self, address, table):
        return int.from_bytes(self.machine.mem_read(address, 4).translate(table), "little")

    def placement(self, group, entry, handle, owner, resource_key):
        for offset, value in zip((0xBC, 0xC4, 0xDC, 0xE4), self.map_bounds_xz, strict=True):
            self.machine.mem_write(GRID + offset, struct.pack("<f", value))
        self.machine.reg_write(r.UC_X86_REG_R12, GRID)
        self.call(0x16DB78C, end=self.image.base + 0x16DB7E9)
        self.lookups = {}
        self.descriptor = None
        self.call(0x864BE0, group, entry, end=self.image.base + 0x866394)
        # Inspect descriptor at the original instruction boundary before any
        # effect creation. Unicorn stops before running the hook at end.
        self.on_placement(self.machine, self.image.base + 0x866394, 0, None)
        descriptor = self.descriptor
        if (
            self.lookups.get(0x864D10) != handle
            or self.lookups.get(0x864DB1) != owner
            or descriptor["resourceKey"] != resource_key
        ):
            raise ValueError("Packet fields and archived placement lookup disagree")
        if not all(math.isfinite(value) for xyz in descriptor["positions"] for value in xyz):
            raise ValueError("Nonfinite archived placement")
        return descriptor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("packets", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--inventory",
        nargs=2,
        type=float,
        metavar=("START", "END"),
        help="Inventory every creation entry within a half-open replay-clock interval",
    )
    parser.add_argument("--corpus-sha256", help="Bind an inventory to a different replay packet corpus")
    parser.add_argument("--bloom-terrain-receipt", type=Path, help="Use the recorded Bloom terrain bounds for a pinned inventory")
    args = parser.parse_args()
    corpus_bytes = args.packets.read_bytes()
    if args.corpus_sha256 is not None:
        if args.inventory is None:
            parser.error("An explicit corpus digest requires inventory mode")
        if sha256(corpus_bytes).hexdigest() != args.corpus_sha256:
            raise ValueError("The recorded particle-create corpus digest differs")
        if not args.output.parent.resolve().is_relative_to(Path(".cache").resolve()) or args.output.exists():
            raise ValueError("Expected a fresh private .cache output")
    source = json.loads(corpus_bytes.decode("utf-8-sig"))
    if args.corpus_sha256 is not None and source.get("opcode") != 938:
        raise ValueError("Expected a recorded particle-create corpus")
    packets = source["packets"]
    replay_digest = source["replaySha256"]
    if (source["build"], source["protocol"]) != (CURRENT_BUILD, PROTOCOL) or not re.fullmatch(
        "[a-f0-9]{64}", replay_digest
    ):
        raise ValueError("Unsupported recorded particle-create corpus identity")
    if args.corpus_sha256 is None and (replay_digest, len(packets)) != (REPLAY_SHA256, PACKET_COUNT):
        raise ValueError("Replay identity differs from the exact roster binding")
    bounds = MAP_BOUNDS_XZ
    if args.bloom_terrain_receipt is not None:
        if args.inventory is None or args.corpus_sha256 is None:
            parser.error("Bloom terrain requires a pinned inventory corpus")
        terrain_bytes = args.bloom_terrain_receipt.read_bytes()
        if sha256(terrain_bytes).hexdigest() != BLOOM_TERRAIN_SHA256:
            raise ValueError("Recorded Bloom terrain receipt differs")
        terrain = json.loads(terrain_bytes)
        if (
            (terrain["configuredMapId"], terrain["mode"], terrain["configurationMapSkin"])
            != (12, "KIWI", "Bloom")
            or terrain["replaySha256"] != replay_digest
        ):
            raise ValueError("Recorded particle-create corpus does not belong to Bloom terrain")
        navigation = terrain["navigation"]
        bounds = tuple(navigation[key][lane] for key in ("min", "max") for lane in (0, 2))
    reader = GroupedReader(read_replication_image(args.archive.read_bytes(), CURRENT_BUILD), bounds)
    if args.inventory is not None:
        start, end = args.inventory
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
            raise ValueError("Invalid inventory bounds")
    events = []
    control = None
    group_count = entry_count = non_detached = 0
    packet_count = 0
    previous_sequence = -1
    for stamp, sequence, context, encoded in packets:
        if not math.isfinite(stamp) or stamp < 0 or sequence <= previous_sequence:
            raise ValueError("Invalid packet clock or acquisition order")
        previous_sequence = sequence
        if args.inventory is not None and not start <= stamp < end:
            continue
        packet_count += 1
        payload = bytes.fromhex(encoded)
        groups = reader.decode(payload, context)
        if groups is None:
            raise ValueError(f"Incomplete grouped replay body at packet {sequence}")
        group_count += len(groups)
        for group in groups:
            entries = reader.entries(group)
            entry_count += len(entries)
            resource_key = reader.field(group + 0x30, reader.key)
            if args.inventory is None and resource_key != RESOURCE_KEY:
                continue
            for entry in entries:
                owner = reader.field(entry + 0x70, reader.owner)
                if args.inventory is None and owner != HEIMER_OWNER:
                    continue
                parent = reader.field(entry + 0xA0, reader.parent)
                if parent != 0 and args.inventory is None:
                    non_detached += 1
                    continue
                handle = reader.field(entry + 0x98, reader.handle)
                descriptor = reader.placement(group, entry, handle, owner, resource_key) if parent == 0 else None
                event = {
                    "stamp": stamp,
                    "sequence": sequence,
                    "handle": handle,
                    "owner": owner,
                    "context": context,
                    "packetSha256": sha256(payload).hexdigest(),
                    "descriptor": descriptor,
                }
                if args.inventory is not None:
                    event.update(
                        parent=parent,
                        resourceKey=resource_key,
                        status=(
                            "detached-placement-confirmed"
                            if descriptor is not None
                            else "requires-attachment-resolution"
                        ),
                    )
                events.append(event)
                if control is None:
                    control = payload, context
    if control is None:
        raise ValueError("Selected roster and effect had no verified placements")
    control_payload, control_context = control
    if reader.decode(control_payload[:-1], control_context) is not None:
        raise ValueError("Truncated grouped packet was admitted")
    if reader.decode(control_payload + b"\xaf", control_context) is not None:
        raise ValueError("Extended grouped packet was admitted")
    if reader.decode(control_payload, control_context) is None:
        raise ValueError("Unmodified grouped control was rejected")
    result = {
        "schema": 1,
        "build": CURRENT_BUILD,
        "protocol": PROTOCOL,
        "replaySha256": replay_digest,
        "executableSha256": CURRENT_ARCHIVE_SHA256,
        "packetCount": packet_count,
        "groupCount": group_count,
        "entryCount": entry_count,
        "nonDetachedExcluded": non_detached,
        "events": events,
    }
    if args.inventory is not None:
        result["window"] = args.inventory
        result["mode"] = "creation-inventory"
        result["lifecycleEvidence"] = "creation-only"
    if args.corpus_sha256 is not None:
        result["corpusSha256"] = args.corpus_sha256
    mode = "xb" if args.corpus_sha256 is not None else "wb"
    with args.output.open(mode) as handle:
        handle.write((json.dumps(result, indent=2) + "\n").encode("utf-8"))
    entry_kind = "creation entries" if args.inventory is not None else "detached impacts"
    print(f"Verified {len(events)} {entry_kind} in {packet_count} fully consumed packets")


if __name__ == "__main__":
    main()

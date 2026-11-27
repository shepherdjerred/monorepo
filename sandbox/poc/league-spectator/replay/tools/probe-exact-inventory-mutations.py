"""Verify recorded inventory mutation bodies and native consumer arguments."""

import argparse
import hashlib
import json
import re
import struct
from importlib import import_module
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc, UcError
from unicorn import x86_const as reg

baseline = import_module("probe-exact-inventory-set")
SOURCE_HASHES = {
    "da4d842e11c9c04dfb003fd67ab1e15aaefb0ab26e13a1d5efc4d1403e8a7495",
    "e06f536cff87123b0bf792a6d2c52a11ca90d7e615d6a6e4ad8d65e226447569",
}
CURRENT_BUILD = "16.23.841.8428"
CURRENT_ARCHIVE = "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
READERS = {
    190: 0x119B530,
    226: 0x11A02A0,
    248: 0x119B5B0,
    415: 0x119A4C0,
    797: 0x119DF60,
    840: 0x119D510,
    1143: 0x11A0540,
    1214: 0x119A5C0,
}
BASE = 0x6000000
STOP, STACK, CURSOR, DATA, ITEM, SLOT = (BASE + offset for offset in (0, 0xFFF8, 0x1000, 0x2000, 0x4000, 0x6000))


def decode(image, rows):
    emu = Uc(UC_ARCH_X86, UC_MODE_64)
    emu.mem_map(image.base, len(image.image))
    emu.mem_write(image.base, bytes(image.image))
    emu.mem_map(BASE, 0x40000)
    encode = baseline.context_encoder(image.image)
    table = image.base + 0x2135FA0

    def get(address, fmt):
        return struct.unpack("<" + fmt, emu.mem_read(address, struct.calcsize("<" + fmt)))

    def put(address, fmt, *values):
        emu.mem_write(address, struct.pack("<" + fmt, *values))

    def run(start, state, end=None):
        put(STACK, "Q", STOP)
        emu.reg_write(reg.UC_X86_REG_RSP, STACK)
        for key, value in state.items():
            emu.reg_write(key, value)
        stop = STOP if end is None else image.base + end
        try:
            emu.emu_start(image.base + start, stop, count=200_000)
        except UcError as error:
            pc = emu.reg_read(reg.UC_X86_REG_RIP)
            stack = emu.reg_read(reg.UC_X86_REG_RSP)
            raise ValueError(
                f"Native block {start:#x} faulted at {pc:#x}, stack return {get(stack, 'Q')[0]:#x}"
            ) from error
        if emu.reg_read(reg.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Original block did not reach boundary: {start:#x}")

    allocation = BASE + 0x10000

    def call_return(value):
        stack = emu.reg_read(reg.UC_X86_REG_RSP)
        emu.reg_write(reg.UC_X86_REG_RAX, value)
        emu.reg_write(reg.UC_X86_REG_RSP, stack + 8)
        emu.reg_write(reg.UC_X86_REG_RIP, get(stack, "Q")[0])

    def allocate():
        nonlocal allocation
        size = emu.reg_read(reg.UC_X86_REG_RDI)
        if not 0 < size < 0x10000 or allocation + size >= BASE + 0x40000:
            raise ValueError(f"Unexpected inventory storage request: {size}")
        emu.mem_write(allocation, bytes(size))
        call_return(allocation)
        allocation += (size + 15) & ~15

    def hook(rva, function):
        address = image.base + rva
        emu.hook_add(UC_HOOK_CODE, lambda *_: function(), begin=address, end=address)

    hook(0x14A0300, allocate)
    hook(0x14C5B20, allocate)
    hook(0x14C5B80, lambda: call_return(0))

    # Execute function-local static constructors. Only lower the single-threaded
    # guard and process-exit bookkeeping to their host equivalents.
    def guard():
        call_return(int(get(emu.reg_read(reg.UC_X86_REG_RDI), "B")[0] == 0))

    def release_guard():
        put(emu.reg_read(reg.UC_X86_REG_RDI), "B", 1)
        call_return(0)

    hook(0x2050B48, guard)
    hook(0x2050B4E, release_guard)
    hook(0x2050B2A, lambda: call_return(0))

    def assignment():
        return {
            "slot": emu.reg_read(reg.UC_X86_REG_ESI),
            "itemId": emu.reg_read(reg.UC_X86_REG_EDX),
            "count": emu.reg_read(reg.UC_X86_REG_ECX),
            "counter": emu.reg_read(reg.UC_X86_REG_R8D),
        }

    for row in rows:
        opcode = row["opcode"]
        allocation = BASE + 0x10000
        run(0x100F2A0, {reg.UC_X86_REG_RDI: CURSOR, reg.UC_X86_REG_RSI: opcode})
        packet = get(CURSOR, "Q")[0]
        if packet != BASE + 0x10000:
            raise ValueError("Native factory did not publish inventory message")
        body = encode(row["context"]) + bytes.fromhex(row["body"])
        emu.mem_write(DATA, body)
        put(CURSOR, "Q", DATA)
        run(
            READERS[opcode],
            {reg.UC_X86_REG_RDI: packet, reg.UC_X86_REG_RSI: CURSOR, reg.UC_X86_REG_RDX: DATA + len(body)},
        )
        if (
            emu.reg_read(reg.UC_X86_REG_AL) != 1
            or get(CURSOR, "Q")[0] != DATA + len(body)
            or get(packet + 8, "H2xI") != (opcode, row["context"])
        ):
            raise ValueError(f"Original inventory decoder did not consume body: {opcode}")
        if opcode == 840:
            run(0x174EEC, {reg.UC_X86_REG_RBX: packet, reg.UC_X86_REG_R12: table}, 0x1750DA)
            fields = assignment()
        elif opcode == 190:
            run(0x17598B, {reg.UC_X86_REG_R14: packet, reg.UC_X86_REG_RBP: SLOT}, 0x175B7C)
            fields = assignment()
        elif opcode == 797:
            run(0x175436, {reg.UC_X86_REG_R14: packet, reg.UC_X86_REG_R12: table}, 0x175464)
            fields = {"slot": emu.reg_read(reg.UC_X86_REG_ESI), "count": emu.reg_read(reg.UC_X86_REG_EDX)}
        elif opcode == 226:
            run(0x1754A0, {reg.UC_X86_REG_RSI: packet}, 0x1754D4)
            fields = {"from": emu.reg_read(reg.UC_X86_REG_ESI), "to": emu.reg_read(reg.UC_X86_REG_EDX)}
        elif opcode == 1143:
            run(0x17552E, {reg.UC_X86_REG_RSI: packet}, 0x175537)
            slot = emu.reg_read(reg.UC_X86_REG_AL)
            put(SLOT + 0x10, "Q", ITEM)
            run(0x17558B, {reg.UC_X86_REG_R15: packet, reg.UC_X86_REG_R12: SLOT}, 0x1755F1)
            fields = {"slot": slot, "count": get(SLOT, "B")[0], "counter": get(ITEM + 0xAA, "H")[0]}
        elif opcode == 248:
            run(0x175F20, {reg.UC_X86_REG_RSI: packet}, 0x175F5A)
            slot = emu.reg_read(reg.UC_X86_REG_ESI)
            run(0x175F69, {reg.UC_X86_REG_RAX: ITEM}, 0x175F7C)
            fields = {"slot": slot, "counter": get(ITEM + 0xAA, "H")[0]}
        else:
            vector, count = get(packet + 0x20, "QI")
            if count > 39 or (count and not BASE <= vector < BASE + 0x40000 - count * 168):
                raise ValueError("Original snapshot row storage escaped arena")
            entries = []
            for i in range(count):
                run(0x1777E7, {reg.UC_X86_REG_R14: vector + i * 168, reg.UC_X86_REG_RBX: table}, 0x1779C8)
                entries.append(assignment())
            fields = {"entries": entries}
        for entry in fields.get("entries", [fields]):
            if any(entry.get(key, 0) >= 39 for key in ("slot", "from", "to")):
                raise ValueError(f"Original decoded slot outside inventory storage: {opcode}, {fields}")
        yield {**{key: value for key, value in row.items() if key != "body"}, **fields}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "source", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--current", action="store_true")
    parser.add_argument("--source-sha256")
    args = parser.parse_args()
    if args.current:
        if not re.fullmatch(r"[a-f0-9]{64}", args.source_sha256 or ""):
            parser.error("--current requires --source-sha256 with a lowercase SHA-256 digest")
    elif args.source_sha256 is not None:
        parser.error("--source-sha256 is only accepted with --current")
    source_bytes = args.source.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    expected_sources = {args.source_sha256} if args.current else SOURCE_HASHES
    if source_hash not in expected_sources:
        raise ValueError("Expected exact saved replay inventory evidence")
    archive = args.archive.read_bytes()
    expected_archive = CURRENT_ARCHIVE if args.current else baseline.ARCHIVE
    if hashlib.sha256(archive).hexdigest() != expected_archive:
        raise ValueError("Expected exact archived replay executable")
    source = json.loads(source_bytes)
    if args.current and (
        source["build"] != CURRENT_BUILD
        or source["protocol"] != "8bbfcd5af2bc92db"
        or not source["rows"]
        or not re.fullmatch(r"[a-f0-9]{64}", source["replaySha256"])
        or not re.fullmatch(r"[a-f0-9]{64}", source["sceneSha256"])
    ):
        raise ValueError("Current inventory evidence requires an exact build, replay and bound scene")
    image = MachImage(archive)
    rows = list(decode(image, source["rows"]))
    result = {
        **{key: source[key] for key in ("build", "protocol", "replaySha256", "participants")},
        "sliceSha256": hashlib.sha256(image.binary).hexdigest(),
        "sourceSha256": source_hash,
        "archiveSha256": expected_archive,
        **({"sceneSha256": source["sceneSha256"]} if args.current else {}),
        "mutations": baseline.registered_mutation_counts(image.image, source["rosterOpcodesByStream"]),
        "rows": rows,
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, separators=(",", ":"))
        output.write("\n")


if __name__ == "__main__":
    main()

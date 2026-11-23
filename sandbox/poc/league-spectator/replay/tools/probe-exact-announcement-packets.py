"""Verify saved opcode 880 bodies and names in the archived native reader."""

import argparse
import json
import math
import struct
from collections import Counter
from hashlib import sha256
from itertools import pairwise
from pathlib import Path

from capstone import CS_ARCH_X86, CS_MODE_64, Cs
from capstone.x86_const import X86_OP_MEM, X86_REG_RIP
from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

SLICE = "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa"
ARENA = 0x10000000
OBJECT, HANDLE, CURSOR, BODY, HEAP, STOP, STACK = (
    ARENA + offset for offset in (0, 0x80, 0x100, 0x2000, 0x6000, 0x8000, 0xFFF8)
)
NAME_TABLE = 0x25D65A0


def registration_names(image):
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    names = {}
    for load, store in pairwise(decoder.disasm(image[0x402000:0x407000], 0x402000)):
        if load.mnemonic != "lea" or store.mnemonic != "mov":
            continue
        src, dst = load.operands[1], store.operands[0]
        if any(op.type != X86_OP_MEM or op.mem.base != X86_REG_RIP for op in (src, dst)):
            continue
        if load.operands[0].reg != store.operands[1].reg:
            continue
        slot = store.address + store.size + dst.mem.disp
        enum, remainder = divmod(slot - NAME_TABLE, 40)
        if remainder or not 150 <= enum < 230:
            continue
        address = load.address + load.size + src.mem.disp
        name = bytes(image[address : address + 100]).split(b"\0", 1)[0].decode("ascii")
        if not name or enum in names:
            raise ValueError("Invalid original announcement name registration")
        names[enum] = (name, load.address, slot)
    return names


def context_encoder(image):
    table = image[0x2156E30:0x2156F30]

    def rotate(value):
        return ((value << 1) | (value >> 7)) & 255

    inverse = {table[(table[rotate((table[value ^ 255] + 0x54) & 255)] + 0xB4) & 255]: value for value in range(256)}
    if len(inverse) != 256:
        raise ValueError("Original context substitution is not a permutation")

    def prefix(context):
        value = context ^ 0x40000000 if context & 0xFFFFFF else context
        encoded = bytearray()
        while value >= 128:
            encoded.append(inverse[(value & 127) | 128])
            value >>= 7
        encoded.append(inverse[value])
        return encoded

    return prefix


def verify(image, evidence):
    if sha256(image.binary).hexdigest() != SLICE:
        raise ValueError("Wrong archived opcode 880 reader")
    identity = evidence["identity"]
    if (
        identity["build"] != "16.23.840.6595"
        or identity["protocol"] != "8bbfcd5af2bc92db"
        or len(bytes.fromhex(identity["replaySha256"])) != 32
    ):
        raise ValueError("Wrong source replay identity")
    names = registration_names(image.image)
    prefix = context_encoder(image.image)
    base = image.base
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    vm.mem_map(ARENA, 0x10000)
    baseline = vm.context_save()
    heap = HEAP

    def put(address, fmt, value):
        vm.mem_write(address, struct.pack("<" + fmt, value))

    def get(address, fmt):
        return struct.unpack("<" + fmt, vm.mem_read(address, struct.calcsize("<" + fmt)))[0]

    def execute(start, registers, stop=STOP):
        vm.context_restore(baseline)
        vm.reg_write(r.UC_X86_REG_RSP, STACK)
        put(STACK, "Q", STOP)
        for register, value in registers.items():
            vm.reg_write(register, value)
        vm.emu_start(base + start, stop, count=100_000)
        if vm.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Original announcement probe missed stop at {start:#x}")

    def helper(uc, address, _size, _data):
        nonlocal heap
        arg = uc.reg_read(r.UC_X86_REG_RDI)
        if address == base + 0x2050B1E:
            length = uc.reg_read(r.UC_X86_REG_RSI)
            if not HEAP <= arg <= arg + length <= heap:
                raise ValueError("Native announcement zero-fill escaped the heap")
            uc.mem_write(arg, bytes(length))
            uc.reg_write(r.UC_X86_REG_RAX, arg)
        else:
            length = arg
            aligned = (length + 15) & ~15
            if not 0 < aligned <= STOP - heap:
                raise ValueError("Native announcement allocation escaped the heap")
            uc.reg_write(r.UC_X86_REG_RAX, heap)
            heap += aligned
        stack = uc.reg_read(r.UC_X86_REG_RSP)
        uc.reg_write(r.UC_X86_REG_RIP, get(stack, "Q"))
        uc.reg_write(r.UC_X86_REG_RSP, stack + 8)

    for address in (0x14C5B20, 0x14A0300, 0x2050B1E):
        vm.hook_add(UC_HOOK_CODE, helper, begin=base + address, end=base + address)
    factory_jump = base + 0x101C56C
    if factory_jump + get(factory_jump + 880 * 4, "i") != base + 0x1014672:
        raise ValueError("Wrong native opcode 880 factory entry")

    previous = (-1, -1)
    counts = Counter({"1": 0, "2": 0, "3": 0, "4": 0})
    rows = []
    for row in evidence["rows"]:
        position = (row["chunkOffset"], row["blockOffset"])
        context = row["context"]
        stream = str(row["stream"])
        if (
            row["opcode"] != 880
            or stream not in counts
            or position <= previous
            or not math.isfinite(row["timeSeconds"])
            or row["timeSeconds"] < 0
            or type(context) is not int
            or not 0 <= context <= 0xFFFFFFFF
        ):
            raise ValueError("Invalid saved announcement envelope evidence")
        previous = position
        counts[stream] += 1
        body = bytes.fromhex(row["body"])
        context_bytes = prefix(context)
        if not 0 < len(body) < HEAP - BODY - len(context_bytes):
            raise ValueError("Invalid announcement body length")
        heap = HEAP
        vm.mem_write(HEAP, bytes(STOP - HEAP))
        # Execute the original packet initialization after the host allocator.
        execute(
            0x101467C,
            {r.UC_X86_REG_RAX: OBJECT, r.UC_X86_REG_RBX: HANDLE},
            base + 0x101C304,
        )
        if get(get(OBJECT, "Q") + 8, "Q") != base + 0x11C9F00:
            raise ValueError("Wrong native announcement body reader slot")
        vm.mem_write(BODY, bytes(context_bytes) + body)
        put(CURSOR, "Q", BODY)
        end = BODY + len(context_bytes) + len(body)
        execute(
            0x11C9F00,
            {r.UC_X86_REG_RDI: OBJECT, r.UC_X86_REG_RSI: CURSOR, r.UC_X86_REG_RDX: end},
        )
        if vm.reg_read(r.UC_X86_REG_AL) != 1 or get(CURSOR, "Q") != end or get(OBJECT + 0xC, "I") != context:
            raise ValueError(f"Original announcement reader did not consume {position}")
        execute(0x3D1E48, {r.UC_X86_REG_R14: OBJECT}, base + 0x3D1E78)
        enum = vm.reg_read(r.UC_X86_REG_EDX)
        if enum not in names:
            raise ValueError(f"Original announcement enum {enum} escaped the verified registration block")
        name, registration, slot = names[enum]
        rows.append(
            {
                **row,
                "wireBytes": len(body),
                "enum": enum,
                "name": name,
                "nameRegistrationRva": registration,
                "nameSlotRva": slot,
            }
        )
    if dict(counts) != evidence["countsByStream"]:
        raise ValueError("Saved announcement stream census disagrees")
    return {"identity": identity, "sliceSha256": SLICE, "countsByStream": dict(counts), "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "input", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    evidence = args.input.read_bytes()
    receipt = verify(MachImage(args.archive.read_bytes()), json.loads(evidence))
    receipt["inputSha256"] = sha256(evidence).hexdigest()
    with args.output.open("x", encoding="utf8") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

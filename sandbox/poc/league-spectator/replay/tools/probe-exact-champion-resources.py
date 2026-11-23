"""Confirm recorded champion fields with the archived registration and getters."""

import argparse
import json
import struct
from collections import Counter
from hashlib import sha256
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as registers

ARCHIVE_SLICE = "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa"
ARENA = 0x20000000
STACK, ENTITY, INPUT, SLOT = (ARENA + n for n in (0x7FF8, 0x9000, 0xE000, 0xF000))
GROUPS = {
    1: (0x2507088, 28, 0x0FFFFF07),
    32: (0x25078A8, 32, 0x0F99FBFF),
}
# Each getter is referenced immediately before the corresponding field name in
# the build's Live Client API serializer. Resource uses primary slot zero.
FIELDS = {
    "gold": (1, 0, 0x2000, 0x202930, 0x2000, True),
    "resource": (32, 15, 0x238, 0xECF90, 0, True),
    "resourceMax": (32, 16, 0x260, 0xECFB0, 0, True),
}
PROGRESSION_FIELDS = {
    "experience": (32, 11, 0x3FE8, 0x202100, 0x3FE8, True),
    "level": (32, 28, 0x4010, 0x202140, 0x3FE8, False),
}


def verify(archive, groups, progression=False, experience_scene=None):
    image = MachImage(archive)
    if sha256(image.binary).hexdigest() != ARCHIVE_SLICE:
        raise ValueError("Invalid archived resource decoder")
    base = image.base
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    vm.mem_map(ARENA, 0x20000)

    def put(address, value):
        vm.mem_write(address, struct.pack("<Q", value))

    def execute(start, arguments, stop=ARENA, budget=2048):
        put(STACK, ARENA)
        vm.reg_write(registers.UC_X86_REG_RSP, STACK)
        for register, value in zip(
            (registers.UC_X86_REG_RDI, registers.UC_X86_REG_RSI, registers.UC_X86_REG_RDX, registers.UC_X86_REG_RCX),
            arguments,
            strict=False,
        ):
            vm.reg_write(register, value)
        vm.emu_start(base + start, stop, count=budget)
        if vm.reg_read(registers.UC_X86_REG_RIP) != stop:
            raise ValueError("Native resource probe exceeded its instruction budget")

    # Native registration runs on a zero entity with its main vtable. Only
    # the allocator and single-threaded C++ static guards cross the model.
    allocations = iter(((0x68, ARENA + 0x12000), (0x20, ARENA + 0x12070)))
    calls = Counter()

    def model_abi(uc, address, _size, _context):
        rva = address - base
        calls[rva] += 1
        argument = uc.reg_read(registers.UC_X86_REG_RDI)
        if rva == 0x14A0300:
            size, result = next(allocations)
            if argument != size:
                raise ValueError("Native replication allocation size changed")
        else:
            if not base + 0x2507200 <= argument < base + 0x2507C00:
                raise ValueError("Native static guard outside replication area")
            result = int(uc.mem_read(argument, 1)[0] == 0)
            if rva == 0x2050B4E:
                uc.mem_write(argument, b"\x01")
                result = 0
        stack = uc.reg_read(registers.UC_X86_REG_RSP)
        target = struct.unpack("<Q", uc.mem_read(stack, 8))[0]
        uc.reg_write(registers.UC_X86_REG_RAX, result)
        uc.reg_write(registers.UC_X86_REG_RSP, stack + 8)
        uc.reg_write(registers.UC_X86_REG_RIP, target)

    hooks = (0x14A0300, 0x2050B48, 0x2050B4E)
    for rva in hooks:
        vm.hook_add(UC_HOOK_CODE, model_abi, begin=base + rva, end=base + rva)
    # Cache optional replication observer configuration as false so no live
    # entity service or observer callback can run in this isolated probe.
    vm.mem_write(base + 0x25D4B08, b"\x01\x00\x00\x00")
    put(ENTITY, base + 0x235F778)
    execute(0x13FB30, (ENTITY,), stop=base + 0x1416B0, budget=100_000)
    if [calls[entry] for entry in hooks] != [2, 7, 7]:
        raise ValueError("Native registration boundary changed")

    fields = PROGRESSION_FIELDS if progression else FIELDS
    if progression:
        execute(0x141920, (ENTITY,))
        if vm.reg_read(registers.UC_X86_REG_RAX) != ENTITY + 0x3FE8:
            raise ValueError("Native champion experience component moved")

    for group, (rva, count, float_mask) in GROUPS.items():
        descriptor = vm.mem_read(base + rva, 0x198)
        if struct.unpack_from("<I4xQ", descriptor) != (count, float_mask):
            raise ValueError("Native group descriptor changed")
        for field_group, bit, offset, _, _, is_float in fields.values():
            if field_group == group and (
                bool(float_mask & (1 << bit)) != is_float
                or struct.unpack_from("<I", descriptor, 0x10 + bit * 4)[0] != offset
            ):
                raise ValueError("Native resource field offset or type changed")

    counts = Counter()
    field_reads = Counter()
    zero_entity = bytes(0x5000)
    for row in groups:
        group, mask = row["group"], row["fieldMask"]
        descriptor, count, _ = GROUPS[group]
        data = bytes.fromhex(row["dataHex"])
        if len(data) > 255 or mask >> count:
            raise ValueError("Recorded resource group outside descriptor bounds")
        vm.mem_write(ENTITY, zero_entity)
        vm.mem_write(INPUT, data + bytes(8))
        put(SLOT, base + descriptor)
        execute(0x1D7700, (SLOT, ENTITY, mask, INPUT))
        if vm.reg_read(registers.UC_X86_REG_RAX) != len(data):
            raise ValueError("Native reader did not consume the full recorded group")
        expected = {
            name for name, (group_id, bit, _, _, _, _) in fields.items() if group_id == group and (mask >> bit) & 1
        }
        if expected != row["consumerBits"].keys():
            raise ValueError("Recorded fields disagree with their active bit mask")
        for name in sorted(expected):
            _, _, offset, getter, getter_offset, is_float = fields[name]
            execute(getter, (ENTITY + getter_offset, 0))
            result_reg = registers.UC_X86_REG_XMM0 if is_float else registers.UC_X86_REG_RAX
            value = vm.reg_read(result_reg) & 0xFFFFFFFF
            stored = struct.unpack("<I", vm.mem_read(ENTITY + offset, 4))[0]
            if value != stored or value != row["consumerBits"][name]:
                raise ValueError(f"Native consumer differs for {name}")
            field_reads[name] += 1
        counts[f"stream{row['stream']}/group{group}"] += 1
    result = {"verifiedGroups": dict(counts), "verifiedGetterReads": dict(field_reads)}
    if experience_scene is not None:
        result["verifiedProgressSamples"] = verify_progress(vm, base, execute, experience_scene["championExperience"])
    return result


def verify_progress(vm, base, execute, scene):
    """Run original progression calculations against the prepared CLASSIC scene."""
    mode, curve, values, cap_vtable = (ARENA + n for n in (0x14000, 0x14200, 0x14300, 0x14400))
    component, cap_interface = ENTITY + 0x3FE8, ENTITY + 0x3C98
    thresholds = scene["thresholds"]

    def write(address, fmt, *items):
        vm.mem_write(address, struct.pack("<" + fmt, *items))

    def native_float(rva, *arguments):
        execute(rva, arguments)
        return struct.pack("<I", vm.reg_read(registers.UC_X86_REG_XMM0) & 0xFFFFFFFF)

    # The prepared scene has already bound the exact archived curve and literal
    # CLASSIC mode. Mount its threshold vector on the native profile object.
    execute(0x217C60, (curve,))
    default_cap = struct.unpack("<I", vm.mem_read(curve + 0x48, 4))[0]
    if default_cap != 18:
        raise ValueError("Original ExperienceCurveData default level cap changed")
    write(base + 0x421F4B + 0x21B9155, "Q", mode)
    write(mode + 0x110, "Q", curve)
    write(curve, "QI", values, len(thresholds))
    write(values, f"{len(thresholds)}f", *thresholds)
    write(cap_interface, "Q", cap_vtable)
    write(cap_vtable + 0x18, "Q", base + 0x1433E0)
    execute(0x202060, (component, 0, cap_interface))

    verified = 0
    for track in scene["tracks"]:
        for time, experience, level in track["points"]:
            cap = next((cap for start, cap in reversed(track["levelCaps"]) if start <= time), default_cap)
            write(ENTITY + 0x4864, "I", cap if cap != default_cap else 0)
            write(component, "f", experience)
            write(component + 0x28, "I", level)
            if level >= cap:
                if native_float(0x202180, component) != struct.pack("<f", level):
                    raise ValueError("Native level progress continues beyond the cap")
            else:
                previous = thresholds[level - 2] if level > 1 else 0
                if native_float(0x2023E0, component) != struct.pack("<f", experience - previous) or native_float(
                    0x202340, component, level + 1
                ) != struct.pack("<f", thresholds[level - 1] - previous):
                    raise ValueError("Native experience meter values differ")
            verified += 1
    return verified


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("groups", type=Path)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--progression", action="store_true")
    parser.add_argument("--experience-scene", type=Path)
    args = parser.parse_args()
    source = args.groups.read_bytes()
    payload = json.loads(source)
    scene_bytes = args.experience_scene.read_bytes() if args.experience_scene else None
    scene = json.loads(scene_bytes) if scene_bytes is not None else None
    if scene is not None and (
        not args.progression
        or scene["identity"]["build"] != "16.23.840.6595"
        or scene["identity"]["protocol"] != "8bbfcd5af2bc92db"
        or scene["identity"]["replaySha256"] != payload["identity"]
    ):
        parser.error("--experience-scene requires --progression and the same exact replay")
    result = verify(args.archive.read_bytes(), payload["groups"], args.progression, scene)
    if scene_bytes is not None:
        result["sceneSha256"] = sha256(scene_bytes).hexdigest()
    result.update(replaySha256=payload["identity"], groupsSha256=sha256(source).hexdigest(), sliceSha256=ARCHIVE_SLICE)
    output = json.dumps(result, sort_keys=True)
    with args.receipt.open("x", encoding="utf-8") as receipt:
        receipt.write(output + "\n")
    print(output)

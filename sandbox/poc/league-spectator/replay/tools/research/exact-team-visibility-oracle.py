"""Run exact-build visibility packet readers and team mask queries offline."""

import hashlib
import json
import struct
import sys
from pathlib import Path

import unicorn as u
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage


def main():
    binary = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(binary).hexdigest() != "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15":
        raise ValueError("Expected archived exact 16.23.840.6595 executable bytes")
    image = MachImage(binary)
    vm = u.Uc(u.UC_ARCH_X86, u.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))
    stop, obj, cursor, body, component, configuration, stack = (
        0x10000000 + offset for offset in (0, 0x100, 0x200, 0x300, 0x500, 0x1000, 0x1f08)
    )
    vm.mem_map(stop, 0x2000)

    def put(address, fmt, value):
        vm.mem_write(address, struct.pack("<" + fmt, value))

    def get(address, fmt):
        return struct.unpack("<" + fmt, vm.mem_read(address, struct.calcsize(fmt)))[0]

    def call(entry, di=0, si=0, dx=0):
        for register, value in (
            (r.UC_X86_REG_RDI, di), (r.UC_X86_REG_RSI, si),
            (r.UC_X86_REG_RDX, dx), (r.UC_X86_REG_RSP, stack),
        ):
            vm.reg_write(register, value)
        put(stack, "Q", stop)
        vm.emu_start(image.base + entry, stop, count=10000)
        if vm.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Instruction bound exceeded at {entry:#x}")
        return vm.reg_read(r.UC_X86_REG_AL)

    def run_prefix(start, end, register, address):
        vm.reg_write(register, address)
        vm.emu_start(image.base + start, image.base + end, count=20)
        if vm.reg_read(r.UC_X86_REG_RIP) != image.base + end:
            raise ValueError(f"Instruction bound exceeded at {start:#x}")

    envelope_context = 0x40000151

    def supply_archived_context(engine, _address, _size, _data):
        # The replay envelope has already consumed the native header fields.
        if engine.reg_read(r.UC_X86_REG_RDI) != obj:
            raise ValueError("Unexpected packet header boundary")
        put(obj + 12, "I", envelope_context)
        engine.reg_write(r.UC_X86_REG_RAX, 1)
        pointer = engine.reg_read(r.UC_X86_REG_RSP)
        engine.reg_write(r.UC_X86_REG_RIP, get(pointer, "Q"))
        engine.reg_write(r.UC_X86_REG_RSP, pointer + 8)

    vm.hook_add(u.UC_HOOK_CODE, supply_archived_context,
                begin=image.base + 0x1637cb0, end=image.base + 0x1637cb0)
    put(image.base + 0x24e8590, "Q", configuration)
    put(configuration + 0x70, "B", 1)
    put(image.base + 0x24e85b0, "Q", configuration)
    put(configuration + 8, "I", 3)
    put(image.base + 0x25d5fb8, "B", 1)

    # Original spectator selection maps team IDs to the published view slots.
    slots = {team: call(0x6de3c0, team) for team in (100, 200)}
    component_vtable = 0x237dbb8
    if get(image.base + component_vtable + 0x70, "Q") != image.base + 0x2200d0:
        raise ValueError("Unexpected native visibility query implementation")
    put(component, "Q", image.base + component_vtable)
    put(component + 0x21, "B", 0xff)
    put(component + 0x24, "I", 0xffffffff)
    put(component + 0x28, "B", 0xff)
    run_prefix(0x21fa75, 0x21fa84, r.UC_X86_REG_RBX, component)
    constructor_fields = [get(component + offset, fmt) for offset, fmt in (
        (0x21, "B"), (0x24, "I"), (0x28, "B"),
    )]
    if constructor_fields != [0, 0, 0] or call(0x220090, component, 1):
        raise ValueError("Unexpected untouched component visibility")
    run_prefix(0x22002a, 0x22002e, r.UC_X86_REG_RAX, component)
    if get(component + 0x21, "B") != 1:
        raise ValueError("Original initialization prefix did not set the flag")
    if call(0x21fe10, component) != 1 or get(component + 0x21, "B") != 1:
        raise ValueError("Mode-3 reset changed the initialized flag")
    results = {}
    for hex_body in json.load(sys.stdin):
        payload = bytes.fromhex(hex_body)
        if len(payload) != 2 or not payload[0] & 1:
            raise ValueError("Unsupported archived visibility mask body")
        outcomes = {}
        for opcode, entry, vtable, callback, initial in (
            (66, 0x112df10, 0x243bea8, 0x21fe40, 0),
            (696, 0x112dfa0, 0x243bef0, 0x21fe80, 0xffffffff),
        ):
            if get(image.base + vtable + 8, "Q") != image.base + entry:
                raise ValueError("Unexpected visibility packet reader vtable")
            vm.mem_write(body, payload)
            put(cursor, "Q", body)
            put(obj, "Q", image.base + vtable)
            put(obj + 8, "I", opcode)
            put(obj + 16, "B", 0xff)
            if call(entry, obj, cursor, body + 2) != 1 or get(cursor, "Q") != body + 2 or get(obj + 12, "I") != envelope_context:
                raise ValueError("Native reader rejected archived mask payload")
            put(component + 0x24, "I", initial)
            if call(callback, component, obj) != 1:
                raise ValueError("Native component operation failed")
            mask = get(component + 0x24, "I")
            changed = mask ^ initial
            slot = changed.bit_length() - 1
            if slot not in slots.values() or changed != 1 << slot:
                raise ValueError("Native operation did not isolate a team slot")
            filtered = {}
            for team, selected_slot in slots.items():
                put(image.base + 0x25d5fb9, "B", selected_slot)
                selected = call(0x220090, component, 1)
                if selected != (mask >> selected_slot) & 1:
                    raise ValueError("Native selected-team query disagrees with mask")
                filtered[team] = bool(selected)
            outcomes[opcode] = {"slot": slot, "maskBefore": initial, "maskAfter": mask, "selected": filtered}
        if outcomes[66]["slot"] != outcomes[696]["slot"]:
            raise ValueError("Set and clear disagree on the same wire body")
        results[hex_body] = {"slot": outcomes[66]["slot"], "operations": outcomes}

    print(json.dumps({"slots": slots, "bodies": results, "controls": {
        "constructorInitializedMaskOverride": constructor_fields,
        "initializedAfterMode3Reset": True,
    }, "nativeEntries": {
        "teamToSlot": 0x6de3c0, "selectedQuery": 0x2200d0,
        "maskSet": 0x21fe40, "maskClear": 0x21fe80, "modeZeroReset": 0x21fe10,
        "setReader": 0x112df10, "clearReader": 0x112dfa0,
        "initializeDispatch": 0x6ec4dc, "initializePrefix": 0x220010,
    }}))


if __name__ == "__main__":
    main()

"""Read exact .8428 attack records offline using archived x86-64 code."""

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

from unicorn import x86_const as register

PACKETS = {
    98: (0x10118FF, 0x132F300, 0xFDEA0, 0xF449D),
    195: (0x101C19B, 0x132F650, 0xFDEC0, 0xF462F),
    359: (0x108ED20, 0x132F7C0, 0xFDED0, 0xF46F8),
    992: (0x10121DC, 0x132F470, 0xFDEB0, 0xF4566),
}
CONSUMER = 0x11CFF0
BYTE_TABLE = 0x21358B0


def load_harness():
    source = Path(__file__).with_name("extract-recorded-heimer-impacts.py")
    spec = importlib.util.spec_from_file_location("attack_packet_harness", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Archived packet harness is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def observe(harness, reader, opcode, owner, payload):
    constructor, decoder, callback, registrar = PACKETS[opcode]
    image = reader.image
    base = image.base
    code = image.image
    # The registrar inserts the thunk and opcode together in the receiver table.
    callback_lea = registrar - 0x54
    displacement = int.from_bytes(code[callback_lea + 3 : callback_lea + 7], "little", signed=True)
    if (
        code[callback_lea : callback_lea + 3] != b"\x48\x8d\x0d"
        or callback_lea + 7 + displacement != callback
        or code[registrar] != 0xBA
        or int.from_bytes(code[registrar + 1 : registrar + 5], "little") != opcode
    ):
        raise ValueError("Archived attack registration differs")

    machine = reader.machine
    reader.heap = harness.HEAP
    reader.context = owner
    machine.mem_write(harness.STOP, harness.EMPTY)
    if opcode == 359:
        packet = harness.OBJECT
        reader.call(constructor, packet)
    else:
        machine.reg_write(register.UC_X86_REG_RBX, harness.OBJECT)
        reader.call(constructor, end=base + 0x101C304)
        packet = reader.read(harness.OBJECT, 8)
    vtable = reader.read(packet, 8)
    if reader.read(packet + 8, 2) != opcode or reader.read(vtable + 8, 8) != base + decoder:
        raise ValueError("Archived attack constructor or body reader differs")
    machine.mem_write(harness.BODY, payload)
    reader.put_pointer(harness.CURSOR, harness.BODY)
    end = harness.BODY + len(payload)
    reader.call(decoder, packet, harness.CURSOR, end)
    if (
        machine.reg_read(register.UC_X86_REG_AL) != 1
        or reader.read(harness.CURSOR, 8) != end
        or reader.read(packet + 12, 4) != owner
    ):
        raise ValueError("Archived attack reader rejected the recorded body")

    record = packet + 0x10
    # Stop before the native receiver needs the live target registry or actor.
    reader.call(CONSUMER, 0, record, end=base + 0x11D130)
    target = machine.reg_read(register.UC_X86_REG_ESI)
    machine.reg_write(register.UC_X86_REG_RBX, record)
    machine.reg_write(register.UC_X86_REG_R15, base + BYTE_TABLE)
    reader.call(0x11D369, end=base + 0x11D3A4)
    requested_slot = machine.reg_read(register.UC_X86_REG_R13D)
    machine.reg_write(register.UC_X86_REG_RBX, record)
    reader.call(0x11D2AD, end=base + 0x11D2C0)
    timing = machine.reg_read(register.UC_X86_REG_EAX)
    result = {
        "targetId": target,
        "requestedSlot": requested_slot,
        "timingOffsetCentiseconds": timing if timing < 0x80000000 else timing - 0x100000000,
    }
    if opcode in (195, 359):
        result["embeddedCastCount"] = reader.read(record + 0x20, 4)
    if opcode == 359:
        if reader.read(packet + 0x50, 4) != 2:
            raise ValueError("Archived attack wrapper requires two source coordinates")
        source = reader.read(packet + 0x48, 8)
        result["sourceXZBits"] = [reader.read(source + axis * 4, 4) for axis in range(2)]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    harness = load_harness()
    reader = harness.GroupedReader(harness.read_replication_image(args.archive.read_bytes(), harness.CURRENT_BUILD))
    packets = json.load(sys.stdin)
    if not isinstance(packets, list) or not packets:
        raise ValueError("Expected a nonempty attack packet corpus")
    observations = []
    previous_sequence = -1
    for opcode, time_seconds, sequence, owner, payload_hex in packets:
        payload = bytes.fromhex(payload_hex)
        if (
            opcode not in PACKETS
            or not math.isfinite(time_seconds)
            or time_seconds < 0
            or type(sequence) is not int
            or sequence <= previous_sequence
            or type(owner) is not int
            or not 0 < owner <= 0xFFFFFFFF
            or not 4 <= len(payload) <= 1024
        ):
            raise ValueError("Malformed recorded attack packet")
        previous_sequence = sequence
        observations.append(
            {
                "opcode": opcode,
                "timeSeconds": time_seconds,
                "sequence": sequence,
                "ownerId": owner,
                "body": payload_hex,
                **observe(harness, reader, opcode, owner, payload),
            }
        )
    json.dump(observations, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()

"""Verify the native team field and future-neutral scorer gate in the reviewed replay."""

import argparse
import importlib.util
import json
import struct
from hashlib import sha256
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

SPEC = importlib.util.spec_from_file_location(
    "director_death", Path(__file__).with_name("probe-exact-directed-camera-death.py")
)
original = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(original)
SOURCE_SHA256 = "3bae218a086b58c1410df51690d4687a29f81e7b6756536854fd1325666ef2cd"


def inspect(image, evidence):
    base = image.base
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    vm.mem_map(original.ARENA, 0x20000)
    team_table = original.ARENA + 0x17000
    packet, cursor, data = original.PACKET, original.CURSOR, original.DATA

    def put(address, fmt, *values):
        vm.mem_write(address, struct.pack("<" + fmt, *values))

    def get(address, fmt):
        return struct.unpack("<" + fmt, vm.mem_read(address, struct.calcsize("<" + fmt)))

    def execute(start, registers, stop=original.STOP):
        vm.reg_write(r.UC_X86_REG_RSP, original.STACK)
        put(original.STACK, "Q", original.STOP)
        for key, value in registers.items():
            vm.reg_write(key, value)
        vm.emu_start(base + start, stop, count=100_000)
        if vm.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Original block missed its stop at {start:#x}")

    def decode(record, constructor, reader):
        execute(constructor, {r.UC_X86_REG_RDI: packet})
        raw = bytes.fromhex(record["body"])
        native = original.context_prefix(image.image, record["context"]) + raw
        vm.mem_write(data, native)
        put(cursor, "Q", data)
        end = data + len(native)
        execute(reader, {r.UC_X86_REG_RDI: packet, r.UC_X86_REG_RSI: cursor, r.UC_X86_REG_RDX: end})
        if (
            vm.reg_read(r.UC_X86_REG_AL) != 1
            or get(cursor, "Q")[0] != end
            or get(packet + 8, "H2xI") != (record["opcode"], record["context"])
        ):
            raise ValueError("Original packet body reader did not consume the reviewed input")
        return len(raw)

    team, terminal = evidence["rows"]
    if (
        evidence["replaySha256"] != original.REPLAY_HASH
        or (team["opcode"], team["blockOffset"]) != (187, 432739)
        or (terminal["opcode"], terminal["blockOffset"]) != (1197, 444620)
        or any(row["context"] != 1073743585 or row["chunkOffset"] != 239723 for row in (team, terminal))
        or sha256(bytes.fromhex(team["body"])).hexdigest()
        != "61e3999ad5ea536f7d8bfb3456b4dc47823b42a09671acb3e9c88f529363e292"
    ):
        raise ValueError("Wrong replay-bound team inputs")
    execute(0x6869C5, {r.UC_X86_REG_RAX: team_table, r.UC_X86_REG_XMM0: 0}, base + 0x686A04)
    teams = get(team_table + 0x20, "4I")
    if teams != (0, 100, 200, 300):
        raise ValueError("Unexpected original team dictionary")
    # The saved field is present. Enable the original dictionary's reader
    # branch while leaving team values to the original initializer.
    put(team_table + 0x70, "B", 1)
    tokens = []
    vm.hook_add(
        UC_HOOK_CODE,
        lambda uc, *_: tokens.append(uc.reg_read(r.UC_X86_REG_EDI)),
        begin=base + 0x6DE3F0,
        end=base + 0x6DE3F0,
    )
    string_offsets = {}

    def resize_string(uc, *_):
        location = uc.reg_read(r.UC_X86_REG_RDI)
        length = uc.reg_read(r.UC_X86_REG_ESI)
        offset = location - packet
        if offset not in (0x38, 0x68) or offset in string_offsets or not 0 < length < 1024:
            raise ValueError("Unexpected host string allocation in the original reader")
        destination = original.ARENA + 0x16000 + 0x400 * len(string_offsets)
        string_offsets[offset] = (destination, length)
        put(location, "QII", destination, length, length)
        stack = uc.reg_read(r.UC_X86_REG_RSP)
        uc.reg_write(r.UC_X86_REG_RSP, stack + 8)
        uc.reg_write(r.UC_X86_REG_RIP, get(stack, "Q")[0])

    vm.hook_add(UC_HOOK_CODE, resize_string, begin=base + 0x14ED650, end=base + 0x14ED650)
    team_body_bytes = decode(team, 0x101E3D0, 0x11B34A0)
    strings = {
        hex(offset): bytes(vm.mem_read(address, size)).decode("ascii")
        for offset, (address, size) in string_offsets.items()
    }
    if tokens != [1] or strings != {"0x38": "TestCubeRender", "0x68": "SRU_Snail"}:
        raise ValueError("Unexpected original packet team or string witness")
    terminal_body_bytes = decode(terminal, 0x1020E60, 0x1036720)
    # Project the decoded actor team into the native field consumed by the
    # terminal scorer. The actual spawn consumer is outside this probe.
    put(original.ACTOR + 0x15C, "B", tokens[0])
    execute(0x79A1E6, {r.UC_X86_REG_R12: original.ACTOR}, base + 0x79A590)
    return {
        "replaySha256": original.REPLAY_HASH,
        "evaluatedClock": evidence["start"],
        "teamPacket": {**team, "nativeBodyBytes": team_body_bytes},
        "terminalPacket": {**terminal, "nativeBodyBytes": terminal_body_bytes},
        "originalTeamDictionary": teams,
        "originalPacketStrings": strings,
        "originalPacketTeamToken": tokens[0],
        "dictionaryTeamForToken": teams[tokens[0]],
        "originalNonNeutralBranchTakenUnderActorTeamProjection": True,
        "originalSpawnConsumerExecuted": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "input", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    archive, source = args.archive.read_bytes(), args.input.read_bytes()
    if sha256(archive).hexdigest() != original.EXECUTABLE_HASH:
        raise ValueError("Wrong archived director executable")
    if sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("Wrong saved director team evidence")
    receipt = inspect(original.MachImage(archive), json.loads(source))
    receipt.update(archiveSha256=original.EXECUTABLE_HASH, inputSha256=SOURCE_SHA256)
    with args.output.open("x", encoding="utf8") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

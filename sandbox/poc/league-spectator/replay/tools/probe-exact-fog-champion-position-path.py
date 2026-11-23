"""Test RNG-independent native movement gates on saved champion keyframes."""

import argparse
import importlib
import json
import struct
from pathlib import Path

from unicorn import UC_HOOK_CODE

motion = importlib.import_module("probe-exact-fog-turret-motion")
radius = importlib.import_module("probe-exact-fog-champion-radius")
reg = motion.reg
JOIN_SHA = "a6725af86c6b056deb11555eb012c7017291bc8471e2d5aa6386e01c5c38c1fe"


def bounded_call(oracle, start, registers, stop):
    address = oracle.base + stop

    def terminate(cpu, *_):
        cpu.emu_stop()

    hook = oracle.cpu.hook_add(UC_HOOK_CODE, terminate, begin=address, end=address)
    try:
        oracle.call(start, registers, stop_rva=stop)
    finally:
        oracle.cpu.hook_del(hook)


def observe_position(oracle, row, index):
    position = row["opcode944"]
    x, z = position["positionXZ"]
    # A different float32 coordinate cannot survive the previous-pose
    # comparison at these positive, finite positions.
    epsilon = oracle.get(oracle.base + 0x2134748, "f")
    for value in (x, z):
        if value <= 0:
            raise ValueError("Expected positive archived Map11 positions")
        (word,) = struct.unpack("<I", struct.pack("<f", value))
        lower, upper = struct.unpack("<2f", struct.pack("<2I", word - 1, word + 1))
        if min(value - lower, upper - value) <= epsilon:
            raise ValueError("Float32 previous-pose tolerance does not prove equality")
    sample = oracle.ARENA + 0x4900
    oracle.cpu.mem_write(sample, struct.pack("<3f", x, 0, z))
    masks = (0, 0x400, 0x800, 0xC00)
    for mask in masks:
        result = oracle.call(0x16E0710, {reg.UC_X86_REG_RDI: sample, reg.UC_X86_REG_RSI: mask})
        if result & 0xFF != 1:
            raise ValueError("Saved position was rejected by native Map11 terrain")
    # The tuple is an isolated initialization control. Opcode 944 supplies XZ
    # again. The replay does not supply here the native actor's prior Y or path.
    packet_row = {**row, **position, "authoredXYZ": [x, 0, z]}
    receiver, movement = oracle.initialize_movement(packet_row, index, owner_vtable=radius.HERO_VTABLE)
    packet = oracle.decode_position_packet(packet_row)
    if oracle.cpu.mem_read(packet + 0x14, 8) != bytes(8):
        raise ValueError("Unexpected alternate opcode 944 vector")
    if oracle.cpu.mem_read(packet + 0x34, 8) != struct.pack("<2f", x, z):
        raise ValueError("Original decoded vector differs from the saved join")
    oracle.put(oracle.ARENA + 0x4600, round(row["timeSeconds"] * 1e9))
    bounded_call(oracle, 0xAC090, {reg.UC_X86_REG_RDI: receiver, reg.UC_X86_REG_RSI: packet}, 0x1A1B9E)
    state = oracle.cpu.reg_read(reg.UC_X86_REG_RBX)
    source = oracle.cpu.reg_read(reg.UC_X86_REG_R14)
    if oracle.get(source, "f") != x or oracle.get(source + 8, "f") != z:
        raise ValueError("Native accepted movement edge has a different input")
    # Skip navigation-agent unregister/register around the direct stores. The
    # probe has no live navigation-agent registry or previously occupied cell.
    bounded_call(oracle, 0x1A1BA4, {reg.UC_X86_REG_RBX: state, reg.UC_X86_REG_R14: source}, 0x1A1C16)
    address = oracle.call(0xAC070, {reg.UC_X86_REG_RDI: movement})
    getter = [oracle.get(address, "f"), oracle.get(address + 8, "f")]
    if getter != [x, z]:
        raise ValueError("The native direct store and movement getter disagree")
    return {
        "ownerId": row["ownerId"],
        "chunk": row["chunk"],
        "packetSha256": position["packetSha256"],
        "nativeAcceptedTerrainMasks": masks,
        "previousPoseComparisonEpsilon": epsilon,
        "controlledNativeGetterXZ": getter,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("mach", "navgrid", "join", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.join.read_bytes()
    if radius.fog.sha(raw) != JOIN_SHA:
        raise ValueError("Expected exact saved provider and owner packet join")
    oracle = motion.MotionOracle(motion.turret.MachImage(args.mach.read_bytes()), args.navgrid.read_bytes())
    oracle.install_host()
    oracle.load()
    unique = {(row["ownerId"], row["chunk"]): row for row in json.loads(raw)["rows"]}
    if len(unique) != 12:
        raise ValueError("Unexpected confirmed owner packet count")
    positions = [observe_position(oracle, row, i) for i, row in enumerate(unique.values())]
    if oracle.calls["__tlv_atexit"]:
        raise ValueError("The native RNG initialized in the direct position control")
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(
            {
                "joinSha256": JOIN_SHA,
                "positions": positions,
                "nativeRoute": {
                    "pendingPositionTreeOwnerOffset": 0x20,
                    "navigationStateWordOffset": 0x260,
                    "navigationStateRequiredBit": 0x10000,
                    "originalStateInitializationRva": 0x19CC40,
                    "terrainAcceptanceRva": 0x16E0710,
                    "directStateWriteStartRva": 0x1A1BA4,
                },
                "snapshotHistoryRestored": False,
                "nativeUnregisterAndRegisterExecuted": False,
                "terrainAdmittedProviders": 0,
            },
            output,
            indent=2,
            allow_nan=False,
        )


if __name__ == "__main__":
    main()

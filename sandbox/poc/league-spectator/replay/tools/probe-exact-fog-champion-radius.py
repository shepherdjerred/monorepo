"""Execute the native radius branch for authentic opposing-team hero providers."""

import argparse
import importlib
import json
import struct
from pathlib import Path

from unicorn import UC_HOOK_CODE

fog = importlib.import_module("probe-exact-fog-keyframe-provider")
reg = fog.reg
REPLAY_SHA = "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668"
HERO_VTABLE = 0x236A6F8


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("mach", "navgrid", "provider_receipt", "scene", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.provider_receipt.read_bytes()
    if fog.sha(raw) != fog.PROVIDER_INPUT_SHA:
        raise ValueError("Expected authenticated native provider receipt")
    scene = json.loads(args.scene.read_bytes())
    if scene["identity"]["replaySha256"] != REPLAY_SHA:
        raise ValueError("Expected exact long replay scene identities")
    teams = {row["participantId"]: row["teamId"] for row in scene["participants"]}
    if len(teams) != 10 or set(teams.values()) != {100, 200}:
        raise ValueError("Expected the independently bound champion roster")
    receipt = json.loads(raw)
    match = next(fixture["match"] for fixture in receipt["fixtures"] if fixture["sha256"] == REPLAY_SHA)
    rows = [
        row
        for row in receipt["rows"]
        if (row["match"], row["stream"], row["opcode"]) == (match, 2, 1158) and row["ownerId"] in teams
    ]
    if len(rows) != 20:
        raise ValueError("Unexpected recorded hero-owned keyframe provider cohort")

    image = fog.MachImage(args.mach.read_bytes())
    oracle = fog.navgrid.FogNavgrid(image, args.navgrid.read_bytes())
    base = oracle.base
    owner = oracle.ARENA + 0x5000
    team_map = oracle.ARENA + 0xA000
    # Run the concrete hero vtable store, stopping before later ctor events.
    oracle.call(0x159A92, {reg.UC_X86_REG_R12: owner}, stop_rva=0x159A9D)
    if oracle.get(owner) != base + HERO_VTABLE:
        raise ValueError("Unexpected original concrete champion vtable")
    slots = {0x128: 0xEBFD0, 0x130: 0xEBFE0, 0x3E8: 0xCA300, 0x690: 0xD6F30}
    if any(oracle.get(base + HERO_VTABLE + slot) != base + rva for slot, rva in slots.items()):
        raise ValueError("Unexpected concrete hero virtual targets")
    oracle.put(base + 0x24E8590, team_map)
    native_team_slots = {team: oracle.call(0x6DE3C0, {reg.UC_X86_REG_RDI: team}) & 0xFF for team in (100, 200)}
    for team, slot in native_team_slots.items():
        oracle.cpu.mem_write(team_map + slot * 4 + 0x20, struct.pack("<I", team))

    findings = []
    for index, row in enumerate(rows):
        address = oracle.ARENA + 0x7000 + index * 0x100
        if row["sourceEntityId"] != 0:
            raise ValueError("Unexpected source entity on recorded hero provider")
        writes = bytes.fromhex(row["postRegistrationWrites6c"])
        baseline = fog.construct_provider(
            oracle,
            {
                **row,
                "ownerId": 0,
                "postRegistrationWrites6c": (bytes(4) + writes[4:]).hex(),
            },
            address,
        )
        oracle.cpu.mem_write(address + 0x6C, writes)
        owner_slot = native_team_slots[teams[row["ownerId"]]]
        if owner_slot == row["teamSlot"]:
            raise ValueError("Expected the recorded opposing-team provider case")
        oracle.cpu.mem_write(owner + 0x15C, bytes([owner_slot]))
        oracle.cpu.mem_write(address + 0x3C, struct.pack("<I", row["ownerId"]))
        looked_up = []

        def lookup(cpu, _address, _size, _data, owner_id=row["ownerId"], observed=looked_up):
            identifier = cpu.reg_read(reg.UC_X86_REG_ESI)
            if identifier != owner_id:
                raise ValueError("Unexpected hero owner lookup")
            observed.append(identifier)
            stack = cpu.reg_read(reg.UC_X86_REG_RSP)
            cpu.reg_write(reg.UC_X86_REG_RAX, owner)
            cpu.reg_write(reg.UC_X86_REG_RSP, stack + 8)
            cpu.reg_write(reg.UC_X86_REG_RIP, oracle.get(stack))

        def modifier(*_):
            raise ValueError("Opposing-team provider consulted the owner modifier")

        def stop_before_pose(cpu, *_):
            cpu.emu_stop()

        hooks = [
            oracle.cpu.hook_add(UC_HOOK_CODE, callback, begin=base + rva, end=base + rva)
            for rva, callback in ((0x5587F0, lookup), (0xCA300, modifier), (0x214276, stop_before_pose))
        ]
        try:
            oracle.call(0x214200, {reg.UC_X86_REG_RDI: address}, stop_rva=0x214276)
        finally:
            for hook in hooks:
                oracle.cpu.hook_del(hook)
        radius = oracle.get(address + 0x10, "f")
        if looked_up != [row["ownerId"]] or radius != baseline or radius != row["registrationScalars"][0]:
            raise ValueError("Native opposing-team radius differs from the recorded base")
        findings.append(
            {
                "providerId": row["providerId"],
                "ownerId": row["ownerId"],
                "providerTeamSlot": row["teamSlot"],
                "boundOwnerTeamId": teams[row["ownerId"]],
                "ownerTeamSlot": owner_slot,
                "nativeRadius": radius,
                "chunk": row["chunk"],
                "timeSeconds": row["timeSeconds"],
            }
        )

    with args.output.open("x", encoding="utf-8") as output:
        json.dump(
            {
                "replaySha256": REPLAY_SHA,
                "sceneSha256": fog.sha(args.scene.read_bytes()),
                "nativeHeroTableRva": HERO_VTABLE,
                "nativeRadiusBoundaryRva": 0x214276,
                "nativeMovementAccessorRva": slots[0x690],
                "findings": findings,
                "ownerPoseRestored": False,
                "terrainAdmittedProviders": 0,
            },
            output,
            indent=2,
            allow_nan=False,
        )


if __name__ == "__main__":
    main()

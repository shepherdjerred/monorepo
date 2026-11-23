"""Observe original turret fog constructor fields and getter instructions offline."""

import argparse
import importlib
import json
from pathlib import Path

from macho import MachImage
from unicorn import UC_HOOK_MEM_WRITE
from unicorn import x86_const as reg

navgrid = importlib.import_module("probe-exact-fog-navgrid")
OWNER_CENSUS_SHA = "b1f38dc0f852055d5a2d38aa34afca08a7dacd207b07a082601588fe7a3b41bc"
FACTORY = 0x1D9900
CONSTRUCTOR_BOUNDARY = 0x67179
VTABLE_INSTALL = (0x1BE21A, 0x1BE224)
VTABLE = 0x23798F0
SLOTS = {0x128: 0xEBFD0, 0x130: 0xEBFE0, 0x2B8: 0xCD530, 0x3E8: 0xCA300, 0x690: 0xD6F30}
GROUPS_SHA = "dd369e1b98995ac0f41476bb4d376cebd7159496edde0bbbf8a023b875f09b8e"
REGISTER = 0x1AECF0
GROUP_32 = 0x250B080
AGGREGATE_COPY = (0x68668, 0x686E4)


class TurretOracle(navgrid.FogNavgrid):
    def operation(self, cpu, address, size, name):
        stack = cpu.reg_read(reg.UC_X86_REG_RSP)
        if name == "____chkstk_darwin":
            self.calls[name] += 1
            count = cpu.reg_read(reg.UC_X86_REG_RAX)
            self.check_arena(stack - count, count)
        elif name in ("___cxa_guard_acquire", "___cxa_guard_release"):
            self.calls[name] += 1
            guard = cpu.reg_read(reg.UC_X86_REG_RDI)
            if not self.base + 0x250A800 <= guard < self.base + 0x250B460:
                raise ValueError("Original guard outside turret descriptor area")
            result = int(self.get(guard, "B") == 0)
            if name == "___cxa_guard_release":
                cpu.mem_write(guard, b"\x01")
                result = 0
            cpu.reg_write(reg.UC_X86_REG_RAX, result)
        elif name in ("_strlen", "_memcpy", "_memmove"):
            self.calls[name] += 1
            first = cpu.reg_read(reg.UC_X86_REG_RDI)
            if name == "_strlen":
                count = 0
                while count < 512 and self.get(first + count, "B"):
                    count += 1
                if count == 512:
                    raise ValueError("Original constructor string exceeded the host boundary")
                cpu.reg_write(reg.UC_X86_REG_RAX, count)
            else:
                source = cpu.reg_read(reg.UC_X86_REG_RSI)
                count = cpu.reg_read(reg.UC_X86_REG_RDX)
                self.check_arena(first, count)
                if count > 8192:
                    raise ValueError("Original constructor copy exceeded the host boundary")
                cpu.mem_write(first, bytes(cpu.mem_read(source, count)))
                cpu.reg_write(reg.UC_X86_REG_RAX, first)
        else:
            return super().operation(cpu, address, size, name)
        cpu.reg_write(reg.UC_X86_REG_RSP, stack + 8)
        cpu.reg_write(reg.UC_X86_REG_RIP, self.get(stack))


def observe_constructor(oracle):
    owner = oracle.next_allocation
    oracle.cpu.mem_write(owner, bytes([0xA5]) * 0x3F10)
    original_writes = []

    def record(cpu, _access, address, length, _value, _data):
        original_writes.append(
            {
                "rva": cpu.reg_read(reg.UC_X86_REG_RIP) - oracle.base,
                "ownerOffset": address - owner,
                "bytes": length,
            }
        )

    for low, high in ((0x154, 0x15C), (0xFE8, 0xFEF)):
        oracle.cpu.hook_add(UC_HOOK_MEM_WRITE, record, begin=owner + low, end=owner + high)
    oracle.call(FACTORY, {}, stop_rva=CONSTRUCTOR_BOUNDARY)
    fields = bytes(oracle.cpu.mem_read(owner + 0xFE8, 8))
    flags = oracle.get(owner + 0x15B, "B")
    if fields != bytes(8) or flags != 0x21:
        raise ValueError("Original constructor prefix did not initialize the fog fields")

    # Execute the later native vtable store in isolation. The intervening original
    # constructor requires the configuration service, so its effects remain unknown.
    oracle.call(VTABLE_INSTALL[0], {reg.UC_X86_REG_RBX: owner}, stop_rva=VTABLE_INSTALL[1])
    if oracle.get(owner) != oracle.base + VTABLE:
        raise ValueError("Native turret vtable publication differs")
    for slot, getter in SLOTS.items():
        if oracle.get(oracle.base + VTABLE + slot) != oracle.base + getter:
            raise ValueError(f"Unexpected turret vtable entry {slot:#x}")
    output = oracle.ARENA + 0x3000
    first = {reg.UC_X86_REG_RDI: owner}
    component = oracle.call(SLOTS[0x130], first)
    if component != owner:
        raise ValueError("Native turret owner component was not self")
    oracle.call(
        SLOTS[0x3E8],
        {
            **first,
            reg.UC_X86_REG_RSI: output,
            reg.UC_X86_REG_RDX: output + 4,
        },
    )
    scale, offset = oracle.get(output, "f"), oracle.get(output + 4, "f")
    eligibility_bit = oracle.call(SLOTS[0x2B8], first) & 255
    if (scale, offset, eligibility_bit) != (1.0, 0.0, 0):
        raise ValueError("Native constructor/getter controls differ")
    return {
        "nativeFieldWrites": original_writes,
        "constructedModifierFieldsHex": fields.hex(),
        "constructedOwnerFlags": flags,
        "controlledGetterScale": scale,
        "controlledGetterOffset": offset,
        "controlledRestrictionBypassBit": eligibility_bit,
    }


def observe_recorded_groups(oracle, groups_input, turret_rows, clock):
    raw = groups_input.read_bytes()
    if navgrid.sha(raw) != GROUPS_SHA:
        raise ValueError("Expected repeated exact turret replication groups")
    source = json.loads(raw)
    owner_ids = {row["ownerId"] for row in turret_rows}
    groups = source["groups"]
    if {row["ownerId"] for row in groups} != owner_ids or len(groups) != 22:
        raise ValueError("Original turret group identity or count differs")
    owner = oracle.ARENA + 0x6000
    slot = oracle.ARENA + 0x4000
    input_address = slot + 0x100
    output = slot + 0x200
    oracle.put(owner, oracle.base + VTABLE)
    # Optional replication observer is disabled in this controlled registration.
    oracle.cpu.mem_write(oracle.base + 0x25D4B08, b"\x01\x00\x00\x00")
    oracle.call(REGISTER, {reg.UC_X86_REG_RDI: owner})
    descriptor = oracle.base + GROUP_32
    if (
        oracle.get(descriptor, "I") != 16
        or oracle.get(descriptor + 8) != 0xFBFF
        or [oracle.get(descriptor + 0x10 + bit * 4, "I") for bit in (11, 14)] != [0x1620, 0x19B8]
        or [oracle.calls[name] for name in ("___cxa_guard_acquire", "___cxa_guard_release")] != [7, 7]
    ):
        raise ValueError("Original turret group 32 descriptor differs")
    oracle.put(slot, descriptor)
    entries = []
    for row in groups:
        data = bytes.fromhex(row["dataHex"])
        if (row["group"], row["fieldMask"], len(data), row["stream"], row["timeSeconds"]) not in (
            (32, 0xFFFF, 25, 1, 0),
            (32, 0xFFFF, 25, 2, clock),
        ):
            raise ValueError("Original turret record does not match the admitted clock or group")
        oracle.cpu.mem_write(input_address, data + bytes(8))
        for at in (0x1620, 0x19B8, 0xFE8, 0xFEC):
            oracle.cpu.mem_write(owner + at, b"\xa5" * 4)
        consumed = oracle.call(
            0x1D7700,
            {
                reg.UC_X86_REG_RDI: slot,
                reg.UC_X86_REG_RSI: owner,
                reg.UC_X86_REG_RDX: row["fieldMask"],
                reg.UC_X86_REG_RCX: input_address,
            },
        )
        if consumed != len(data) or [oracle.get(owner + at, "I") for at in (0x1620, 0x19B8)] != [0, 0]:
            raise ValueError("Native turret group did not reproduce the recorded source fields")
        if any(oracle.get(owner + at) for at in (0x1638, 0x19D0)):
            raise ValueError("Optional resolver installed in the controlled owner")
        oracle.call(
            AGGREGATE_COPY[0],
            {
                reg.UC_X86_REG_RBX: owner + 0xD20,
                reg.UC_X86_REG_R14: owner + 0x1350,
            },
            stop_rva=AGGREGATE_COPY[1],
        )
        oracle.call(
            SLOTS[0x3E8],
            {
                reg.UC_X86_REG_RDI: owner,
                reg.UC_X86_REG_RSI: output,
                reg.UC_X86_REG_RDX: output + 4,
            },
        )
        scale, offset = oracle.get(output, "f"), oracle.get(output + 4, "f")
        if (scale, offset) != (1.0, 0.0):
            raise ValueError("Original direct modifier branch did not preserve the recorded fields")
        entries.append(
            {
                "ownerId": row["ownerId"],
                "stream": row["stream"],
                "timeSeconds": row["timeSeconds"],
                "nativeBytesConsumed": consumed,
                "rawOffsetBits": oracle.get(owner + 0x1620, "I"),
                "rawScaleDeltaBits": oracle.get(owner + 0x19B8, "I"),
                "directBranchGetterScale": scale,
                "directBranchGetterOffset": offset,
            }
        )
    return {
        "groupsSha256": GROUPS_SHA,
        "originalRegistrationRva": REGISTER,
        "group32DescriptorRva": GROUP_32,
        "group32FieldCount": 16,
        "group32FloatMask": 0xFBFF,
        "group32FogSourceOffsetsByBit": {"11": 0x1620, "14": 0x19B8},
        "originalRefreshRva": 0x114C20,
        "originalAggregateWriterRva": 0x67CA0,
        "originalAggregateCopyRange": AGGREGATE_COPY,
        "entries": entries,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("binary", "navgrid", "owner_census", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--groups", type=Path)
    args = parser.parse_args()
    census_bytes = args.owner_census.read_bytes()
    if navgrid.sha(census_bytes) != OWNER_CENSUS_SHA:
        raise ValueError("Expected the repeated exact-keyframe owner census")
    census = json.loads(census_bytes)
    turret_rows = [row for row in census["rows"] if row["worldBinding"] is not None]
    if len(turret_rows) != 11:
        raise ValueError("Expected the eleven independently bound turret owners")
    oracle = TurretOracle(MachImage(args.binary.read_bytes()), args.navgrid.read_bytes())
    report = {
        "kind": "exact-build-fog-turret-owner-constructor-control",
        "build": census["build"],
        "protocol": census["protocol"],
        "replaySha256": census["replaySha256"],
        "ownerCensusSha256": OWNER_CENSUS_SHA,
        "matchKeyframe": census["keyframe"],
        "turretProviderIds": [row["providerId"] for row in turret_rows],
        "nativeOpcode921PathRvas": [0x6EE4D4, 0x1B1750, 0x1007EE0, 0x10076F0, 0x1AE920],
        "reflectedTurretClassHash": "beba9102",
        "nativeFactoryRva": FACTORY,
        "nativeConstructorRva": 0x1BE1F0,
        "nativeConstructorBoundaryRva": CONSTRUCTOR_BOUNDARY,
        "nativeVtableRva": VTABLE,
        "nativeVirtualSlots": {f"{slot:#x}": rva for slot, rva in SLOTS.items()},
        **observe_constructor(oracle),
        "hostBoundaryCalls": oracle.calls,
        "keyframeFieldsUnresolved": [
            "Modifier accumulator float32 at owner+0xfe8 and owner+0xfec",
            "Runtime flags byte at owner+0x15b and team slot byte at owner+0x15c",
            "Movement selector/owner+0x3730 at the 0xd6f30 getter",
            "Restriction rows consulted by 0x21dcb0 and 0x221900 perspective selection",
        ],
        "scope": {
            "nativeConstructorPrefixExecuted": True,
            "nativeVtableStoreAndGetterControlsExecuted": True,
            "completeOwnerConstruction": False,
            "recordedModifierStateReconstructed": False,
            "ownedTerrainProvidersExecuted": 0,
            "rendererAdmission": False,
        },
    }
    if args.groups is not None:
        report["recordedGroups"] = observe_recorded_groups(
            oracle,
            args.groups,
            turret_rows,
            census["keyframe"]["timeSeconds"],
        )
        report["scope"]["recordedRawModifierFieldsReconstructed"] = True
        report["scope"]["actualOptionalResolverStateReconstructed"] = False
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)


if __name__ == "__main__":
    main()

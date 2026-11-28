r"""Trace three recorded Maokai R missiles through archived movement and stop routines.

Run from the repository root with Unicorn installed:
    python probe-rift-maokai-movement.py <archived-macos-executable> \
        <private-stem.navgrid> <private-stem.json> <fresh-private-output.json>

The navgrid and JSON come from verify-rift-maokai-launches.mjs. The original
movement routines start from the replay's recorded birth pose and authored
controller values. Sample cadence is controlled, and native hit reactions,
visibility, VFX seed, rendering and emitter teardown are outside this probe.
"""

import argparse
import hashlib
import json
import math
import runpy
import struct
import sys
from pathlib import Path

from unicorn import UC_HOOK_CODE
from unicorn import x86_const as r

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
navgrid_tools = runpy.run_path(str(TOOLS / "probe-exact-fog-navgrid.py"))
FogNavgrid = navgrid_tools["FogNavgrid"]
MachImage = navgrid_tools["MachImage"]
SHOW_PACKET_HASHES = {
    # observe-maokai-visibility-boundary.py verifies these original opcode-66
    # payloads set the team mask without writing any other owner state.
    "8c25b3494723a39b933e5a4ce5f139279586ffe1a70f98abacf903a2b0f4c258",
    "c616d342397df9f01b60c9d363aa4a9c1205344587166e8960efacafae6865df",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def only_value(field):
    assert field["type"] == "F32"
    return field["value"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    if not __debug__:
        parser.error("Run the probe with assertions enabled")
    for name in ("executable", "navgrid", "launch_receipt", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument(
        "--outer", action="store_true", help="Trace the two outer missiles up to their first unclassified packet"
    )
    parser.add_argument("--discovery-sha256", help="Reviewed canonical discovery receipt hash")
    parser.add_argument(
        "--authored-movement", type=Path, help="Original Maokai spell receipt from verify-rift-maokai-launches"
    )
    parser.add_argument("--max-launches", type=int, help="Limit discovery verification to the earliest launches")
    args = parser.parse_args()
    output = args.output
    if not output.parent.resolve().is_relative_to(Path(".cache").resolve()) or output.exists():
        raise ValueError("Expected a fresh private .cache output")
    source_bytes = args.launch_receipt.read_bytes()
    source = json.loads(source_bytes)
    binary = args.executable.read_bytes()
    navgrid = args.navgrid.read_bytes()
    assert source["build"] == "16.23.841.8428"
    assert source["protocol"] == "8bbfcd5af2bc92db"
    discovery = args.discovery_sha256 is not None
    if discovery:
        assert not args.outer and args.authored_movement
        assert args.max_launches is None or args.max_launches > 0
        assert sha(source_bytes) == args.discovery_sha256
        assert source["kind"] == "reviewed-native-maokai-r-launch-discovery"
        receipts = json.loads(args.authored_movement.read_bytes())
        assert receipts["build"] == source["build"] and receipts["protocol"] == source["protocol"]
        cohort = receipts["cohorts"][0]
        decoder_sha = source["decoderSha256"]
        navgrid_sha = receipts["navgridSha256"]
    else:
        assert args.authored_movement is None and args.max_launches is None
        assert source["replaySha256"] == "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
        cohort = source["cohorts"][0]
        decoder_sha = source["native"]["decoderSha256"]
        navgrid_sha = source["navgridSha256"]

    class CurrentNavgrid(FogNavgrid):
        EXECUTABLE_SLICE_SHA256 = "de6db1683eb61358d0aaf9fac44ef722850a927263eae7f68212add8621a500e"

        def operation(self, cpu, address, size, name):
            if name not in ("_strlen", "_memcpy"):
                return super().operation(cpu, address, size, name)
            first = cpu.reg_read(r.UC_X86_REG_RDI)
            if name == "_strlen":
                assert self.base <= first < self.base + len(self.image.image) - 256
                result = bytes(cpu.mem_read(first, 256)).index(0)
            else:
                source = cpu.reg_read(r.UC_X86_REG_RSI)
                length = cpu.reg_read(r.UC_X86_REG_RDX)
                assert self.base <= source <= self.base + len(self.image.image) - length
                self.check_arena(first, length)
                cpu.mem_write(first, bytes(cpu.mem_read(source, length)))
                result = first
            stack = cpu.reg_read(r.UC_X86_REG_RSP)
            cpu.reg_write(r.UC_X86_REG_RAX, result)
            cpu.reg_write(r.UC_X86_REG_RIP, self.get(stack))
            cpu.reg_write(r.UC_X86_REG_RSP, stack + 8)

    assert sha(binary) == decoder_sha == "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
    assert sha(navgrid) == navgrid_sha == "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9"
    image = MachImage(binary)
    oracle = CurrentNavgrid(image, navgrid)
    oracle.load()
    vm = oracle.cpu
    arena = oracle.ARENA + 0x2000000
    actor, config, controller, descriptor, placement, proposal, empty = [arena + 0x1000 * offset for offset in range(7)]

    def put(address, layout, *values):
        vm.mem_write(address, struct.pack("<" + layout, *values))

    def read(address, layout):
        return struct.unpack("<" + layout, vm.mem_read(address, struct.calcsize("<" + layout)))

    def bits(value):
        return struct.unpack("<I", struct.pack("<f", value))[0]

    def call(address, *args, dt=0):
        values = [*args, *((0,) * (4 - len(args))), bits(dt)]
        regs = (r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX, r.UC_X86_REG_XMM0)
        return oracle.call(address, dict(zip(regs, values, strict=True)))

    spatial_writes = []
    stop_writes = []
    expected_source = None

    def observe_boundary(cpu, address, _size, _data):
        dest = cpu.reg_read(r.UC_X86_REG_RDI)
        if address == image.base + 0x5568A0 and dest == actor:
            spatial_writes.append(read(actor + 0x160, "3f"))
        elif address == image.base + 0x8AF4D0 and dest == config:
            stop_writes.append(read(actor + 0x60, "3f"))
        elif address == image.base + 0x5587F0:
            assert cpu.reg_read(r.UC_X86_REG_ESI) == expected_source
        else:
            raise ValueError("Unexpected spatial or stop boundary")
        stack = cpu.reg_read(r.UC_X86_REG_RSP)
        cpu.reg_write(r.UC_X86_REG_RAX, 0)
        cpu.reg_write(r.UC_X86_REG_RIP, read(stack, "Q")[0])
        cpu.reg_write(r.UC_X86_REG_RSP, stack + 8)

    for address in (0x5568A0, 0x8AF4D0, 0x5587F0):
        vm.hook_add(UC_HOOK_CODE, observe_boundary, begin=image.base + address, end=image.base + address)
    movement_vtable = 0x23CF2E0
    actor_vtable = 0x23CEF20
    for table, offset, expected in (
        (movement_vtable, 0x18, 0x895F40),
        (movement_vtable, 0x20, 0x8A1850),
        (movement_vtable, 0xE8, 0x895FE0),
        (movement_vtable, 0xF0, 0x8A65E0),
        (actor_vtable, 0xA0, 0x5560D0),
        (actor_vtable, 0x1F0, 0x87CFB0),
    ):
        assert read(image.base + table + offset, "Q")[0] == image.base + expected

    assert cohort["spellName"] == "MaokaiRMis"
    assert cohort["baseSha256"] == "b6d9a1f03f96018c40a3f3d4da2345983ebbe3e15c1c0d934a1bc4dd62e46b8d"
    fields = cohort["movement"]["fields"]
    assert cohort["movement"]["classHash"] == "af905da2"
    assert fields["2df5584d"]["value"] is False  # Tracks target.
    assert fields["d6a12457"]["value"] is True  # Ground rebase.
    assert "27a5c707" not in fields  # Range projection defaults to false.
    assert "c8847abf" not in fields  # Original constructor defaults the minimum.
    assert "90d578dd" not in fields  # No target height augment.
    assert "f20fdeef" not in fields  # No initial vertical adjustment.
    call(0x89BBE0, config)
    native_defaults = list(read(config + 0x5C, "4f"))
    assert native_defaults == [0, 0, 0, 0]
    native_minimum = native_defaults[1]
    acceleration, maximum, starting = (only_value(fields[key]) for key in ("82ff2d4c", "ef7f4569", "82f1d787"))
    assert (acceleration, maximum, starting) == (300, 750, 100)

    def initialize(record, endpoint):
        vm.mem_write(actor, bytes(0x1000))
        vm.mem_write(placement, bytes(0x1000))
        vm.mem_write(controller, bytes(0x1000))
        put(actor, "Q", image.base + actor_vtable)
        put(actor + 0x358, "Q", config)
        put(actor + 0x368, "Q", placement)
        put(descriptor + 0xD0, "3f", *record["castSourceXYZ"])
        put(descriptor + 0xDC, "3f", *endpoint)
        put(descriptor + 0x90, "I", record["sourceContext"])
        put(descriptor + 0x158, "B", 1)
        put(placement + 0x14, "B", 1)
        call(0x88DA10, placement, descriptor, 0, empty)
        origin = read(placement, "3f")
        assert origin == tuple(record["castSourceXYZ"])
        put(actor + 0x160, "3f", *origin)
        put(controller, "Q", image.base + movement_vtable)
        put(controller + 0x18, "Q", actor)
        put(controller + 0x7C, "3f", *endpoint)
        put(controller + 0xA0, "f", starting)
        put(controller + 0xC0, "B", 1)
        put(controller + 0xD8, "3f", acceleration, native_minimum, maximum)
        call(0x895F40, controller)
        velocity = read(actor + 0x60, "3f")
        target = read(controller + 0x7C, "3f")
        speed = math.hypot(velocity[0], velocity[2]) if discovery else math.hypot(*velocity)
        assert math.isclose(speed, starting, abs_tol=0.01), (record["entity"], origin, target, velocity, starting)
        return {
            "positionXYZ": origin,
            "velocityXYZ": velocity,
            "targetXYZ": target,
            "terrainRelativeHeight": read(placement + 0xC, "f")[0],
        }

    def advance(dt):
        vm.mem_write(proposal, bytes(32))
        call(0x895FE0, controller, proposal, dt=dt)
        if call(0x8A65E0, controller, proposal) & 255:
            if discovery:
                return None
            raise ValueError("Native geometric termination precedes recorded boundary")
        spatial_writes.clear()
        call(0x8A1850, controller, proposal)
        position = read(actor + 0x160, "3f")
        assert spatial_writes == [position]
        return position

    cases = []
    omissions = []
    if args.outer:
        assert sha(source_bytes) == "dae6f325435b30bf80cdfe6810e253754339956d2e8c5e083f509aa1e5415894"
    handles = (1073820800, 1073820809) if args.outer else (1073820771, 1073820782, 1073820791)
    if discovery:
        inputs = [(row, row["identity"]) for row in source["candidates"][: args.max_launches]]
    else:
        event_by_id = {event["id"]: event for event in cohort["events"]}
        record_by_id = {row["entity"]: row for row in source["native"]["records"]}
        inputs = [(event_by_id[handle], record_by_id[handle]) for handle in handles]
    for event, record in inputs:
        ident = record["entity"]
        expected_source = record["sourceContext"]
        assert record["forcedRecordedSource"] and record["packetElapsedSeconds"] == 0
        assert record["requestedMissileSpellHash"] == 0x0187CC63
        launch_seconds = event["launch"]["seconds"]
        if not discovery:
            assert expected_source == 1073742170 and launch_seconds == 1713.9644140625
        if discovery:
            assert record["sourceName"] == "Maokai"
            stop_seconds = None
            birth_visibility = []
            first_unclassified = None
            for packet in event["subsequentPackets"]:
                if packet["opcode"] == 66 and packet["bodyBytes"] == 2 and packet["bodySha256"] in SHOW_PACKET_HASHES:
                    if packet["seconds"] == launch_seconds:
                        birth_visibility.append(packet)
                    continue
                first_unclassified = packet
                break
            if not birth_visibility or not first_unclassified or first_unclassified["seconds"] <= launch_seconds:
                omissions.append({"entity": ident, "reason": "missing-proven-visible-prefix"})
                continue
            verified_through = first_unclassified["seconds"]
        elif args.outer:
            assert not event["stops"]
            assert event["opcodeInventory"].keys() <= {"66", "213", "639", "682", "696", "784"}
            assert all(len(bytes.fromhex(packet["payload"])) == 19 for packet in event["components"])
            first_unclassified = min(
                event["otherActorPackets"] + event["components"], key=lambda packet: packet["sequence"]
            )
            stop_seconds = None
            verified_through = first_unclassified["seconds"]
        else:
            assert event["opcodeInventory"].keys() <= {"66", "479", "639", "682", "784"}
            stop_seconds = event["stops"][0]["seconds"]
            assert all(row["seconds"] == stop_seconds for row in event["stops"])
            first_contact = min((row["seconds"] for row in event["components"]), default=stop_seconds)
            verified_through = min(first_contact, stop_seconds)
        duration = verified_through - launch_seconds
        assert duration > 0
        target = record["castTargetXYZ"]
        control = initialize(record, [target[0] + 50, *target[1:]])
        before = initialize(record, target)
        assert control["velocityXYZ"] != before["velocityXYZ"]
        fields_at_start = {"timeSeconds": launch_seconds, **before, "speed": starting}
        coarse_end = None if discovery else advance(duration)
        initialize(record, target)
        subdivisions = math.ceil(duration * 120)
        samples = [fields_at_start]
        for index in range(1, subdivisions + 1):
            position = advance(duration / subdivisions)
            if position is None:
                break
            samples.append(
                {
                    "timeSeconds": launch_seconds + duration * index / subdivisions,
                    "positionXYZ": position,
                    "velocityXYZ": read(actor + 0x60, "3f"),
                    "speed": read(controller + 0xA0, "f")[0],
                }
            )
        cadence_delta = None if discovery else math.dist(coarse_end, samples[-1]["positionXYZ"])
        if discovery:
            if len(samples) != subdivisions + 1:
                omissions.append({"entity": ident, "reason": "native-geometric-terminal-before-packet"})
                continue
        else:
            assert cadence_delta < 0.25
            assert math.dist(before["positionXYZ"], samples[-1]["positionXYZ"]) > 100
        stop_writes.clear()
        bounded_prefix = args.outer or discovery
        if not bounded_prefix:
            call(0x893510, actor)
            assert stop_writes == [(0, 0, 0)]
            assert read(actor + 0x3D8, "B") == (1,)
        cases.append(
            {
                "entity": ident,
                "recordedLaunchTimeSeconds": launch_seconds,
                "recordedStopTimeSeconds": stop_seconds,
                "motionVerifiedThroughSeconds": verified_through,
                "postContactMotionUnverified": bounded_prefix or verified_through < stop_seconds,
                "launchBodySha256": event["launch"]["bodySha256"],
                "recordedStopSequences": [] if discovery else [row["sequence"] for row in event["stops"]],
                "nativeGeometricTerminalGateTriggeredDuringTrace": False,
                "nativeVelocityZeroAtStop": None if bounded_prefix else True,
                "nativeMissileStoppedBitAtStop": None if bounded_prefix else True,
                **(
                    {
                        "firstUnclassifiedPacket": {
                            key: first_unclassified[key] for key in ("opcode", "sequence", "seconds", "bodySha256")
                        }
                    }
                    if bounded_prefix
                    else {}
                ),
                **({"sourceContext": expected_source, "birthVisibilityPackets": birth_visibility} if discovery else {}),
                "differentTargetVelocityControl": control["velocityXYZ"],
                "oneStepEndpointDeltaFrom120HzWorldUnits": cadence_delta,
                "samples": samples,
            }
        )

    with output.open("x", encoding="utf-8") as file:
        json.dump(
            {
                "build": source["build"],
                "protocol": source["protocol"],
                "replaySha256": source["replaySha256"],
                "decoderSha256": sha(binary),
                "navgridSha256": sha(navgrid),
                "launchReceiptSha256": sha(source_bytes),
                "sourceSpellSha256": cohort["baseSha256"],
                "spellName": cohort["spellName"],
                "nativeMovementInputs": [acceleration, native_minimum, maximum, starting],
                "entries": {
                    "launchPlacement": "0x88da10",
                    "initializer": "0x895f40",
                    "proposal": "0x895fe0",
                    "apply": "0x8a1850",
                    "geometricTerminalCheck": "0x8a65e0",
                    "stop": "0x893510",
                },
                "cases": cases,
                **({"omissions": omissions, "visibilityReceiverRva": "0x21fe40"} if discovery else {}),
                "scope": (
                    "Original movement for a recorded visible prefix under All vision, from a "
                    "same-clock native team-mask set through the first subsequent packet outside "
                    "the reviewed mask-set family. The final sample is an exclusive boundary. "
                    "No stop is synthesized and per-team visibility and emitter state are separate."
                )
                if discovery
                else (
                    "Original movement from recorded birth strictly before the first unclassified "
                    "actor packet, using exact Map11 heights. The final sample is an exclusive "
                    "boundary. No stop is synthesized. Native visibility, VFX seed and teardown "
                    "remain outside the trace."
                )
                if args.outer
                else (
                    "Original movement and world-state apply from recorded birth to the first recorded contact "
                    "or stop, using exact Map11 heights. The archived stop consumer is checked separately. "
                    "Sample cadence is controlled. Native visibility, shader, VFX seed and teardown "
                    "are outside this trace."
                ),
            },
            file,
            allow_nan=False,
            indent=2,
        )
        file.write("\n")


if __name__ == "__main__":
    main()

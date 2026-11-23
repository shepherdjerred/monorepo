"""Trace exact director event ingestion and bounded scoring for two recorded packets.

FIRST generate SOURCE with tools/research/extract-exact-director-death.mjs.
Then run this probe with the archived executable, SOURCE, and a fresh receipt.
"""

import argparse
import hashlib
import json
import struct
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as reg

EXECUTABLE_HASH = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
REPLAY_HASH = "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668"
SOURCE_HASH = "fb069becb39ee720bf480fc8611e88fc2d54f23ae3ec34bf1726e838c2a39948"
ARENA = 0x6000000
STOP = ARENA
STACK = ARENA + 0xFFF8
ACTOR = ARENA + 0x1000
DIRECTOR = ARENA + 0x2000
SCORE_NODE = ARENA + 0x2500
TABLE = ARENA + 0x3000
ROW = TABLE + 0x100
TREE_NODE = TABLE + 0x200
PACKET = ARENA + 0x4000
DATA = ARENA + 0x14000
CURSOR = ARENA + 0x6000
CLOCK = ARENA + 0x7000
FRAME = ARENA + 0x8000


def context_prefix(image, context):
    table = image[0x2156E30:0x2156F30]

    def rol(value):
        return ((value << 1) | (value >> 7)) & 255

    inverse = {table[table[(rol((table[value ^ 255] + 0x54) & 255))] + 0xB4 & 255]: value for value in range(256)}
    if len(inverse) != 256:
        raise ValueError("Original context-byte substitution is not bijective")
    value = context ^ 0x40000000 if context & 0xFFFFFF else context
    encoded = bytearray()
    while value >= 128:
        encoded.append(inverse[(value & 127) | 128])
        value >>= 7
    encoded.append(inverse[value])
    return bytes(encoded)


def trace(image, source):
    u = Uc(UC_ARCH_X86, UC_MODE_64)
    u.mem_map(image.base, len(image.image))
    u.mem_write(image.base, bytes(image.image))
    u.mem_map(ARENA, 0x20000)

    def put(address, fmt, *values):
        u.mem_write(address, struct.pack("<" + fmt, *values))

    def get(address, fmt):
        return struct.unpack("<" + fmt, u.mem_read(address, struct.calcsize("<" + fmt)))

    def frame(start, registers, stop=STOP):
        put(STACK, "Q", STOP)
        u.reg_write(reg.UC_X86_REG_RSP, STACK)
        for key, value in registers.items():
            u.reg_write(key, value)
        u.emu_start(image.base + start, stop, count=20_000)
        if u.reg_read(reg.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Original block did not reach its boundary, {start:#x}")

    def return_value(register, value):
        u.reg_write(register, value)
        rsp = u.reg_read(reg.UC_X86_REG_RSP)
        u.reg_write(reg.UC_X86_REG_RSP, rsp + 8)
        u.reg_write(reg.UC_X86_REG_RIP, get(rsp, "Q")[0])

    def on_call(address, handler):
        absolute = image.base + address
        u.hook_add(
            UC_HOOK_CODE,
            lambda *_: handler(),
            begin=absolute,
            end=absolute,
        )

    allocs = []

    def allocate():
        size = u.reg_read(reg.UC_X86_REG_RDI)
        if size not in (0x58, 0x30, 0x20) or len(allocs) >= 5:
            raise ValueError(f"Unexpected allocation in event enqueue, {size:#x}")
        return_value(reg.UC_X86_REG_RAX, ARENA + 0x10000 + len(allocs) * 0x100)
        allocs.append(size)

    for lock in (0x15045F0, 0x1504600):
        on_call(lock, lambda: return_value(reg.UC_X86_REG_RAX, 0))
    on_call(0x14A0300, allocate)

    # Recover f32 packet-clock accumulation using the original compact clock
    # block, starting at the exact on-wire absolute anchor.
    def native_time(record, expected):
        deltas = bytes(record["deltas"])
        put(CLOCK, "I", record["anchorBits"])
        put(CURSOR, "I", 0)
        u.mem_write(DATA, deltas)
        put(PACKET, "QI", DATA, len(deltas))
        for _ in deltas:
            frame(
                0x78ED18,
                {
                    reg.UC_X86_REG_RBX: CLOCK,
                    reg.UC_X86_REG_R14: CURSOR,
                    reg.UC_X86_REG_R15: PACKET,
                },
                image.base + 0x78ED4D,
            )
        result = get(CLOCK, "f")[0]
        if get(CURSOR, "I")[0] != len(deltas) or result != expected:
            raise ValueError("Original packet clock did not match the recorded frame")
        return result

    event_time = native_time(source, 79.45333099365234)

    # Feed the original message constructor and deserializer the exact body,
    # with the leading context encoding that the original envelope rebuilds.
    context = source["context"]
    u.mem_write(PACKET, bytes(0x100))
    frame(0x1020D60, {reg.UC_X86_REG_RDI: PACKET})

    def deserialize(record, packet, reader):
        encoded = context_prefix(image.image, record["context"]) + bytes.fromhex(record["body"])
        u.mem_write(DATA, encoded)
        put(CURSOR, "Q", DATA)
        frame(
            reader,
            {
                reg.UC_X86_REG_RDI: packet,
                reg.UC_X86_REG_RSI: CURSOR,
                reg.UC_X86_REG_RDX: DATA + len(encoded),
            },
        )
        if (
            u.reg_read(reg.UC_X86_REG_AL) != 1
            or get(packet + 8, "H2xI") != (record["opcode"], record["context"])
            or get(CURSOR, "Q")[0] != DATA + len(encoded)
        ):
            raise ValueError("Original message failed exact body verification")

    deserialize(source, PACKET, 0x1036B60)

    # A one-entry registered table provides the container boundary. The
    # original replay reader's lookup, original clone, and row writer run.
    put(image.base + 0x25E0140, "Q", TREE_NODE)
    put(TREE_NODE + 0x20, "I4xQ", 1183, TABLE)
    put(TABLE + 8, "QQQ", ROW, ROW, ROW + 24)
    put(FRAME - 0x70, "f", event_time)
    put(FRAME - 0x40, "Q", PACKET)
    frame(
        0x7A0C53,
        {reg.UC_X86_REG_RBP: FRAME},
        image.base + 0x7A0CC4,
    )
    stored_time, stored_packet, shared = get(ROW, "f4xQQ")
    if (
        stored_time != event_time
        or get(TABLE + 0x10, "Q")[0] != ROW + 24
        or get(stored_packet + 8, "H2xI") != (1183, context)
        or not shared
        or allocs != [0x58, 0x20]
    ):
        raise ValueError("Original replay writer did not create the expected event row")

    frame(
        0x79798B,
        {reg.UC_X86_REG_RBX: DIRECTOR},
        image.base + 0x7979F4,
    )
    if get(DIRECTOR + 0x68, "Q")[0] != TABLE:
        raise ValueError("Original director constructor did not select the 1183 table")

    # One independently bound champion object and its existing score-map
    # entry. The complete world registry, RTTI and actor lifetime are outside
    # this trace. Slot +0x3d8 still executes the original object ID getter.
    put(ACTOR, "Q", ACTOR + 0x100)
    put(ACTOR + 0x80, "I", context)
    put(ACTOR + 0x110, "Q", image.base + 0xD6A00)
    put(ACTOR + 0x100 + 0x2C8, "Q", ARENA + 0x9000)
    put(ACTOR + 0x100 + 0x3D8, "Q", image.base + 0x186E80)
    u.mem_write(ARENA + 0x9000, bytes.fromhex("b801000000c3"))
    put(DIRECTOR + 0x20, "Q", SCORE_NODE)
    put(SCORE_NODE + 0x1C, "I", context)
    put(image.base + 0x24E3030, "Q", CLOCK)
    put(CLOCK + 0x10, "Q", CLOCK)

    def resolve_actor():
        if u.reg_read(reg.UC_X86_REG_ESI) != context:
            raise ValueError("Director asked for an unexpected target")
        return_value(reg.UC_X86_REG_RAX, ACTOR)

    on_call(0x5564C0, resolve_actor)
    on_call(0x14E1B70, lambda: return_value(reg.UC_X86_REG_RAX, ACTOR))
    on_call(
        0x1610390,
        lambda: return_value(reg.UC_X86_REG_XMM0, get(CLOCK, "I")[0]),
    )
    lookahead = get(image.base + 0x21355F0, "f")[0]
    maximum = get(image.base + 0x2135040, "f")[0]
    put(DIRECTOR + 0x208, "ff", lookahead, maximum)
    controls = {}
    for label, seconds in (("beforeWindow", -11), ("withinWindow", -1), ("afterEvent", 1)):
        put(CLOCK, "f", event_time + seconds)
        put(SCORE_NODE + 0x20, "I", 0)
        frame(0x7993C0, {reg.UC_X86_REG_RDI: DIRECTOR})
        controls[label] = {
            "clock": get(CLOCK, "f")[0],
            "renektonDeathInterest": get(SCORE_NODE + 0x20, "I")[0],
        }
    if [control["renektonDeathInterest"] for control in controls.values()] != [0, 270, 0]:
        raise ValueError("Unexpected native death lookahead results")

    # A controlled no-focus state passes the recorded death contribution
    # through the original switch block. Other actors and score families are
    # omitted, so this is a branch trace rather than a match focus decision.
    inside_window = controls["withinWindow"]
    put(CLOCK, "f", inside_window["clock"])
    put(DIRECTOR, "fIIIff", 0, 0, 0, 0, 0, 0)
    put(DIRECTOR + 0x118, "f", get(image.base + 0x2134B38, "f")[0])
    put(DIRECTOR + 0x124, "f", get(image.base + 0x213507C, "f")[0])
    put(DIRECTOR + 0x12C, "f", get(image.base + 0x2135048, "f")[0])
    frame(
        0x79E039,
        {
            reg.UC_X86_REG_R13: DIRECTOR,
            reg.UC_X86_REG_RDX: context,
            reg.UC_X86_REG_RBX: 0x80000000,
            reg.UC_X86_REG_XMM0: 0,
            reg.UC_X86_REG_XMM1: int.from_bytes(struct.pack("<f", inside_window["renektonDeathInterest"]), "little"),
        },
        image.base + 0x79E10E,
    )
    focus = get(DIRECTOR + 8, "I")[0]
    if focus != context or u.reg_read(reg.UC_X86_REG_AL) != 1:
        raise ValueError("The native switch branch did not install the input actor")

    damage = source["damage"]
    damage_time = native_time(damage, 79.0523681640625)
    frame(0x100F2A0, {reg.UC_X86_REG_RDI: CURSOR, reg.UC_X86_REG_RSI: 530})
    damage_packet = get(CURSOR, "Q")[0]
    deserialize(damage, damage_packet, 0x1038080)
    damage_table = TABLE + 0x300
    damage_row = TABLE + 0x400
    put(TREE_NODE + 0x20, "I4xQ", 530, damage_table)
    put(damage_table + 8, "QQQ", damage_row, damage_row, damage_row + 24)
    put(FRAME - 0x70, "f", damage_time)
    put(FRAME - 0x40, "Q", damage_packet)
    frame(0x7A0C53, {reg.UC_X86_REG_RBP: FRAME}, image.base + 0x7A0CC4)
    damage_stored_time, damage_clone, damage_shared = get(damage_row, "f4xQQ")
    if (
        damage_stored_time != damage_time
        or get(damage_table + 0x10, "Q")[0] != damage_row + 24
        or get(damage_clone + 8, "H2xI") != (530, damage["context"])
        or not damage_shared
        or allocs != [0x58, 0x20, 0x30, 0x30, 0x20]
    ):
        raise ValueError("Original replay writer did not create the expected damage row")
    frame(
        0x797ACD,
        {reg.UC_X86_REG_RAX: TREE_NODE, reg.UC_X86_REG_RBX: DIRECTOR},
        image.base + 0x797B3D,
    )
    if get(DIRECTOR + 0xB0, "Q")[0] != damage_table:
        raise ValueError("Original director constructor did not select the 530 table")
    put(FRAME - 0x58, "Q", damage_clone)
    frame(0x79A8F0, {reg.UC_X86_REG_RBP: FRAME}, image.base + 0x79AAAF)
    damage_lookup = [
        u.reg_read(reg.UC_X86_REG_EDI),
        u.reg_read(reg.UC_X86_REG_ESI),
    ]
    if damage_lookup != [1073742169, 1073742164]:
        raise ValueError("Original actor lookup disagrees with the recorded Caitlyn/Sion pair")

    source_actor, target_actor = ARENA + 0xA000, ARENA + 0xB000
    target_node, source_node = ARENA + 0xC000, ARENA + 0xD000
    for actor, participant_id in zip((source_actor, target_actor), damage_lookup, strict=True):
        put(actor, "Q", ACTOR + 0x100)
        put(actor + 0x80, "I", participant_id)
    put(DIRECTOR + 0xF8, "Q", target_node)
    put(target_node + 8, "Q", source_node)
    put(target_node + 0x1C, "I", damage_lookup[1])
    put(source_node + 0x1C, "I", damage_lookup[0])
    damage_window = get(image.base + 0x2135034, "f")[0]
    damage_taken_weight = get(image.base + 0x7985BA, "I")[0]
    damage_dealt_weight = get(image.base + 0x7985F6, "I")[0]
    put(DIRECTOR + 0x224, "f", damage_window)
    put(DIRECTOR + 0x22C, "f", 0)  # Original loader clears XMM0 at 0x798578.
    put(DIRECTOR + 0x234, "I", damage_taken_weight)
    put(DIRECTOR + 0x23C, "I", damage_dealt_weight)

    def resolve_damage_actors():
        actual = [u.reg_read(reg.UC_X86_REG_EDI), u.reg_read(reg.UC_X86_REG_ESI)]
        if actual != damage_lookup:
            raise ValueError("Future damage scorer requested unexpected participants")
        put(u.reg_read(reg.UC_X86_REG_RDX), "Q", source_actor)
        put(u.reg_read(reg.UC_X86_REG_RCX), "Q", target_actor)
        return_value(reg.UC_X86_REG_RAX, 1)

    on_call(0x79B070, resolve_damage_actors)
    put(CLOCK, "f", inside_window["clock"])
    frame(0x79A6A0, {reg.UC_X86_REG_RDI: DIRECTOR})
    damage_scores = []
    for node in (source_node, target_node):
        frame(0x79CA30, {reg.UC_X86_REG_RDI: node + 0x20, reg.UC_X86_REG_RSI: DIRECTOR})
        damage_scores.append(u.reg_read(reg.UC_X86_REG_EAX))
    if damage_scores != [110, 66]:
        raise ValueError("Unexpected original future champion damage score")

    return {
        "nativeEventTime": event_time,
        "clonedOpcode": 1183,
        "rowBytes": 24,
        "victimContext": context,
        "compiledDefaults": {"lookaheadSeconds": lookahead, "maximumScore": maximum},
        "nativeDeathInterest": controls,
        "controlledSwitch": {
            "initialFocus": None,
            "isolatedCandidate": context,
            "candidateDeathInterest": inside_window["renektonDeathInterest"],
            "selectedFocus": focus,
            "clock": inside_window["clock"],
            "nativeBlockExecuted": True,
        },
        "damageEvent": {
            "opcode": 530,
            "rowBytes": 24,
            "nativeEventTime": damage_time,
            "packetContext": damage["context"],
            "nativeActorLookupArguments": damage_lookup,
            "controlledClock": inside_window["clock"],
            "compiledDefaults": {
                "lookaheadSeconds": damage_window,
                "damageTakenWeight": damage_taken_weight,
                "damageDealtWeight": damage_dealt_weight,
            },
            "nativeFutureDamageDealtInterest": damage_scores[0],
            "nativeFutureDamageTakenInterest": damage_scores[1],
        },
        "originalRvas": {
            "clock": 0x78ED18,
            "decode": 0x1036B60,
            "eventTableSelection": 0x79798B,
            "replayEventLookup": 0x7A0C53,
            "eventInsertion": 0x7AB600,
            "futureDeathScore": 0x7993C0,
            "damageDecode": 0x1038080,
            "damageTableSelection": 0x797ACD,
            "damageActorFieldDecode": 0x79A8F0,
            "futureDamageScore": 0x79A6A0,
            "aggregateDamageScore": 0x79CA30,
            "switchBlock": 0x79E039,
        },
        "scope": {
            "originalDeathEventEnqueue": True,
            "projectedRosterActorAndClockBoundaries": True,
            "allCandidateScoresRecoverable": False,
            "directedFocusRecovered": False,
            "originalMapOverridesRecovered": False,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("client", "source", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    client = args.client.read_bytes()
    source_bytes = args.source.read_bytes()
    source = json.loads(source_bytes)
    if hashlib.sha256(client).hexdigest() != EXECUTABLE_HASH:
        raise ValueError("Wrong archived native image")
    if (
        hashlib.sha256(source_bytes).hexdigest() != SOURCE_HASH
        or source["build"] != "16.23.840.6595"
        or source["protocol"] != "8bbfcd5af2bc92db"
        or source["replaySha256"] != REPLAY_HASH
        or (source["stream"], source["chunkOffset"], source["blockOffset"]) != (1, 239723, 406441)
        or (source["opcode"], source["context"]) != (1183, 1073742161)
    ):
        raise ValueError("Wrong recorded elimination evidence")
    result = trace(MachImage(client), source)
    result.update(
        executableSha256=EXECUTABLE_HASH,
        recordedSourceSha256=hashlib.sha256(source_bytes).hexdigest(),
        replaySha256=REPLAY_HASH,
    )
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

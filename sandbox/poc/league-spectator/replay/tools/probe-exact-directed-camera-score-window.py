"""Exercise the native detector for all future packets in a pinned replay window."""

import argparse
import importlib.util
import json
from hashlib import sha256
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

SOURCE = "17b73292ad8d74bb23bf7c8813145100ff28c8401fee7794eb61b178fd677052"
FRAMING = "6fc647711e19425507b5211b4624c9e0f6d410a6bcb8c7f3c2d500c10776af84"
PROBE = importlib.util.spec_from_file_location(
    "director_death", Path(__file__).with_name("probe-exact-directed-camera-death.py")
)
original = importlib.util.module_from_spec(PROBE)
PROBE.loader.exec_module(original)


def inspect(image, source, framing):
    import struct
    from collections import Counter

    base = image.base
    u = Uc(UC_ARCH_X86, UC_MODE_64)
    u.mem_map(base, len(image.image))
    u.mem_write(base, bytes(image.image))
    u.mem_map(original.ARENA, 0x40000)

    def put(address, fmt, *values):
        u.mem_write(address, struct.pack("<" + fmt, *values))

    def get(address, fmt):
        return struct.unpack("<" + fmt, u.mem_read(address, struct.calcsize("<" + fmt)))

    def frame(start, registers, stop=original.STOP):
        put(original.STACK, "Q", original.STOP)
        u.reg_write(r.UC_X86_REG_RSP, original.STACK)
        for reg, value in registers.items():
            u.reg_write(reg, value)
        u.emu_start(base + start, stop, count=100_000)
        if u.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Original block did not reach its boundary at {start:#x}")

    def return_value(register, value):
        u.reg_write(register, value)
        stack = u.reg_read(r.UC_X86_REG_RSP)
        u.reg_write(r.UC_X86_REG_RIP, get(stack, "Q")[0])
        u.reg_write(r.UC_X86_REG_RSP, stack + 8)

    def hook(address, handler):
        u.hook_add(UC_HOOK_CODE, lambda *_: handler(), begin=base + address, end=base + address)

    packet, cursor, data = original.PACKET, original.CURSOR, original.DATA
    director, stack_frame = original.DIRECTOR, original.FRAME
    hook(0x14A0300, lambda: return_value(r.UC_X86_REG_RAX, packet))
    actors = next(frame["actors"] for frame in framing["samples"] if frame["timeSeconds"] == source["start"])
    ids = {actor["participantId"] for actor in actors}
    if len(ids) != 10:
        raise ValueError("Expected the exact ten-actor framing sample")
    counts = Counter()
    damage = Counter()
    champion_pairs = []
    pair_rows = []
    neutral_contexts = []
    deaths = []
    death_rows = []
    for row in source["rows"]:
        opcode = row["opcode"]
        counts[opcode] += 1
        u.mem_write(packet, bytes(0x100))
        match opcode:
            case 530:
                frame(0x100F2A0, {r.UC_X86_REG_RDI: cursor, r.UC_X86_REG_RSI: opcode})
                reader = 0x1038080
            case 1183:
                frame(0x1020D60, {r.UC_X86_REG_RDI: packet})
                reader = 0x1036B60
            case 1197:
                frame(0x1020E60, {r.UC_X86_REG_RDI: packet})
                reader = 0x1036720
            case _:
                raise ValueError("Unexpected competing opcode in the pinned window")
        payload = original.context_prefix(image.image, row["context"]) + bytes.fromhex(row["body"])
        u.mem_write(data, payload)
        put(cursor, "Q", data)
        frame(reader, {r.UC_X86_REG_RDI: packet, r.UC_X86_REG_RSI: cursor, r.UC_X86_REG_RDX: data + len(payload)})
        if (
            u.reg_read(r.UC_X86_REG_AL) != 1
            or get(cursor, "Q")[0] != data + len(payload)
            or get(packet + 8, "H2xI") != (opcode, row["context"])
        ):
            raise ValueError(f"Original packet reader failed at {row['blockOffset']}")
        event = {"clock": row["time"], "context": row["context"], "blockOffset": row["blockOffset"]}
        if opcode == 1183:
            deaths.append(event)
            death_rows.append((row["time"], bytes(u.mem_read(packet, 0x58))))
        elif opcode == 1197:
            neutral_contexts.append(event)
        elif row["time"] < source["start"] + 5:
            put(stack_frame - 0x58, "Q", packet)
            frame(0x79A8F0, {r.UC_X86_REG_RBP: stack_frame}, base + 0x79AAAF)
            attacker = u.reg_read(r.UC_X86_REG_EDI)
            target = u.reg_read(r.UC_X86_REG_ESI)
            if attacker in ids and target in ids:
                damage["rosterPair"] += 1
                champion_pairs.append({**event, "attacker": attacker, "target": target})
                pair_rows.append((row["time"], bytes(u.mem_read(packet, 0x30))))
            elif attacker in ids or target in ids:
                damage["oneRosterActor"] += 1
            else:
                damage["noRosterActors"] += 1

    # Project all ten authentic actor identities and horizontal coordinates.
    # This isolates the death and roster-pair damage leaves from other scores.
    arena = original.ARENA
    vtable, is_champion = arena + 0x20000, arena + 0x20700
    u.mem_write(is_champion, bytes.fromhex("b801000000c3"))
    put(vtable + 0x10, "Q", base + 0xD6A00)
    put(vtable + 0x150, "Q", is_champion)
    put(vtable + 0x2B8, "Q", base + 0xD6A00)
    put(vtable + 0x2C8, "Q", is_champion)
    put(vtable + 0x3D8, "Q", base + 0x186E80)
    actor_by_id, score_by_id, damage_by_id = {}, {}, {}
    pointers = arena + 0x21000
    roster = arena + 0x21800
    put(base + 0x24E3140, "Q", roster)
    put(roster + 8, "QI", pointers, len(actors))
    for index, actor in enumerate(actors):
        participant = actor["participantId"]
        address = arena + 0x22000 + index * 0x1000
        actor_by_id[participant] = address
        put(pointers + index * 8, "Q", address)
        put(address, "Q", vtable)
        put(address + 0x80, "I", participant)
        put(address + 0x160, "fff", actor["x"], 0, actor["z"])
    for index, participant in enumerate(sorted(ids)):
        score_node = arena + 0x2D000 + index * 0x80
        damage_node = score_node + 0x1000
        score_by_id[participant] = score_node
        damage_by_id[participant] = damage_node
        for node in (score_node, damage_node):
            put(node + 0x1C, "I", participant)
            if index < len(ids) - 1:
                put(node + 8, "Q", node + 0x80)
    put(director + 0x20, "Q", next(iter(score_by_id.values())))
    put(director + 0xF8, "Q", next(iter(damage_by_id.values())))

    def install_table(slot, table, rows):
        start = table + 0x100
        put(director + slot, "Q", table)
        put(table + 8, "QQQ", start, start + len(rows) * 24, start + len(rows) * 24)
        for index, (time, body) in enumerate(rows):
            address = table + 0x400 + index * 0x100
            u.mem_write(address, body)
            put(start + index * 24, "f4xQQ", time, address, 0)

    install_table(0x68, arena + 0x30000, death_rows)
    install_table(0xB0, arena + 0x31000, pair_rows)
    clock = original.CLOCK
    put(base + 0x24E3030, "Q", clock)
    put(clock, "f", source["start"])
    put(clock + 0x10, "Q", clock)
    hook(0x1610390, lambda: return_value(r.UC_X86_REG_XMM0, get(clock, "I")[0]))
    for mutex in (0x15045F0, 0x1504600):
        hook(mutex, lambda: return_value(r.UC_X86_REG_RAX, 0))
    hook(0x5564C0, lambda: return_value(r.UC_X86_REG_RAX, actor_by_id[u.reg_read(r.UC_X86_REG_ESI)]))
    hook(0x14E1B70, lambda: return_value(r.UC_X86_REG_RAX, u.reg_read(r.UC_X86_REG_RSI)))

    def resolve_pair():
        source_id, target_id = (u.reg_read(reg) for reg in (r.UC_X86_REG_EDI, r.UC_X86_REG_ESI))
        put(u.reg_read(r.UC_X86_REG_RDX), "Q", actor_by_id[source_id])
        put(u.reg_read(r.UC_X86_REG_RCX), "Q", actor_by_id[target_id])
        return_value(r.UC_X86_REG_RAX, 1)

    hook(0x79B070, resolve_pair)
    for offset, address in (
        (0x208, 0x21355F0),
        (0x20C, 0x2135040),
        (0x224, 0x2135034),
        (0x234, 0x7985BA),
        (0x23C, 0x7985F6),
    ):
        put(director + offset, "I", get(base + address, "I")[0])
    for scorer in (0x7993C0, 0x79A6A0):
        frame(scorer, {r.UC_X86_REG_RDI: director})
    scores = []
    for actor in actors:
        participant = actor["participantId"]
        node = score_by_id[participant]
        death_score = get(node + 0x20, "I")[0]
        frame(0x79CA30, {r.UC_X86_REG_RDI: damage_by_id[participant] + 0x20, r.UC_X86_REG_RSI: director})
        damage_score = u.reg_read(r.UC_X86_REG_EAX)
        put(node + 0x20, "I", death_score + damage_score)
        scores.append(
            {
                "participantId": participant,
                "champion": actor["champion"],
                "deathInterest": death_score,
                "championPairDamageInterest": damage_score,
            }
        )
    put(stack_frame - 0x38, "Q", director)
    put(stack_frame - 0x58, "Q", arena + 0x32100)
    frame(0x79DE60, {r.UC_X86_REG_RBP: stack_frame}, base + 0x79E039)
    projected_winner = u.reg_read(r.UC_X86_REG_EDX)
    if projected_winner != deaths[0]["context"]:
        raise ValueError("Unexpected winner under the projected ranking")
    # Preserve the ranked output registers. Following the same controlled
    # initial state as the single-event probe, exercise original installation.
    for offset, address in (
        (0x118, 0x2134B38),
        (0x124, 0x213507C),
        (0x12C, 0x2135048),
    ):
        put(director + offset, "I", get(base + address, "I")[0])
    frame(0x79E039, {}, base + 0x79E10E)
    installed_focus = get(director + 8, "I")[0]
    if installed_focus != projected_winner or u.reg_read(r.UC_X86_REG_AL) != 1:
        raise ValueError("Original switch did not install the projected winner")
    return {
        "replaySha256": source["replaySha256"],
        "evaluatedClock": source["start"],
        "frameRoster": actors,
        "nativeDecoderCountsByOpcode": dict(counts),
        "damageWithinFiveSeconds": dict(damage),
        "championPairDamage": champion_pairs,
        "deaths": deaths,
        "neutralInterestPacketContexts": neutral_contexts,
        "projectedScoreLeaves": scores,
        "nativeWinnerOfProjectedScores": projected_winner,
        "nativeInstalledFocusUnderProjectedInitialState": installed_focus,
        "sourceSha256": SOURCE,
        "framingSha256": FRAMING,
        "archiveSha256": original.EXECUTABLE_HASH,
        "scope": {
            "nativePacketBodyReadersExecuted": True,
            "nativeDamageLookupIdsExecuted": True,
            "nativeNonRosterActorTypesRecovered": False,
            "allNativeScoreLeavesRecovered": False,
            "originalPreviousFocusRecovered": False,
            "originalMapOverridesRecovered": False,
            "nativeFullMatchWinnerRecovered": False,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("archive", "window", "framing", "output"):
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    archive, window, framing = (arg.read_bytes() for arg in (args.archive, args.window, args.framing))
    if [sha256(data).hexdigest() for data in (archive, window, framing)] != [original.EXECUTABLE_HASH, SOURCE, FRAMING]:
        raise ValueError("Expected the pinned archive and replay evidence")
    receipt = inspect(original.MachImage(archive), json.loads(window), json.loads(framing))
    with args.output.open("x", encoding="utf8") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

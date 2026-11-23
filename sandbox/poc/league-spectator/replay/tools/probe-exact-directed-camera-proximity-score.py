"""Run the original Director pair proximity scorer on pinned replay positions."""

import argparse
import json
import struct
from hashlib import sha256
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_MODE_64, Uc
from unicorn import x86_const as r

ARCHIVE = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
FRAMING = "6fc647711e19425507b5211b4624c9e0f6d410a6bcb8c7f3c2d500c10776af84"
ARENA = 0x6000000
DIRECTOR, TEAMS, STACK, STOP = (ARENA + offset for offset in (0x1000, 0x2000, 0x3FF8, 0x4000))
SUBJECT = 1073742161
SEED = 37


def inspect(image, source):
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    base = image.base
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    vm.mem_map(ARENA, 0x20000)

    def put(address, fmt, *values):
        vm.mem_write(address, struct.pack("<" + fmt, *values))

    def get(address, fmt):
        return struct.unpack("<" + fmt, vm.mem_read(address, struct.calcsize("<" + fmt)))[0]

    radius = get(base + 0x2136100, "f")
    recall_factor = get(base + 0x2135374, "f")
    friendly = get(base + 0x797F71, "i")
    enemy = get(base + 0x797F8B, "i")
    put(DIRECTOR + 0x154, "ffii", radius, radius * radius, friendly, enemy)
    put(DIRECTOR + 0x220, "f", recall_factor)
    put(base + 0x24E8590, "Q", TEAMS)
    put(TEAMS + 0x20, "4I", 0, 100, 200, 300)
    receipts = []
    actors, scores, transient = {}, {}, {}
    for frame in (source["samples"][0], source["samples"][-1]):
        roster = sorted(frame["actors"], key=lambda actor: actor["participantId"])
        if len(roster) != 10 or len({actor["participantId"] for actor in roster}) != 10:
            raise ValueError("Expected ten independently bound participants")
        for i, actor in enumerate(roster):
            participant = actor["participantId"]
            actors[participant] = address = ARENA + 0x5000 + i * 0x1000
            scores[participant] = score_node = ARENA + 0xF000 + i * 0x80
            transient[participant] = state_node = score_node + 0x1000
            put(address, "Q", base + 0x2368D08)
            put(address + 0x80, "I", participant)
            put(address + 0x15C, "B", {100: 1, 200: 2}[actor["team"]])
            put(address + 0x160, "fff", actor["x"], 0, actor["z"])
            for node in (score_node, state_node):
                put(node + 0x1C, "I", participant)
                if i < len(roster) - 1:
                    put(node + 8, "Q", node + 0x80)
        put(DIRECTOR + 0x20, "Q", next(iter(scores.values())))
        put(DIRECTOR + 0xF8, "Q", next(iter(transient.values())))

        def run_pair(other, recalled=None):
            for participant in (SUBJECT, other):
                put(scores[participant] + 0x20, "i", SEED)
                put(transient[participant] + 0x20, "B", participant == recalled)
            put(STACK, "Q", STOP)
            for register, value in (
                (r.UC_X86_REG_RDI, DIRECTOR),
                (r.UC_X86_REG_RSI, actors[SUBJECT]),
                (r.UC_X86_REG_RDX, actors[other]),
                (r.UC_X86_REG_RSP, STACK),
            ):
                vm.reg_write(register, value)
            vm.emu_start(base + 0x79D880, STOP, count=4000)
            if vm.reg_read(r.UC_X86_REG_RIP) != STOP:
                raise ValueError("Original pair scorer missed its return boundary")
            subject_score = get(scores[SUBJECT] + 0x20, "i")
            other_score = get(scores[other] + 0x20, "i")
            if subject_score != other_score:
                raise ValueError("Expected equal contribution to both score nodes")
            return subject_score - SEED

        pairs = [
            {
                "otherParticipantId": actor["participantId"],
                "otherChampion": actor["champion"],
                "inactiveRecallContribution": run_pair(actor["participantId"]),
                "otherActorRecallControl": run_pair(actor["participantId"], actor["participantId"]),
            }
            for actor in roster
            if actor["participantId"] != SUBJECT
        ]
        observed = [
            (pair["otherChampion"], pair["inactiveRecallContribution"], pair["otherActorRecallControl"])
            for pair in pairs
            if pair["inactiveRecallContribution"] or pair["otherActorRecallControl"]
        ]
        expected = (
            [("Warwick", 19, 19), ("Seraphine", 16, 16), ("Sion", 16, 16), ("Senna", 19, 19)]
            if frame["timeSeconds"] == 0
            else [("Urgot", 50, 100)]
        )
        if observed != expected:
            raise ValueError("Original pair score or Recall control changed")
        receipts.append({"timeSeconds": frame["timeSeconds"], "pairs": pairs})
    return {
        "compiledDefaults": {
            "radius": radius,
            "friendlyWeight": friendly,
            "enemyWeight": enemy,
            "enemyRecallFactor": recall_factor,
        },
        "subjectParticipantId": SUBJECT,
        "projectedInitialAccumulator": SEED,
        "samples": receipts,
        "scope": "Native pair score using recorded XZ and teams. Recall flags and score nodes are projected.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "framing", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    archive, framing = args.archive.read_bytes(), args.framing.read_bytes()
    if [sha256(data).hexdigest() for data in (archive, framing)] != [ARCHIVE, FRAMING]:
        raise ValueError("Expected pinned exact archive and replay framing evidence")
    receipt = inspect(MachImage(archive), json.loads(framing))
    receipt.update(archiveSha256=ARCHIVE, framingSha256=FRAMING)
    with args.output.open("x", encoding="utf8") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

"""Run the native missing-health score over two pinned saved replay samples."""

import argparse
import json
import struct
from hashlib import sha256
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

ARCHIVE = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
FRAMING = "6fc647711e19425507b5211b4624c9e0f6d410a6bcb8c7f3c2d500c10776af84"
HEALTH = "ccd5dcae2b74b48df2755216416557f106dcf85802131d24360ab95bb01c27b5"
ARENA = 0x6000000
DIRECTOR, NODE, ROSTER, POINTERS, TEAMS, STACK, STOP = (
    ARENA + offset for offset in (0x1000, 0x2000, 0x3000, 0x4000, 0x5000, 0x8FF8, 0x9000)
)
SUBJECT = 1073742161
SEED = 37


def inspect(image, framing, health):
    base = image.base
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    vm.mem_map(ARENA, 0x30000)

    def put(address, fmt, *values):
        vm.mem_write(address, struct.pack("<" + fmt, *values))

    def get(address, fmt):
        return struct.unpack("<" + fmt, vm.mem_read(address, struct.calcsize("<" + fmt)))[0]

    put(base + 0x24E3140, "Q", ROSTER)
    put(base + 0x24E8590, "Q", TEAMS)
    put(TEAMS + 0x20, "4I", 0, 100, 200, 300)
    put(ROSTER + 8, "QI", POINTERS, 10)
    put(DIRECTOR + 0x20, "Q", NODE)
    put(DIRECTOR + 0x1A0, "I", get(base + 0x79831A, "I"))
    put(DIRECTOR + 0x254, "f", get(base + 0x2134B30, "f"))
    put(DIRECTOR + 0x258, "f", get(base + 0x2134B38, "f"))
    put(NODE + 0x1C, "I", SUBJECT)
    query_counts = []
    vm.hook_add(
        UC_HOOK_CODE,
        lambda uc, *_: query_counts.append(uc.reg_read(r.UC_X86_REG_EAX)),
        begin=base + 0x79B7FC,
        end=base + 0x79B7FC,
    )

    def score(subject, current, maximum):
        query_counts.clear()
        put(subject + 0x920, "f", current)
        put(subject + 0x948, "f", maximum)
        put(NODE + 0x20, "i", SEED)
        for register, value in (
            (r.UC_X86_REG_RDI, DIRECTOR),
            (r.UC_X86_REG_RSI, subject),
            (r.UC_X86_REG_RSP, STACK),
        ):
            vm.reg_write(register, value)
        put(STACK, "Q", STOP)
        vm.emu_start(base + 0x79B780, STOP, count=10000)
        if vm.reg_read(r.UC_X86_REG_RIP) != STOP or len(query_counts) > 1:
            raise ValueError("Unexpected native health-score path")
        return {
            "healthScoreContribution": get(NODE + 0x20, "i") - SEED,
            "nativeNearbyEnemyCount": next(iter(query_counts), None),
        }

    subject_track = next(track for track in health["tracks"] if track["participantId"] == SUBJECT)
    samples = []
    for sample in (framing["samples"][0], framing["samples"][-1]):
        time = sample["timeSeconds"]
        roster = sample["actors"]
        if len(roster) != 10 or len({actor["participantId"] for actor in roster}) != 10:
            raise ValueError("Expected ten independently bound champion positions")
        subject = None
        enemies = []
        for index, actor in enumerate(roster):
            address = ARENA + 0xA000 + 0x1000 * index
            put(POINTERS + index * 8, "Q", address)
            put(address, "Q", base + 0x2368D08)
            put(address + 0x80, "I", actor["participantId"])
            put(address + 0x15C, "B", {100: 1, 200: 2}[actor["team"]])
            put(address + 0x160, "fff", actor["x"], 0, actor["z"])
            if actor["participantId"] == SUBJECT:
                subject = address
            elif actor["team"] == 200:
                enemies.append(address)
        if subject is None:
            raise ValueError("Missing opening candidate")
        received, current, maximum = next(point for point in reversed(subject_track["points"]) if point[0] <= time)
        case = score(subject, current, maximum)
        if time == 0 and case != {"healthScoreContribution": 0, "nativeNearbyEnemyCount": None}:
            raise ValueError("Full-health opening control did not bypass the enemy query")
        controls = None
        if time > 0:
            controls = {
                "oneHealthMissing": score(subject, maximum - 1, maximum),
                "missingMaximum": score(subject, 0, 0),
            }
            for enemy in enemies:
                put(enemy + 0x15B, "B", 2)
            controls["enemyRosterMarkedDead"] = score(subject, current, maximum)
            if case != {"healthScoreContribution": 49, "nativeNearbyEnemyCount": 1} or controls != {
                "oneHealthMissing": {"healthScoreContribution": 0, "nativeNearbyEnemyCount": None},
                "missingMaximum": {"healthScoreContribution": 50, "nativeNearbyEnemyCount": 1},
                "enemyRosterMarkedDead": {"healthScoreContribution": 24, "nativeNearbyEnemyCount": 0},
            }:
                raise ValueError("Unexpected native score or negative control")
        samples.append(
            {
                "timeSeconds": time,
                "healthAtSeconds": received,
                "health": [current, maximum],
                **case,
                "controls": controls,
            }
        )
    return samples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "framing", "health", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    archive, framing, health = (arg.read_bytes() for arg in (args.archive, args.framing, args.health))
    if [sha256(data).hexdigest() for data in (archive, framing, health)] != [ARCHIVE, FRAMING, HEALTH]:
        raise ValueError("Expected the exact archive, framing and health provenance pins")
    samples = inspect(MachImage(archive), json.loads(framing), json.loads(health))
    receipt = {
        "archiveSha256": ARCHIVE,
        "framingSha256": FRAMING,
        "healthSha256": HEALTH,
        "projectedAccumulatorSeed": SEED,
        "subject": SUBJECT,
        "samples": samples,
        "scope": (
            "Native health leaf only, with saved sampled positions and health, "
            "projected living roster, and compiled defaults."
        ),
    }
    with args.output.open("x", encoding="utf8") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

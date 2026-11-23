"""Trace original directed-camera startup eligibility through the first scorer call."""

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
ARENA = 0x6000000
WRAPPER, REJECTED, FIRST_SCORER_CALL = 0x7A64B0, 0x7A65B7, 0x79DCA7
GATES = {
    0x7A64CC: "director-enabled",
    0x7A64D9: "host-enabled",
    0x7A64FA: "host-deadline",
    0x7A6541: "replay-root-or-clock",
    0x7A654A: "replay-ready",
    0x7A655E: "clock-owner-ready",
    0x7A656E: "selected-mode",
    0x79DC79: "score-cooldown",
}


def inspect(image, actors):
    ids = [actor["participantId"] for actor in actors]
    if len(ids) != 10 or len(set(ids)) != 10:
        raise ValueError("Expected the independently bound opening roster")
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    base = image.base
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    vm.mem_map(ARENA, 0x40000)
    (
        director,
        clock_root,
        replay_options,
        replay_root,
        roster,
        clock_owner_root,
        mode,
        replay_clock,
        host_clock,
        clock_bank,
        ticks,
        stack,
    ) = (ARENA + 0x1000 * index for index in range(1, 13))
    owner = ARENA + 0x16000
    pointers = ARENA + 0x20000

    def put(address, fmt, *values):
        vm.mem_write(address, struct.pack("<" + fmt, *values))

    def get(address, fmt):
        return struct.unpack("<" + fmt, vm.mem_read(address, struct.calcsize("<" + fmt)))[0]

    for rva, address in (
        (0x24E3030, clock_root),
        (0x24E2D68, replay_options),
        (0x24E3160, clock_owner_root),
        (0x24E6680, mode),
        (0x24E3140, roster),
    ):
        put(base + rva, "Q", address)
    put(clock_root + 0x10, "Q", replay_clock)
    put(clock_root + 0x20, "Q", host_clock)
    put(replay_clock, "QB", clock_bank, 0)
    put(host_clock, "QB", clock_bank, 1)
    put(clock_bank + 0x30, "Q", ticks)
    # Native host startup writes this scale. Supply a controlled scale to
    # exercise the original accessor with distinct projected clock slots.
    put(base + 0x25E68A8, "d", 1e-9)
    put(roster + 8, "QI", pointers, len(ids))
    for index, actor in enumerate(actors):
        address = ARENA + 0x21000 + index * 0x1000
        put(pointers + index * 8, "Q", address)
        put(address + 0x80, "I", actor["participantId"])
    put(clock_owner_root + 0x18, "Q", owner)
    put(replay_options + 0x2E, "B", 1)
    trace = []

    def trace_instruction(_vm, address, *_):
        rva = address - base
        if rva in GATES or rva in (0x1610390, 0xC5EDC0, 0x79DC20):
            trace.append(rva)

    vm.hook_add(UC_HOOK_CODE, trace_instruction, begin=base + WRAPPER, end=base + REJECTED)
    for rva in (0x1610390, 0xC5EDC0, 0x79DC20, 0x79DC79):
        vm.hook_add(UC_HOOK_CODE, trace_instruction, begin=base + rva, end=base + rva)
    vm.hook_add(UC_HOOK_CODE, lambda uc, *_: uc.emu_stop(), begin=base + REJECTED, end=base + REJECTED)

    def run(control, blocked=None, clock_ticks=250_000_000):
        vm.mem_write(director, bytes(0x1000))
        trace.clear()
        put(director + 8, "I", get(base + 0x2547AC0, "I"))
        put(director + 0x111, "B", blocked != "director-enabled")
        put(director + 0x300, "B", blocked != "host-enabled")
        put(director + 0x304, "f", 0.5 if blocked == "host-deadline" else 0)
        put(director + 0x308, "f", 0.5 if blocked == "replay-clock" else 0)
        put(base + 0x25DBE30, "Q", 0 if blocked == "replay-root" else replay_root)
        put(replay_root + 0x90, "B", blocked != "replay-ready")
        put(owner + 0x200, "B", blocked != "clock-owner-ready")
        put(mode + 0x10, "I", 0 if blocked == "selected-mode" else 0x79A17BDE)
        put(ticks, "q", clock_ticks)
        put(ticks + 128, "q", clock_ticks)
        if blocked == "score-cooldown":
            put(director + 4, "f", 0.5)
        put(stack, "Q", ARENA)
        vm.reg_write(r.UC_X86_REG_RSP, stack)
        vm.reg_write(r.UC_X86_REG_RDI, director)
        vm.emu_start(base + WRAPPER, base + FIRST_SCORER_CALL, count=4000)
        expected = FIRST_SCORER_CALL if blocked is None else REJECTED
        gate = next(GATES[rva] for rva in reversed(trace) if rva in GATES)
        expected_gate = "replay-root-or-clock" if blocked in ("replay-root", "replay-clock") else blocked
        if vm.reg_read(r.UC_X86_REG_RIP) != base + expected or (blocked is not None and gate != expected_gate):
            raise ValueError(f"Unexpected startup control outcome for {control}")
        first_actor = get(vm.reg_read(r.UC_X86_REG_RSI) + 0x80, "I") if blocked is None else None
        if blocked is None and first_actor != ids[0]:
            raise ValueError("Original selector did not visit the first projected actor")
        return {
            "control": control,
            "gateRvas": [hex(rva) for rva in trace],
            "lastGate": gate,
            "reachedFirstScorerCall": expected == FIRST_SCORER_CALL,
            "firstVisitedProjectedParticipantId": first_actor,
        }

    blocked = (
        "director-enabled",
        "host-enabled",
        "host-deadline",
        "replay-clock",
        "replay-root",
        "replay-ready",
        "clock-owner-ready",
        "selected-mode",
        "score-cooldown",
    )
    return [run(name, name) for name in blocked] + [
        run("eligible-at-zero", clock_ticks=0),
        run("eligible-at-0.25"),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "framing", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    archive, framing = args.archive.read_bytes(), args.framing.read_bytes()
    if sha256(archive).hexdigest() != ARCHIVE or sha256(framing).hexdigest() != FRAMING:
        raise ValueError("Expected the pinned exact archive and saved opening-roster evidence")
    source = json.loads(framing)
    opening = source["samples"][0]
    if opening["timeSeconds"] != 0:
        raise ValueError("Expected the recorded opening roster")
    result = {
        "archiveSha256": ARCHIVE,
        "framingSha256": FRAMING,
        "identity": source["identity"],
        "controls": inspect(MachImage(archive), opening["actors"]),
        "scope": {
            "startupRuntimeObjectsAndClocksProjected": True,
            "firstActualUpdateTimeRecovered": False,
            "candidateScorerExecuted": False,
            "actualFirstWinnerRecovered": False,
        },
    }
    with args.output.open("x", encoding="utf8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

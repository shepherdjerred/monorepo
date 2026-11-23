"""Run the archived director's authored-default, horizontal centroid block."""

import argparse
import hashlib
import json
import struct
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

ARCHIVE = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
SOURCE = "6fc647711e19425507b5211b4624c9e0f6d410a6bcb8c7f3c2d500c10776af84"
ARENA = 0x6000000
DIRECTOR, ROSTER, POINTERS, TEAMS, CANARY, OUTPUT, VTABLE, STACK = (ARENA + i * 0x1000 for i in range(1, 9))


def inspect(image, source):
    u = Uc(UC_ARCH_X86, UC_MODE_64)
    u.mem_map(image.base, len(image.image))
    u.mem_write(image.base, bytes(image.image))
    u.mem_map(ARENA, 0x40000)

    def put(address, fmt, *values):
        u.mem_write(address, struct.pack("<" + fmt, *values))

    def get(address, fmt):
        return struct.unpack("<" + fmt, u.mem_read(address, struct.calcsize("<" + fmt)))

    def frame(start, end, registers):
        u.reg_write(r.UC_X86_REG_RSP, STACK)
        for key, value in registers.items():
            u.reg_write(key, value)
        stop = image.base + end
        u.emu_start(image.base + start, stop, count=20_000)
        if u.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Original framing block did not return at {end:#x}")

    def cstring(address):
        prefix = bytes(u.mem_read(address, 128))
        end = prefix.index(0)
        return prefix[:end].decode("ascii")

    defaults = {}

    def return_default(register, value_format):
        group = cstring(u.reg_read(r.UC_X86_REG_RDI))
        name = cstring(u.reg_read(r.UC_X86_REG_RSI))
        if group != "DirectedCamera" or not name.startswith("CameraLock") or name in defaults:
            raise ValueError("Original camera config looked up an unexpected field")
        bits = u.reg_read(register) & 0xFFFFFFFF
        defaults[name] = struct.unpack_from(value_format, struct.pack("<I", bits))[0]
        if register != r.UC_X86_REG_XMM0:
            u.reg_write(r.UC_X86_REG_EAX, bits)
        stack = u.reg_read(r.UC_X86_REG_RSP)
        u.reg_write(r.UC_X86_REG_RIP, get(stack, "Q")[0])
        u.reg_write(r.UC_X86_REG_RSP, stack + 8)

    hooks = []
    for start, register, value_format in [
        (0x146C0D0, r.UC_X86_REG_XMM0, "<f"),
        (0x146C000, r.UC_X86_REG_EDX, "<i"),
        (0x146BF30, r.UC_X86_REG_EDX, "<?"),
    ]:
        hooks.append(
            u.hook_add(
                UC_HOOK_CODE,
                lambda *_args, reg=register, fmt=value_format: return_default(reg, fmt),
                begin=image.base + start,
                end=image.base + start,
            )
        )
    # The original loader writes the fields, including squared distances.
    # Return the compiled defaults at the typed configuration boundary.
    frame(0x798764, 0x798A32, {r.UC_X86_REG_RBX: DIRECTOR})
    for hook in hooks:
        u.hook_del(hook)
    if len(defaults) != 20:
        raise ValueError(f"Unexpected original camera config lookup count: {len(defaults)}")

    put(image.base + 0x24DC310, "Q", CANARY)
    put(image.base + 0x24E3140, "Q", ROSTER)
    put(image.base + 0x24E8590, "Q", TEAMS)
    put(ROSTER + 8, "QI", POINTERS, 10)
    put(TEAMS + 0x20, "II", 100, 200)
    put(VTABLE + 0x2B8, "Q", image.base + 0xD6A00)
    put(VTABLE + 0x3D8, "Q", image.base + 0x186E80)
    cases = []
    for sample in source["samples"]:
        actors = sample["actors"]
        if len(actors) != 10:
            raise ValueError("Original framing probe requires a complete live roster")
        focus = None
        for index, actor in enumerate(actors):
            address = ARENA + 0xA000 + index * 0x1000
            put(POINTERS + index * 8, "Q", address)
            put(address, "Q", VTABLE)
            put(address + 0x80, "I", actor["participantId"])
            put(address + 0x15C, "B", {100: 0, 200: 1}[actor["team"]])
            # World vertical input is projected. Only X/Z are claimed.
            put(address + 0x160, "fff", actor["x"], 0, actor["z"])
            if actor["champion"] == "Renekton":
                focus = address
        if focus is None:
            raise ValueError("Missing bound Renekton actor")
        modes = []
        for high, allow_offset in ((0, 0), (1, 0), (1, 1)):
            frame(
                0x79E310,
                0x79E576,
                {
                    r.UC_X86_REG_RDI: DIRECTOR,
                    r.UC_X86_REG_RSI: focus,
                    r.UC_X86_REG_RDX: OUTPUT,
                    r.UC_X86_REG_ECX: high,
                    r.UC_X86_REG_R8D: allow_offset,
                },
            )
            x, vertical, z = get(OUTPUT, "fff")
            if vertical != 0:
                raise ValueError("Horizontal-only framing control wrote a vertical coordinate")
            modes.append(
                {
                    "highFocusedChampionWeightControl": bool(high),
                    "allowFramingOffsetControl": bool(allow_offset),
                    "admittedNeighborChampions": u.reg_read(r.UC_X86_REG_R15D),
                    "targetXZ": [x, z],
                }
            )
        cases.append(
            {
                "timeSeconds": sample["timeSeconds"],
                "positionSource": actors[0]["source"],
                "focusParticipantId": get(focus + 0x80, "I")[0],
                "focusXZ": [get(focus + 0x160, "f")[0], get(focus + 0x168, "f")[0]],
                "centroidControls": modes,
            }
        )
    return {
        "archivedExecutableSha256": ARCHIVE,
        "sourceSha256": SOURCE,
        "identity": source["identity"],
        "configDefaultReads": defaults,
        "frames": cases,
        "nativeRvas": {
            "typedDefaultFieldLoaderStart": 0x798764,
            "horizontalCentroidStart": 0x79E310,
            "neutralObjectQueryBoundary": 0x79E576,
            "cameraMotionApplication": 0x79E690,
        },
        "scope": {
            "controlledFocusAndFramingFlags": True,
            "nativeWorldHeightRecovered": False,
            "originalConfigMountAndOverridesVerified": False,
            "neutralOffsetQueryExecuted": False,
            "originalCameraMotionApplied": False,
            "nativeFullMatchCameraVerified": False,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for label in ("archive", "input", "output"):
        parser.add_argument(label, type=Path)
    args = parser.parse_args()
    archive, source = args.archive.read_bytes(), args.input.read_bytes()
    if hashlib.sha256(archive).hexdigest() != ARCHIVE or hashlib.sha256(source).hexdigest() != SOURCE:
        raise ValueError("Expected exact archive and replay-bound framing evidence")
    result = inspect(MachImage(archive), json.loads(source))
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

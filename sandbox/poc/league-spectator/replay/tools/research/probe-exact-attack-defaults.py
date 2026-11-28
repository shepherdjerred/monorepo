"""Observe the exact .8428 attack-spell name defaults before native formatting."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as registers

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image

FORMAT_PREFIX = 0x2BFE0F
FORMAT_CALL = 0x145D8D0
FORMATS = {
    0x2259479: "%sBasicAttack",
    0x2259487: "%sBasicAttack%i",
    0x2259497: "%sCritAttack",
    0x22594A4: "%sCritAttack%i",
}
ARENA = 0x10000000
ACTOR = ARENA + 0x1000
NAME = ARENA + 0x3000


def observe_defaults(image):
    engine = Uc(UC_ARCH_X86, UC_MODE_64)
    engine.mem_map(image.base, len(image.image))
    engine.mem_write(image.base, bytes(image.image))
    engine.mem_map(ARENA, 0x10000)
    initial = engine.context_save()
    observations = []

    def before_format(uc, _address, _size, _user_data):
        pointer = uc.reg_read(registers.UC_X86_REG_RDX)
        rva = pointer - image.base
        expected = FORMATS.get(rva)
        if expected is None or uc.mem_read(pointer, len(expected) + 1) != (expected.encode("ascii") + b"\0"):
            raise ValueError("Unrecognized original attack-name format")
        if uc.reg_read(registers.UC_X86_REG_RCX) != NAME:
            raise ValueError("Formatter did not receive the character name")
        observations.append(
            {
                "format": expected,
                "number": uc.reg_read(registers.UC_X86_REG_R8D) if "%i" in expected else None,
                "formatRva": rva,
            }
        )
        uc.emu_stop()

    stop = image.base + FORMAT_CALL
    engine.hook_add(UC_HOOK_CODE, before_format, begin=stop, end=stop)
    for index in range(18):
        engine.context_restore(initial)
        engine.mem_write(ARENA, bytes(0x10000))
        engine.mem_write(ACTOR + 0x40, NAME.to_bytes(8, "little"))
        engine.mem_write(NAME, b"Character\0")
        engine.reg_write(registers.UC_X86_REG_RBX, ACTOR)
        engine.reg_write(registers.UC_X86_REG_RSI, index)
        engine.reg_write(registers.UC_X86_REG_RBP, ARENA + 0x8000)
        engine.reg_write(registers.UC_X86_REG_RSP, ARENA + 0x7000)
        engine.emu_start(image.base + FORMAT_PREFIX, 0, count=2000)
        if len(observations) != index + 1:
            raise ValueError("Native attack-name selection missed the formatter")
    return dict(zip(range(64, 82), observations, strict=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    archive = args.archive.read_bytes()
    image = read_replication_image(archive, CURRENT_BUILD)
    receipt = {
        "schema": 1,
        "kind": "current-native-default-attack-names",
        "build": CURRENT_BUILD,
        "archiveSha256": hashlib.sha256(archive).hexdigest(),
        "entryRva": FORMAT_PREFIX,
        "stopRva": FORMAT_CALL,
        "defaults": observe_defaults(image),
    }
    data = (json.dumps(receipt, indent=2) + "\n").encode("utf-8")
    with args.output.open("xb") as output:
        output.write(data)
    print(hashlib.sha256(data).hexdigest())


if __name__ == "__main__":
    main()

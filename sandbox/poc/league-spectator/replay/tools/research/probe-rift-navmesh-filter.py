"""Execute the exact .8428 Map11 navmesh fade and blur parameter writers."""

import argparse
import json
import struct
import sys
from hashlib import sha256
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_MODE_64, Uc
from unicorn import x86_const as reg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image

MANAGER = 0x10000100
TEXTURE = 0x10000200
FRAME = 0x1000F000
DEFAULTS = (0x77C45C, 0x77C470)
FADE = (0x77D079, 0x77D0C0)
BLUR_X = (0x77D7AA, 0x77D7DE)
BLUR_Z = (0x77D855, 0x77D875)


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not __debug__:
        parser.error("Native proofs require Python assertions enabled")

    archive = args.client.read_bytes()
    image = read_replication_image(archive, CURRENT_BUILD)
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))
    vm.mem_map(0x10000000, 0x10000)

    def run(bounds, registers):
        for register, value in registers.items():
            vm.reg_write(register, value)
        vm.emu_start(image.base + bounds[0], image.base + bounds[1], count=128)
        if vm.reg_read(reg.UC_X86_REG_RIP) != image.base + bounds[1]:
            raise ValueError("Native filter fragment did not reach its expected boundary")

    run(DEFAULTS, {reg.UC_X86_REG_RBX: MANAGER})
    defaults = bytes(vm.mem_read(MANAGER + 0x20, 12))
    if defaults.hex() != "dee3633e0807c73ed2adba3f":
        raise ValueError("Unexpected original blur defaults")
    center, side, radius = struct.unpack("<3f", defaults)
    fades = []
    for now, last in (
        (1712.7284140625, 1198.0593232421875),
        (1712.7284140625, 1712.7284140625),
        (1712.9784140625, 1712.7284140625),
        (1714.7334140625, 1712.7284140625),
        (1712.7, 1712.7284140625),
    ):
        vm.mem_write(MANAGER + 0x18, struct.pack("<f", last))
        run(
            FADE,
            {
                reg.UC_X86_REG_RBX: MANAGER,
                reg.UC_X86_REG_RBP: FRAME,
                reg.UC_X86_REG_XMM0: int.from_bytes(struct.pack("<f", now), "little"),
            },
        )
        actual = bytes(vm.mem_read(FRAME - 0x40, 16))
        elapsed = max(0.0, f32(f32(now) - f32(last)))
        expected = struct.pack("<4f", f32(elapsed * f32(1.2)), f32(elapsed * 0.5), 0.0, 1.1)
        if actual != expected:
            raise ValueError("Original fade parameter bytes differ")
        stored_clock = struct.unpack("<f", vm.mem_read(MANAGER + 0x18, 4))[0]
        if stored_clock != min(f32(now), f32(last)):
            raise ValueError("Original fade clock reset differs")
        fades.append(
            {
                "suppliedNow": now,
                "suppliedLastUpdate": last,
                "managerLastUpdate": stored_clock,
                "parametersHex": actual.hex(),
            }
        )
    blurs = []
    for width, height in ((295, 296), (1180, 1184)):
        vm.mem_write(TEXTURE + 0x28, struct.pack("<2I", width, height))
        run(
            BLUR_X,
            {reg.UC_X86_REG_RDI: MANAGER, reg.UC_X86_REG_RDX: TEXTURE, reg.UC_X86_REG_RBP: FRAME},
        )
        horizontal = bytes(vm.mem_read(FRAME - 0x58, 16))
        run(BLUR_Z, {reg.UC_X86_REG_RBX: MANAGER, reg.UC_X86_REG_RBP: FRAME})
        vertical = bytes(vm.mem_read(FRAME - 0x48, 16))
        if horizontal != struct.pack("<4f", radius / width, 0.0, center, side):
            raise ValueError("Original horizontal blur parameter bytes differ")
        if vertical != struct.pack("<4f", 0.0, radius / height, center, side):
            raise ValueError("Original vertical blur parameter bytes differ")
        blurs.append(
            {
                "width": width,
                "height": height,
                "horizontalHex": horizontal.hex(),
                "verticalHex": vertical.hex(),
            }
        )
    retain_seconds = struct.unpack_from("<f", image.image, 0x2135374)[0]
    if retain_seconds != 2.0:
        raise ValueError("Unexpected native mask active-update duration")
    receipt = {
        "schema": 1,
        "kind": "native-rift-navmesh-filter-parameter-controls",
        "build": CURRENT_BUILD,
        "clientSha256": sha256(archive).hexdigest(),
        "nativeSlices": [
            {"startRva": a, "endRva": b, "sha256": sha256(image.image[a:b]).hexdigest()}
            for a, b in (DEFAULTS, FADE, BLUR_X, BLUR_Z)
        ],
        "blurDefaultsHex": defaults.hex(),
        "retainUpdatesUntilElapsed": retain_seconds,
        "fade": fades,
        "blur": blurs,
        "scope": "Native parameter stores with supplied clock cases and candidate texture dimensions",
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(receipt, handle, separators=(",", ":"))
        handle.write("\n")
    print(f"Compared {len(fades)} native fade cases and {len(blurs)} native blur resolutions")


if __name__ == "__main__":
    main()

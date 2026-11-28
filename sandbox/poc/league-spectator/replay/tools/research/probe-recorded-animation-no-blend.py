"""Execute exact isolated transition state updates against positive/negative controls."""

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_MODE_64, Uc
from unicorn import x86_const as x

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("archive", type=Path)
archive = parser.parse_args().archive.read_bytes()
digest = hashlib.sha256(archive).hexdigest()
assert digest == "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
image = MachImage(archive)
scratch = 0x10000000


def verify(flags, existing_force, duration):
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(image.base + 0x15BA000, 0x3000)
    vm.mem_write(image.base + 0x15BA000, bytes(image.image[0x15BA000:0x15BD000]))
    vm.mem_map(scratch, 0x4000)
    channel = scratch + 0x100
    config = scratch + 0x800
    frame = scratch + 0x2000
    for reg, value in [
        (x.UC_X86_REG_RBX, channel),
        (x.UC_X86_REG_R14, config),
        (x.UC_X86_REG_R13, flags),
        (x.UC_X86_REG_RBP, frame),
    ]:
        vm.reg_write(reg, value)
    vm.mem_write(config + 0x40, bytes([existing_force]))
    vm.emu_start(image.base + 0x15BB6C5, image.base + 0x15BB705, count=50)
    channel_flags = struct.unpack("<I", vm.mem_read(channel + 0x8C, 4))[0]
    vm.reg_write(x.UC_X86_REG_RAX, channel)
    vm.reg_write(x.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", duration))[0])
    vm.emu_start(image.base + 0x15BAFE8, image.base + 0x15BAFFA, count=20)
    first = struct.unpack("<f", vm.mem_read(channel + 0x7C, 4))[0]
    vm.reg_write(x.UC_X86_REG_R9, channel)
    vm.mem_write(frame - 0x70, struct.pack("<f", duration))
    vm.emu_start(image.base + 0x15BB0C4, image.base + 0x15BB0E4, count=20)
    second = struct.unpack("<f", vm.mem_read(channel + 0x90, 4))[0]
    forced = bool(flags & 0x20) or existing_force
    assert bool(channel_flags & 0x10) == bool(forced)
    expected = 0.0 if forced else duration
    assert first == expected and second == expected
    return {
        "requestFlags": flags,
        "channelConfigForce": bool(existing_force),
        "transitionCandidateSeconds": duration,
        "channelFlags": channel_flags,
        "transitionWrites": [first, second],
    }


output = {
    "build": "16.23.841.8428",
    "archiveSha256": digest,
    "scope": (
        "Isolated original channel flag and both transition writes; "
        "no claim about match animator/controller state, track occupancy, or native pose activation."
    ),
    "entryRvas": [0x15BB6C5, 0x15BAFE8, 0x15BB0C4],
    "cases": [verify(f, c, d) for f in [0, 16, 32, 48] for c in [0, 1] for d in [0.0, 0.25, 0.75]],
}
print(json.dumps(output, indent=2))

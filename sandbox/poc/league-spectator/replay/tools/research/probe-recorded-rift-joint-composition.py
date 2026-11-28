"""Compare the archived pose compositor with a recorded socket and controlled actor TRS.

Pipe the JSON from verify-recorded-joint-frames.mjs --emit-impact-trs to this
probe and pass the archived macOS executable as its only argument.
"""

import json
import math
import struct
import sys
from hashlib import sha256
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_MODE_64, Uc
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import (
    CURRENT_ARCHIVE_SHA256,
    CURRENT_BUILD,
    read_replication_image,
)

COMPOSITOR = 0x14C4F50
STOP = 0x10000000
STACK = STOP + 0xF008
LOCAL, ROOT, OUTPUT = (STOP + offset for offset in (0x100, 0x200, 0x300))
TRS = struct.Struct("<10f")
UNWRITTEN_SCALE = (99.0, 99.0, 99.0)
JOINT_TRS_SHA256 = "c15a5af5d3b33b54ee8c0ab79a812fd97babbd386868d5d2d668e31bcca3f21b"
JOINT_IDENTITY = {
    "build": CURRENT_BUILD,
    "protocol": "8bbfcd5af2bc92db",
    "replaySha256": "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
    "modelSha256": "1ab6e3c0a3bad71f8a944f25698b17d8c139a23295bf3165481d80c5bd98ef42",
    "clipSha256": "117a46e46f23d45514842fa2ae340cb9734a7facceaf5a2d6cbb7f02318d2e7a",
    "rigSha256": "a121736d850a56df1f95344f8bb188ab90e38e708e0628ebafe79f6560ddb10c",
    "bindingsSha256": "c370450b23be9aa4a37d0a31271fc953f793fef0c1b4545c4d3f0a0ed367e5e6",
    "time": 1719.2644140625,
    "key": 0x0AC0F283,
}


def product(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def axis_angle(axis, angle):
    sine = math.sin(angle / 2)
    return (*(coordinate * sine for coordinate in axis), math.cos(angle / 2))


def reference(local, root):
    scale = tuple(a * b for a, b in zip(local[3:6], root[3:6], strict=True))
    offset = tuple(a * b for a, b in zip(local[:3], root[3:6], strict=True))
    x, y, z, w = root[6:]
    rotated = product(product(root[6:], (*offset, 0)), (-x, -y, -z, w))[:3]
    position = tuple(a + b for a, b in zip(rotated, root[:3], strict=True))
    return (*position, *scale, *product(root[6:], local[6:]))


def execute(machine, image_base, local, root, write_scale):
    machine.mem_write(LOCAL, TRS.pack(*local))
    machine.mem_write(ROOT, TRS.pack(*root))
    machine.mem_write(OUTPUT, TRS.pack(*([99.0] * 10)))
    machine.mem_write(STACK, struct.pack("<Q", STOP))
    for register, value in (
        (r.UC_X86_REG_RDI, LOCAL),
        (r.UC_X86_REG_RSI, ROOT),
        (r.UC_X86_REG_RDX, OUTPUT),
        (r.UC_X86_REG_RSP, STACK),
        (r.UC_X86_REG_RCX, write_scale),
    ):
        machine.reg_write(register, value)
    machine.emu_start(image_base + COMPOSITOR, STOP, count=10_000)
    assert machine.reg_read(r.UC_X86_REG_RIP) == STOP
    return TRS.unpack(machine.mem_read(OUTPUT, TRS.size))


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: probe-recorded-rift-joint-composition.py <macOS executable>")
    if not __debug__:
        raise RuntimeError("The pose compositor probe requires Python assertions")
    joint = json.load(sys.stdin)
    assert {key: joint[key] for key in JOINT_IDENTITY} == JOINT_IDENTITY
    joint_trs = TRS.pack(*joint["trs"])
    assert sha256(joint_trs).hexdigest() == JOINT_TRS_SHA256
    local = TRS.unpack(joint_trs)

    archive = Path(sys.argv[1]).read_bytes()
    assert sha256(archive).hexdigest() == CURRENT_ARCHIVE_SHA256
    image = read_replication_image(archive, CURRENT_BUILD)
    machine = Uc(UC_ARCH_X86, UC_MODE_64)
    machine.mem_map(image.base, len(image.image))
    machine.mem_write(image.base, bytes(image.image))
    machine.mem_map(STOP, 0x10000)

    # Descriptor translation is a controlled input here. Rotations and scales
    # deliberately vary because the replay's live actor transform is unresolved.
    origin = (12136, 91.42977905273438, 10666)
    unit = (1, 1, 1)
    neutral = (0, 0, 0, 1)
    up = (0, 1, 0)
    controls = (
        ("identity", (0, 0, 0), unit, neutral),
        ("translated", origin, unit, neutral),
        ("yaw90", origin, unit, axis_angle(up, math.pi / 2)),
        ("yaw180", origin, unit, axis_angle(up, math.pi)),
        (
            "tiltAndScale",
            origin,
            (1.25, 0.75, 1.5),
            product(axis_angle(up, 1.1), axis_angle((1, 0, 0), 0.3)),
        ),
    )
    outputs = {}
    for name, position, scale, orientation in controls:
        root = TRS.unpack(TRS.pack(*position, *scale, *orientation))
        actual = execute(machine, image.base, local, root, 1)
        expected = reference(local, root)
        # Map coordinates have approximately one thousandth unit per float32 ULP.
        assert all(
            abs(native - reference_value) < (0.001 if index < 3 else 1e-6)
            for index, (native, reference_value) in enumerate(zip(actual, expected, strict=True))
        ), (name, actual, expected)
        assert execute(machine, image.base, local, root, 0) == (
            *actual[:3],
            *UNWRITTEN_SCALE,
            *actual[6:],
        )
        outputs[name] = {"suppliedActorTrs": root, "archive": actual, "reference": expected}
    print(
        json.dumps(
            {
                "archiveSha256": CURRENT_ARCHIVE_SHA256,
                "joint": {**JOINT_IDENTITY, "trs": local},
                "jointTrsSha256": JOINT_TRS_SHA256,
                "compositor": hex(COMPOSITOR),
                "controls": outputs,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

"""Export original 16.23 compressed animation poses from pinned offline inputs.

Run with unicorn and capstone installed. The binary contains interpreter-ready
local T/S/Q tracks sampled in ascending frame order from zero. The JSON records
fresh-cache and zero-then-seek comparisons, including quaternion sign.
"""

import argparse
import hashlib
import json
import math
import re
import struct
from pathlib import Path

import unicorn
from animation_rig_native import next_prime
from macho import MachImage
from unicorn import x86_const as r


def sha(data):
    return hashlib.sha256(data).hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
for name in ("client", "animation", "rig", "receipt", "clip"):
    parser.add_argument(f"--{name}", required=True, type=Path)
parser.add_argument("--animation-sha256", required=True, help="Expected ANM digest from the authored clip provenance")
parser.add_argument("--rig-sha256", required=True, help="Expected SKL digest from the matching model provenance")
args = parser.parse_args()
paths = {name: getattr(args, name).resolve() for name in ("client", "animation", "rig", "receipt", "clip")}
if len(set(paths.values())) != len(paths):
    parser.error("Inputs, receipt and clip require distinct paths")
if not __debug__:
    parser.error("Run the probe with assertions enabled")
if not all(re.fullmatch(r"[a-f0-9]{64}", digest) for digest in (args.animation_sha256, args.rig_sha256)):
    parser.error("Expected lowercase SHA-256 digests for the authored clip and matching rig")
client, anm, skl = (paths[name].read_bytes() for name in ("client", "animation", "rig"))
if sha(client) != "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15":
    raise ValueError("Unexpected 16.23.840.6595 universal Mac executable digest")


def validate_source(animation, skeleton):
    if not 0x80 <= len(animation) < 0x100000 or animation[:8] != b"r3d2canm":
        raise ValueError("Invalid compressed animation envelope")
    version, size = struct.unpack_from("<II", animation, 8)
    if version != 1 or size + 12 != len(animation):
        raise ValueError("Invalid compressed animation version or size")
    if not 0x40 <= len(skeleton) < 0x100000 or struct.unpack_from("<III", skeleton) != (len(skeleton), 0x22FD4FC3, 0):
        raise ValueError("Invalid skeleton envelope")
    if sha(animation) != args.animation_sha256:
        raise ValueError("Animation digest differs from supplied clip provenance")
    if sha(skeleton) != args.rig_sha256:
        raise ValueError("Skeleton digest differs from supplied rig provenance")


validate_source(anm, skl)
rejections = {}
for label, animation, skeleton in (
    ("truncatedAnimation", anm[:-1], skl),
    ("wrongCompressedVersion", anm[:8] + struct.pack("<I", 2) + anm[12:], skl),
    ("changedAnimationPayload", anm[:-1] + bytes([anm[-1] ^ 1]), skl),
    ("truncatedSkeleton", anm, skl[:-1]),
    ("changedSkeletonPayload", anm, skl[:-1] + bytes([skl[-1] ^ 1])),
):
    try:
        validate_source(animation, skeleton)
    except ValueError as error:
        rejections[label] = str(error)
    else:
        raise AssertionError(f"Malformed control admitted: {label}")

m = MachImage(client)
base = m.base
u = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
u.mem_map(base, len(m.image))
u.mem_write(base, bytes(m.image))
arena = 0x10000000
arena_size = 0x1000000
u.mem_map(arena, arena_size)
initial = u.context_save()
heap = arena + 0x10000
allocations = {}
imports = {}
blocks = set()
services = {0x14C5B20: "malloc", 0x14C5B80: "free", 0x14A2030: "malloc", 0x14A0300: "malloc", 0x14A0240: "free"}


def put(addr, fmt, *values):
    u.mem_write(addr, struct.pack("<" + fmt, *values))


def get(addr, fmt):
    return struct.unpack("<" + fmt, u.mem_read(addr, struct.calcsize("<" + fmt)))


def alloc(size, fill=0):
    global heap
    assert 0 < size < 0x100000 and heap + size < arena + arena_size
    addr = heap
    heap = (heap + size + 15) & ~15
    allocations[addr] = size
    u.mem_write(addr, bytes([fill]) * size)
    return addr


def owned(addr, size):
    assert arena <= addr <= arena + arena_size - size and size < 0x100000, (hex(addr), size)


def host(uc, address, _size, _user):
    at = address - base
    name = services.get(at) or m.imports[at]
    imports[name] = imports.get(name, 0) + 1
    a, b, n = [uc.reg_read(reg) for reg in (r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX)]
    result = a
    if name == "malloc":
        result = alloc(a, 0xA5)
    elif name == "free":
        assert not a or a in allocations, hex(a)
        result = 0
    elif name == "___bzero":
        owned(a, b)
        u.mem_write(a, bytes(b))
    elif name in ("_memcpy", "_memmove", "_memset"):
        owned(a, n)
        if name != "_memset":
            owned(b, n)
        payload = bytes([b & 255]) * n if name == "_memset" else bytes(u.mem_read(b, n))
        u.mem_write(a, payload)
    elif name == "__ZNSt3__112__next_primeEm":
        result = next_prime(a)
    elif name == "_strlen":
        owned(a, 256)
        result = bytes(u.mem_read(a, 256)).index(0)
    else:
        raise ValueError(f"Unexpected native host boundary {at:#x} {name}")
    sp = uc.reg_read(r.UC_X86_REG_RSP)
    uc.reg_write(r.UC_X86_REG_RAX, result)
    uc.reg_write(r.UC_X86_REG_RSP, sp + 8)
    uc.reg_write(r.UC_X86_REG_RIP, get(sp, "Q")[0])


def capture_block(uc, address, size, _user):
    at = address - base
    if at not in services and at not in m.imports:
        assert bytes(uc.mem_read(address, size)) == m.image[at : at + size]
        blocks.add((at, size))


def call(entry, *args, end=None, time=None):
    u.context_restore(initial)
    stop = base + end if end is not None else arena
    stack = arena + 0x8008
    put(stack, "Q", arena)
    u.reg_write(r.UC_X86_REG_RSP, stack)
    for reg, value in zip((r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX), args, strict=False):
        u.reg_write(reg, value)
    if time is not None:
        u.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack("<f", time), "little"))
    if end is not None:
        u.ctl_remove_cache(base + entry, stop)
    u.emu_start(base + entry, stop, count=5_000_000)
    assert u.reg_read(r.UC_X86_REG_RIP) == stop, f"Instruction bound at {entry:#x}"
    return u.reg_read(r.UC_X86_REG_AL)


def data(raw):
    dst = alloc(len(raw))
    u.mem_write(dst, raw)
    return dst


def scalar_result():
    return struct.unpack("<f", struct.pack("<I", u.reg_read(r.UC_X86_REG_XMM0) & 0xFFFFFFFF))[0]


def export_clip(samples, mapped, joint_names, fps, frames, duration):
    poses = [bytes.fromhex(sample["localPosesHex"]) for sample in samples[:frames]]
    payload = bytearray()
    tracks = []
    for joint, name in enumerate(joint_names):
        if mapped[joint] == -1:
            continue
        for channel, first, width in (("position", 0, 3), ("scale", 3, 3), ("quaternion", 6, 4)):
            offset = joint * 40 + first * 4
            values = [pose[offset : offset + width * 4] for pose in poses]
            if all(value == values[0] for value in values):
                values = values[:1]
            tracks.append(
                {
                    "jointId": joint,
                    "bone": name,
                    "channel": channel,
                    "width": width,
                    "count": len(values),
                    "offset": len(payload),
                }
            )
            payload.extend(b"".join(values))
    header = json.dumps(
        {"schema": 1, "duration": duration, "fps": fps, "frames": frames, "tracks": tracks}, separators=(",", ":")
    ).encode()
    encoded = struct.pack("<I", len(header)) + header + payload
    output = paths["clip"]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encoded)
    return {
        "file": output.name,
        "sha256": sha(encoded),
        "frames": frames,
        "fps": fps,
        "duration": duration,
        "tracks": len(tracks),
        "bytes": len(encoded),
    }


for at in {*services, *m.imports}:
    u.hook_add(unicorn.UC_HOOK_CODE, host, begin=base + at, end=base + at)
u.hook_add(unicorn.UC_HOOK_BLOCK, capture_block, begin=base, end=base + len(m.image) - 1)
canary = alloc(8)
put(canary, "Q", 0x7766554433221100)
assert m.data_imports[0x24DC310] == "___stack_chk_guard"
put(base + 0x24DC310, "Q", canary)

phase = "mathematics-initializer"
result = {
    "schema": 1,
    "kind": "exact-original-compressed-animation-pose-probe",
    "build": "16.23.840.6595",
    "macExecutableSha256": sha(client),
    "macX86SliceSha256": sha(m.binary),
    "sourceAnmSha256": sha(anm),
    "sourceRigSha256": sha(skl),
    "samples": [],
    "malformedInputControlsRejectedBeforeEmulation": rejections,
    "originalEntries": {
        "mathInitializer": [0x14D501F, 0x14D5266],
        "nullOffsetInitializer": [0x160002E, 0x1600038],
        "rigConstructor": 0x15D6910,
        "resourceConstructor": 0x15D3660,
        "rigBinding": 0x15D5E20,
        "cacheConstructor": [0x15AA2D8, 0x15AA2F9],
        "poseConstructor": 0x15DF4E0,
        "poseEvaluator": 0x15D38B0,
    },
    "originalPoseEvaluationExecuted": False,
    "originalReplayDispatchExecuted": False,
    "nativeSpectatorAdmitted": False,
}
try:
    call(0x14D501F, end=0x14D5266)
    call(0x160002E, end=0x1600038)
    assert get(base + 0x25A2ABC, "I") == (0xFFFFFFFF,)
    phase = "rig-construction"
    rig = alloc(0x98)
    link = data(struct.pack("<QQ", 0, data(skl)))
    call(0x15D6910, rig, link)
    joint_count = struct.unpack_from("<H", skl, 14)[0]
    assert joint_count == get(rig + 0x30, "I")[0]
    rows = get(rig + 0x28, "Q")[0]
    joint_names = []
    for idx in range(joint_count):
        row = rows + idx * 0x70
        assert get(row, "H")[0] == idx
        name, length = get(row + 8, "QI")
        joint_names.append(bytes(u.mem_read(name, length)).decode("ascii"))
    result["jointNames"] = joint_names
    result["bindLocalPosesHex"] = [bytes(u.mem_read(rows + i * 0x70 + 0x20, 40)).hex() for i in range(joint_count)]
    phase = "resource-construction"
    resource = alloc(0x80)
    guard = b"\xa5" * 16
    u.mem_write(resource + 0x6C, guard)
    call(0x15D3660, resource, data(anm) + 12)
    assert get(resource, "Q")[0] == base + 0x2456A08
    assert bytes(u.mem_read(resource + 0x6C, 16)) == guard
    assert bytes(u.mem_read(get(resource + 8, "Q")[0], len(anm) - 0x80)) == anm[0x80:]
    call(0x15E2660, resource)
    tracks = u.reg_read(r.UC_X86_REG_EAX)
    call(0x15E2670, resource)
    fps = scalar_result()
    call(0x15E2680, resource)
    duration = scalar_result()
    call(0x15E2690, resource)
    frames = u.reg_read(r.UC_X86_REG_EAX)
    assert 0 < tracks <= joint_count
    assert math.isfinite(fps) and fps > 0 and math.isfinite(duration) and duration > 0
    assert 1 < frames <= 10000
    result.update(resourceTrackCount=tracks, resourceFps=fps, resourceFrames=frames, resourceDuration=duration)
    phase = "rig-binding"
    indices = alloc(joint_count * 4)
    mapping = data(struct.pack("<QII", indices, joint_count, joint_count))
    assert call(0x15D5E20, resource, rig, mapping)
    mapped = get(indices, "i" * joint_count)
    assert all(-1 <= idx < tracks for idx in mapped) and len(set(mapped) - {-1}) == tracks
    result["trackIndices"] = mapped
    phase = "cache-construction"

    def new_cache():
        owner = alloc(0x80)
        u.mem_write(owner + 0x70, guard)
        call(0x15AA2D8, owner, end=0x15AA2F9)
        cache = owner + 0x58
        assert get(cache, "fIQII") == (-1, 0, 0, 0, 0)
        return cache

    cache = new_cache()
    phase = "pose-evaluation"

    def evaluate(time, cache):
        pose = alloc(0x210)
        u.mem_write(pose + 0x200, guard)
        call(0x15DF4E0, pose, rig)
        assert call(0x15D38B0, resource, pose, mapping, cache, time=time)
        out = get(pose + 8, "Q")[0]
        assert allocations[out] >= joint_count * 40
        raw = bytes(u.mem_read(out, joint_count * 40))
        assert all(math.isfinite(f) for f in struct.unpack("<" + "f" * joint_count * 10, raw))
        assert bytes(u.mem_read(pose + 0x200, 16)) == guard
        assert bytes(u.mem_read(cache + 24, 16)) == guard
        return raw

    times = [idx / fps for idx in range(frames)] + [0, 0.5 / fps]
    for time in times:
        raw = evaluate(time, cache)
        if not result["samples"]:
            states = get(cache + 8, "Q")[0]
            assert allocations[states] == tracks * 0xB8
            result["cacheAtZero"] = bytes(u.mem_read(states, tracks * 0xB8)).hex()
        result["samples"].append(
            {"time": struct.unpack("<f", struct.pack("<f", time))[0], "localPosesHex": raw.hex(), "finite": True}
        )
    samples = result["samples"]
    assert samples[0]["localPosesHex"] == samples[frames]["localPosesHex"]
    result["distinctAuthoredPoses"] = len({sample["localPosesHex"] for sample in samples[:frames]})
    assert result["distinctAuthoredPoses"] > 1
    phase = "fresh-cache-controls"
    controls = {}
    for label, idx in (("first", 0), ("halfFrame", frames + 1), ("middle", frames // 2), ("last", frames - 1)):
        expected = bytes.fromhex(samples[idx]["localPosesHex"])
        direct = evaluate(times[idx], new_cache())
        primed = new_cache()
        evaluate(0, primed)
        zero_then_seek = evaluate(times[idx], primed)
        comparison = {}
        for approach, actual in (("directFreshCache", direct), ("zeroThenSeek", zero_then_seek)):
            rows = list(zip(struct.iter_unpack("<10f", actual), struct.iter_unpack("<10f", expected), strict=True))
            differences = [[abs(a - b) for a, b in zip(row, baseline, strict=True)] for row, baseline in rows]
            rotation_error = max(
                min(max(delta[6:]), max(abs(a + b) for a, b in zip(row[6:], baseline[6:], strict=True)))
                for delta, (row, baseline) in zip(differences, rows, strict=True)
            )
            comparison[approach] = {
                "matchesSequentialPose": expected == actual,
                "poseSha256": sha(actual),
                "differentJoints": sum(actual[i : i + 40] != expected[i : i + 40] for i in range(0, len(actual), 40)),
                "maxAbsolutePositionDelta": max(max(row[:3]) for row in differences),
                "maxAbsoluteScaleDelta": max(max(row[3:6]) for row in differences),
                "maxAbsoluteQuaternionComponentDelta": max(max(row[6:]) for row in differences),
                "maxSignAlignedQuaternionComponentDelta": rotation_error,
            }
        controls[label] = comparison
    result["freshCacheControls"] = controls
    phase = "clip-export"
    result["nativeClip"] = export_clip(samples, mapped, joint_names, fps, frames, duration)
    result["nativeClip"]["samplingHistory"] = f"Sequential frame times from zero at {fps:g} fps"
    result["nativeClip"]["arbitrarySeekParityVerified"] = all(
        outcome["matchesSequentialPose"] for control in controls.values() for outcome in control.values()
    )
    result["nativeClip"]["testedSeekTransformParityModuloQuaternionSign"] = all(
        outcome["maxAbsolutePositionDelta"]
        == outcome["maxAbsoluteScaleDelta"]
        == outcome["maxSignAlignedQuaternionComponentDelta"]
        == 0
        for control in controls.values()
        for outcome in control.values()
    )
    result["originalPoseEvaluationExecuted"] = True
    result["rewindMatchesZero"] = True
    result["boundary"] = None
except Exception as error:
    ip = u.reg_read(r.UC_X86_REG_RIP)
    result["boundary"] = {"phase": phase, "error": repr(error), "instructionRva": hex(ip - base)}
    raise
finally:
    result["hostServices"] = imports
    result["allocatorServiceRvas"] = {hex(addr): name for addr, name in services.items()}
    result["sources"] = {
        name: sha(Path(__file__).with_name(name).read_bytes())
        for name in (Path(__file__).name, "macho.py", "animation_rig_native.py", "vfx_spawn_native.py")
    }
    result["emulatorVersion"] = unicorn.__version__
    result["originalBlocks"] = [
        {"rva": at, "size": size, "sha256": sha(m.image[at : at + size])} for at, size in sorted(blocks)
    ]
    output = paths["receipt"]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(output),
                "samples": len(result["samples"]),
                "boundary": result.get("boundary"),
                "host": imports,
            }
        )
    )

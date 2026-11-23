"""Run original replay display predicates and jump-back scalar/clock policy.

Pause mode and source-reader bounds are explicit controls. The original replay
client's event notifications, archive-backed startup and widget owner lookup
are not substituted or reported executed.
"""
import argparse
import hashlib
import inspect
import importlib.util
import json
import struct
import sys
from pathlib import Path

from unicorn import x86_const as r
from ui_manager_native import NativeUiManager

runtime_path = Path(__file__).with_name("probe-recorded-hero-creation.py")
spec = importlib.util.spec_from_file_location("native_ui_display_policy_platform", runtime_path)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


class NativeReplayDisplayPolicyControl(runtime.Control):
    initialize_layout_constants = NativeUiManager.initialize_layout_constants


def bits32(value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


def bits64(value):
    return struct.unpack("<Q", struct.pack("<d", value))[0]


def scalar(n, register, encoding):
    length = struct.calcsize(encoding)
    return struct.unpack(encoding, int(n.u.reg_read(register)).to_bytes(16, "little")[:length])[0]


parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
source_paths = {Path(__file__), runtime_path, Path(inspect.getfile(NativeUiManager)),
    *[Path(inspect.getfile(cls)) for cls in NativeReplayDisplayPolicyControl.__mro__ if cls is not object]}
sources = {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(source_paths)}
n = NativeReplayDisplayPolicyControl(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
n.clock_inputs = {"numer": 1, "denom": 1, "ticks": 1_000_000_000}
n.configure_random_device_inputs("host-os-entropy")
boundary, pause_cases, seek_cases = None, [], []
phase = "original-clock-and-pause-construction"
try:
    n.call(0x665BAB, {}, end=0x665BC7)
    clock = n.q(n.base + 0x246D000)
    if n.allocations.get(clock) != 0x60:
        raise ValueError("Original clock-service owner required")
    n.call(0x66D6C0, {})
    pause = n.q(n.base + 0x2472360)
    if n.allocations.get(pause) != 0x140:
        raise ValueError("Original pause owner required")
    pause_defaults = bytes(n.u.mem_read(pause, 0x140))
    phase = "original-replay-controls-construction"
    n.call(0xF0CAC0, {})
    controller = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.allocations.get(controller) != 0x7E8:
        raise ValueError("Original replay-controls owner required")
    phase = "original-play-selected-predicate"
    for mode in [0, 1, 2, 255]:
        for cached in [0, 1]:
            # Explicit byte controls on original constructed owners, not an
            # assertion that arbitrary replay runtime modes are admitted.
            n.put(pause + 9, "B", mode)
            n.put(controller + 0x7C9, "B", cached)
            n.call(0xF06129, {r.UC_X86_REG_RBX: controller}, end=0xF06143)
            raw = n.u.reg_read(r.UC_X86_REG_R12) & 255
            nonzero = n.u.reg_read(r.UC_X86_REG_R15) & 255
            needs_update = not bool(n.u.reg_read(r.UC_X86_REG_EFLAGS) & 0x40)
            # Bound the external cached widget lookup honestly. The source
            # booleanization then inverse/argument setup is executed unchanged.
            n.call(0xF06180, {r.UC_X86_REG_R12: raw}, end=0xF06187)
            booleanized = n.u.reg_read(r.UC_X86_REG_R12)
            n.call(0xF0618F, {r.UC_X86_REG_R12: booleanized}, end=0xF06197)
            selected = n.u.reg_read(r.UC_X86_REG_RSI)
            if raw != mode or nonzero != int(mode != 0) or selected != int(mode == 0) or needs_update != (nonzero != cached):
                raise ValueError("Original play-selection/dirty predicate differs")
            pause_cases.append({"controlledPauseModeByte": mode, "controlledCachedModeBoolean": cached,
                "sourceModeBoolean": nonzero, "sourceNeedsWidgetUpdate": needs_update,
                "sourceSelectedArgument": selected})
    n.u.mem_write(pause, pause_defaults)
    phase = "original-clock-jumpback-and-clamp"
    timer = n.q(clock + 0x10)
    if not n.library_pointer(timer, 16):
        raise ValueError("Original clock owner does not own its source timer")
    frame = 0x10030000
    for current, lower, upper in [(0, 0, 120), (5, 0, 120), (15, 0, 120),
            (15.000001, 0, 120), (79.8, 0, 120), (3023.2, 0, 3023.2),
            (200, 10, 100), (10, 10, 10), (-0.0, -0.0, 120)]:
        n.call(0x15ED7E0, {r.UC_X86_REG_RDI: timer, r.UC_X86_REG_XMM0: bits64(current)})
        n.call(0x15ED8E0, {r.UC_X86_REG_RDI: timer})
        current_f32 = scalar(n, r.UC_X86_REG_XMM0, "<f")
        clock_value = n.u.reg_read(r.UC_X86_REG_XMM0)
        n.call(0xF06CBB, {r.UC_X86_REG_XMM0: clock_value}, end=0xF06CC3)
        requested = scalar(n, r.UC_X86_REG_XMM0, "<f")
        n.put(frame - 0x20, "I", bits32(requested))
        n.put(frame - 0x40, "4I", bits32(lower), 0, 0, 0)
        n.call(0x77328D, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_XMM0: bits32(upper)}, end=0x7732B2)
        result = scalar(n, r.UC_X86_REG_XMM0, "<d")
        if not lower <= result <= upper:
            raise ValueError("Original clamped seek escaped its supplied source bounds")
        seek_cases.append({"controlledClockSeconds": current, "controlledSourceBoundsF32": [lower, upper],
            "sourceClockF32": current_f32, "sourceJumpBackF32": requested,
            "sourceClampedDouble": result, "sourceClampedDoubleHex": struct.pack("<d", result).hex()})
    phase = "complete"
except Exception as error:
    boundary = {"phase": phase, "kind": type(error).__name__, "message": str(error),
        "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
for path, digest in sources.items():
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
        raise ValueError("Replay display-policy source changed during execution: " + path)
report = {"schema": 1, "kind": "original-replay-display-policy-controls",
    "imageSha256": hashlib.sha256(n.image).hexdigest(), "boundary": boundary,
    "pauseCases": pause_cases, "seekCases": seek_cases, "originalBlocks": list(n.blocks.values()),
    "sources": sources,
    "platformClockInputs": n.clock_inputs, "clockCalls": n.clock_calls,
    "clientProcessEntropyCalls": n.random_device_calls,
    "scope": "Original clock/pause/replay-controls constructors; original play-selection/dirty predicates and original source-clock setter/getter, -15f addition and reader-bound clamp; pause bytes/reader bounds explicit, external widget lookup/archive-backed replay-client event services remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "phase": phase, "boundary": boundary,
    "pauseCases": len(pause_cases), "seekCases": len(seek_cases)}))
if boundary:
    raise SystemExit(1)

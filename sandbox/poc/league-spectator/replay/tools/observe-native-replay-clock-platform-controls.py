"""Construct original replay UI owners with existing explicit platform ports.

Clock samples/timebase are controlled ABI inputs. Cooperative threads own actual
runnable native contexts but are never reported executed or ready at creation.
"""
import argparse
import hashlib
import inspect
import importlib.util
import json
import sys
from pathlib import Path

from unicorn import x86_const as r
from ui_manager_native import NativeUiManager


runtime_path = Path(__file__).with_name("probe-recorded-hero-creation.py")
spec = importlib.util.spec_from_file_location("native_ui_recorded_platform_dependencies", runtime_path)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


class NativeReplayUiClockControl(runtime.Control):
    # Preserve the recorded platform composition and its required pristine-cache
    # position. Only reuse the exact original initialization entry, not a second
    # allocator/import chain inserted between that cache and NativeSpawn.
    initialize_layout_constants = NativeUiManager.initialize_layout_constants


parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
observations = []
for clock in [{"numer": 1, "denom": 1, "ticks": 1_000_000_000},
              {"numer": 125, "denom": 3, "ticks": 24_000_000}]:
    row = {"controlledClockInputs": clock, "owners": [], "boundary": None}
    n = None
    phase = "platform-and-type-provider-initialization"
    try:
        n = NativeReplayUiClockControl(args.assets / "decoder-16.21-macos", args.client)
        n.initialize_layout_constants()
        n.clock_inputs = clock
        row["clientProcessEntropy"] = n.configure_random_device_inputs("host-os-entropy")
        for name, entry, end, global_at, expected_size in [
            ("clock-service-owner", 0x665BAB, 0x665BC7, 0x246D000, 0x60),
            ("pause-owner", 0x66D6C0, None, 0x2472360, 0x140),
            ("controller-context", 0x6FF453, 0x6FF46F, 0x2470B70, 0x640),
        ]:
            phase = name
            n.call(entry, {}, end=end)
            owner = n.q(n.base + global_at)
            if n.allocations.get(owner) != expected_size:
                raise ValueError("Original startup owner/global allocation differs")
            row["owners"].append({"nameHint": name, "ownerBytes": expected_size,
                "defaultsHex": bytes(n.u.mem_read(owner, expected_size)).hex()})
        phase = "complete"
    except Exception as error:
        row["boundary"] = {"phase": phase, "kind": type(error).__name__, "message": str(error),
            "rva": None if n is None else n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    if n is not None:
        row.update(clockCalls=n.clock_calls, cooperativeThreads=[{
            "startRva": state["startRva"], "runs": state["runs"], "completed": state["completed"]}
            for state in n.cooperative_threads.values()], originalBlocks=list(n.blocks.values()),
            imageSha256=hashlib.sha256(n.image).hexdigest())
        row["clientProcessEntropyCalls"] = n.random_device_calls
    observations.append(row)
sources = {Path(__file__), runtime_path, Path(inspect.getfile(NativeUiManager)), *[Path(inspect.getfile(cls)) for cls in NativeReplayUiClockControl.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-replay-ui-clock-platform-controls", "observations": observations,
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Original clock/pause/context startup with explicit existing platform clock ABI ports and owned cooperative threads; no fabricated game flags, executed worker readiness or live native HUD admission"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "observations": [{"clock": row["controlledClockInputs"],
    "owners": [owner["nameHint"] for owner in row["owners"]], "boundary": row["boundary"],
    "clockCalls": len(row.get("clockCalls", [])), "cooperativeThreads": row.get("cooperativeThreads", [])} for row in observations]}))
if any(row["boundary"] for row in observations):
    raise SystemExit(1)

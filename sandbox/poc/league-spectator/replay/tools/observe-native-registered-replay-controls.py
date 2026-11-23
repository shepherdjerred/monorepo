"""Observe original replay-control services after signed archive bootstrap.

The existing bootstrap driver is unchanged. A tool-only before-close observer
runs original consumers with their actual constructor state and guards intact;
no readiness flags, cached widget pointers or native return values are supplied.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import struct
import sys
from pathlib import Path

from unicorn import x86_const as r

bootstrap_path = Path(__file__).with_name("probe-archived-replay-ui-bootstrap.py")
spec = importlib.util.spec_from_file_location("registered_replay_controls_bootstrap", bootstrap_path)
bootstrap = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bootstrap
spec.loader.exec_module(bootstrap)
observations = {"cases": [], "boundary": None}


def original_state(n, controls, context, client, pause, clock):
    timer = n.q(clock + 0x28)
    n.call(0x15ED7C0, {r.UC_X86_REG_RDI: timer})
    rate = struct.unpack("<d", n.u.reg_read(r.UC_X86_REG_XMM0).to_bytes(16, "little")[:8])[0]
    if not math.isfinite(rate):
        raise ValueError("Original replay clock rate is nonfinite")
    return {"pauseModeByte": n.u.mem_read(pause + 9, 1)[0],
        "rateIndexByte": n.u.mem_read(controls + 0x7CD, 1)[0], "clockRateF64": rate,
        "replayClientByte08": n.u.mem_read(client + 8, 1)[0],
        "replayClientByte88": n.u.mem_read(client + 0x88, 1)[0],
        "replayClientByte89": n.u.mem_read(client + 0x89, 1)[0],
        "replayClientBytes68": bytes(n.u.mem_read(client + 0x68, 8)).hex(),
        "cachedRateWidgetPointerPresent": bool(n.q(controls + 0x738)),
        "originalControllerStillPublished": n.q(n.base + 0x2470B70) == context}


def observe(n):
    phase = "complete-guarded-bootstrap-required"
    try:
        context, clock, pause = [n.q(n.base + offset) for offset in [0x2470B70, 0x246D000, 0x2472360]]
        if (n.allocations.get(context) != 0x640 or n.allocations.get(clock) != 0x60
                or n.allocations.get(pause) != 0x140
                or len(getattr(n, "local_controller_log_accesses", [])) != 3):
            raise ValueError("Complete original constructor and three log-queue guard controls required")
        client = n.q(context + 0x3E8)
        if not n.library_pointer(client, 0xF0):
            raise ValueError("Original constructed context does not own its replay client")
        phase = "original-control-construction-and-rate-label-initialization"
        n.call(0xF0CAC0, {})
        controls = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(controls) != 0x7E8:
            raise ValueError("Original replay-controls allocation changed")
        n.call(0xF0F47B, {}, end=0xF0F517)
        observations["constructed"] = {"contextBytes": 0x640,
            "replayClientOwnedBytes": n.allocations.get(client), "controlsBytes": 0x7E8,
            "initialState": original_state(n, controls, context, client, pause, clock)}
        for index, name in [(1, "Play"), (2, "SpeedUp"), (3, "SpeedDown"), (4, "SkipBack")]:
            phase = "original-action:" + name
            row = {"actionIndex": index, "nameHint": name,
                "before": original_state(n, controls, context, client, pause, clock)}
            observations["cases"].append(row)
            n.call(0xF06BC0, {r.UC_X86_REG_RDI: controls, r.UC_X86_REG_RSI: index})
            row["after"] = original_state(n, controls, context, client, pause, clock)
        phase = "complete"
    except Exception as error:
        observations["boundary"] = {"phase": phase, "kind": type(error).__name__, "message": str(error),
            "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
            "registers": {name: n.u.reg_read(getattr(r, "UC_X86_REG_" + name.upper()))
                for name in ["rax", "rbx", "rcx", "rdx", "rdi", "rsi", "rbp", "rsp"]}}
    observations["logQueueAccessesAfterControls"] = list(getattr(n, "local_controller_log_accesses", []))
    observations["phase"] = phase


class ObservedControl(bootstrap.NativeArchivedReplayUiControl):
    def close_files(self):
        # The original driver invokes this only after its complete bootstrap and
        # negative guard controls. Keep file ownership live during observation,
        # then perform its ordinary cleanup even if an original consumer fails.
        if not getattr(self, "registered_controls_observed", False):
            self.registered_controls_observed = True
            observe(self)
        return super().close_files()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["assets", "client", "installation", "fixture_cache", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    startup = output.with_name(output.stem + "-bootstrap.json")
    for root in [args.assets, args.client.parent, args.installation, args.fixture_cache]:
        if output.is_relative_to(root.resolve()):
            raise ValueError("Observer receipt must stay outside every retained input root")
    inputs = {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in [Path(__file__), bootstrap_path]}
    bootstrap.NativeArchivedReplayUiControl = ObservedControl
    saved = sys.argv
    try:
        sys.argv = [str(bootstrap_path), str(args.assets), str(args.client),
            str(args.installation), str(args.fixture_cache), str(startup)]
        bootstrap.main()
    finally:
        sys.argv = saved
    for path, digest in inputs.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
            raise ValueError("Registered UI observer source changed during execution")
    encoded = startup.read_bytes()
    receipt = json.loads(encoded)
    if receipt["boundary"] is not None:
        raise ValueError("Original archive/controller bootstrap did not complete")
    report = {"schema": 1, "kind": "original-registered-replay-control-observations",
        "imageSha256": receipt["imageSha256"], "bootstrapReceipt": str(startup),
        "bootstrapReceiptSha256": hashlib.sha256(encoded).hexdigest(), "sources": inputs,
        **observations,
        "scope": "Complete original action consumers on the actual signed-archive/controller constructor state; no supplied native readiness flags or cached widget pointers; guarded no-op and unresolved presentation services remain explicit, native HUD/live replay admission is not claimed"}
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "phase": observations["phase"],
        "cases": len(observations["cases"]), "boundary": observations["boundary"]}))
    if observations["boundary"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

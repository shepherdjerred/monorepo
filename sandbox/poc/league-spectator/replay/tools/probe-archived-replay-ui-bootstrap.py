"""Bootstrap the original replay UI dependencies from exact archived files.

All input roots are read-only. The only output is the explicitly named receipt;
no retained AI fixture, installed client or old research cache is rewritten.
"""
import argparse
import hashlib
import importlib.util
import inspect
import json
import mmap
import sys
from pathlib import Path

from unicorn import x86_const as r
from archive_subchunks_native import load_installed_subchunks
from installed_resource_archive_native import register_resource_archive
from local_controller_native import initialize_local_controller, CONSTRUCTOR_WITHOUT_LOG_WORKERS
from process_arguments_native import initialize_product_configuration
from ui_manager_native import NativeUiManager

runtime_path = Path(__file__).with_name("probe-recorded-hero-creation.py")
spec = importlib.util.spec_from_file_location("archived_replay_ui_platform_dependencies", runtime_path)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


def sha(value):
    return hashlib.sha256(value).hexdigest()


class NativeArchivedReplayUiControl(runtime.Control):
    initialize_layout_constants = NativeUiManager.initialize_layout_constants


class ReadOnlyInputs:
    def __init__(self, native, cache):
        self.native = native
        self.cache = cache
        self.inputs = {}
        self.maps = {}

    def raw(self, path):
        path = Path(path).resolve(strict=True)
        if path not in self.maps:
            # A complete signed archive can exceed1GiB. Map its original bytes
            # read-only rather than retaining another Python bytearray copy.
            if path.stat().st_size > 8 * 1024 * 1024:
                with path.open("rb") as source:
                    self.maps[path] = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
            else:
                self.maps[path] = path.read_bytes()
            self.inputs[str(path)] = sha(self.maps[path])
        return self.maps[path]

    def verify(self):
        for path, expected in self.inputs.items():
            with Path(path).open("rb") as source:
                actual = hashlib.file_digest(source, "sha256").hexdigest()
            if actual != expected:
                raise ValueError("Archived input changed during native execution: " + path)

    def close(self):
        for value in self.maps.values():
            if isinstance(value, mmap.mmap):
                value.close()
        self.maps.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["assets", "client", "installation", "fixture_cache", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    args.assets = args.assets.resolve(strict=True)
    args.client = args.client.resolve(strict=True)
    args.installation = args.installation.resolve(strict=True)
    args.fixture_cache = args.fixture_cache.resolve(strict=True)
    args.output = args.output.resolve()
    if any(args.output.is_relative_to(root) for root in [args.assets, args.client.parent, args.installation, args.fixture_cache]):
        raise ValueError("Receipt must stay outside every retained input root")
    tools = Path(__file__).resolve().parent
    # Capture the actually imported local Python source closure before native
    # execution; validate it again before publishing the receipt.
    source_paths = {Path(__file__).resolve()}
    for module in list(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if filename is not None:
            path = Path(filename).resolve()
            if path.is_relative_to(tools) and path.suffix == ".py":
                source_paths.add(path)
    sources = {str(path): sha(path.read_bytes()) for path in sorted(source_paths)}
    n = NativeArchivedReplayUiControl(args.assets / "decoder-16.21-macos", args.client)
    fixture = ReadOnlyInputs(n, args.fixture_cache)
    setup, boundary, phase = {}, None, "exact-archived-inputs"
    try:
        exe = args.installation / "Game/League of Legends.exe"
        if sha(fixture.raw(exe)) != n.profile["windowsClientSha256"]:
            raise ValueError("Exact matching archived Windows client required")
        fixture.raw(args.assets / "decoder-16.21-macos/profile.json")
        fixture.raw(args.assets / "decoder-16.21-macos/image.bin")
        fixture.raw(args.client)
        phase = "original-platform-initialization"
        n.initialize_layout_constants()
        # Controlled platform clock is explicit; it is not a replay timestamp.
        n.clock_inputs = {"numer": 1, "denom": 1, "ticks": 1_000_000_000}
        setup["platformClockInputs"] = n.clock_inputs
        setup["looseFiles"] = n.configure_client_loose_files(args.installation / "Game")
        setup["clientProcessEntropy"] = n.configure_random_device_inputs("host-os-entropy")
        setup["machSemaphorePlatform"] = n.initialize_mach_semaphore_platform()
        setup["arena"] = n.initialize_asset_arena(64)
        setup["audio"] = n.initialize_audio_facade()
        setup["ui"] = n.initialize_ui_data_prefix()
        setup["product"] = initialize_product_configuration(n, "LoL")
        phase = "original-clock-and-pause-owners"
        for name, entry, end, global_at, size in [
            ("clockService", 0x665BAB, 0x665BC7, 0x246D000, 0x60),
            ("pauseOwner", 0x66D6C0, None, 0x2472360, 0x140),
        ]:
            n.call(entry, {}, end=end)
            owner = n.q(n.base + global_at)
            if n.allocations.get(owner) != size:
                raise ValueError("Original replay UI dependency owner changed: " + name)
            setup[name] = {"entryRva": entry, "endRva": end, "globalRva": global_at,
                "ownerBytes": size, "defaultsHex": bytes(n.u.mem_read(owner, size)).hex()}
        setup["archives"] = []
        for name in ["DATA.wad.client", "Global.wad.client", "Bootstrap.windows.wad.client"]:
            phase = "signed-archive:" + name
            archive = register_resource_archive(fixture, args.installation, name)
            path = Path(archive["path"])
            phase = "original-subchunks:" + name
            archive["subchunks"] = load_installed_subchunks(fixture, args.installation, path,
                archive["archive"], fixture.raw(path))
            setup["archives"].append(archive)
        phase = "complete-original-settings-and-local-controller-constructor"
        setup["localController"] = initialize_local_controller(n, policy=CONSTRUCTOR_WITHOUT_LOG_WORKERS)
        controller = setup["localController"]["object"]
        selected = bytes(n.u.mem_read(controller + 0x44B, 1))
        attempts = [lambda: n.u.mem_read(controller + 0x248, 1),
            lambda: n.u.mem_write(controller + 0x248, b"\0"),
            lambda: n.call(0x142B810, {r.UC_X86_REG_RDI: controller + 0x250})]
        for attempt in attempts:
            try:
                attempt()
            except ValueError as error:
                if "controller disk-log queues without post-init" not in str(error):
                    raise
            else:
                raise ValueError("Omitted original disk-log queue was silently accessed")
        if bytes(n.u.mem_read(controller + 0x44B, 1)) != selected:
            raise ValueError("Original log-queue guard changed selected slot")
        setup["omittedLogQueueGuardControls"] = len(attempts)
        phase = "complete"
    except Exception as error:
        boundary = {"phase": phase, "kind": type(error).__name__, "message": str(error),
            "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
            "registers": {name: n.u.reg_read(getattr(r, "UC_X86_REG_" + name.upper()))
                for name in ["rax", "rbx", "rcx", "rdx", "rdi", "rsi", "rbp", "rsp"]}}
    finally:
        n.close_files()
    try:
        fixture.verify()
        for path, digest in sources.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError("Native UI bootstrap source changed: " + path)
        report = {"schema": 1, "kind": "original-archived-replay-ui-registry-bootstrap",
            "build": n.profile["clientVersion"], "protocol": n.profile["protocolDigest"],
            "imageSha256": sha(n.image), "phase": phase, "boundary": boundary, "setup": setup,
            "inputs": fixture.inputs, "sources": sources, "originalBlocks": list(n.blocks.values()),
            "clockCalls": n.clock_calls, "platformEntropyCalls": n.random_device_calls,
            "cooperativeThreads": n.cooperative_thread_summary(),
            "localControllerLogQueueAccesses": getattr(n, "local_controller_log_accesses", []),
            "scope": "Original signed DATA/Global/Bootstrap archive registration, complete original subchunk tables and settings/controller constructor; disk-log workers remain guarded, live replay client selection/event services and rendered native HUD are not claimed"}
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    finally:
        fixture.close()
    print(json.dumps({"output": str(args.output), "phase": phase, "boundary": boundary,
        "archives": len(setup.get("archives", [])), "localController": setup.get("localController") is not None}))
    if boundary:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

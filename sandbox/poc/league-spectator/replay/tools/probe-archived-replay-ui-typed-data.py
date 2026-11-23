"""Register original UI reflection modules before the original replay-control BIN loader.

The accepted bootstrap driver is unchanged. An explicit before-close observer
keeps its complete controller, signed archives and log guards alive while adding
the actual UI archive, postload thread context and original resource reader.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from unicorn import x86_const as r
from archive_subchunks_native import load_installed_subchunks
from installed_resource_archive_native import register_resource_archive
from champion_catalog_native import initialize_binary_resource_cache, initialize_binary_postload_tls
from serialized_asset_progress_native import observe_serialized_asset_progress

bootstrap_path = Path(__file__).with_name("probe-archived-replay-ui-bootstrap.py")
spec = importlib.util.spec_from_file_location("archived_ui_typed_data_bootstrap", bootstrap_path)
bootstrap = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bootstrap
spec.loader.exec_module(bootstrap)
observation = {"boundary": None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["assets", "client", "installation", "fixture_cache", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    source_paths = {Path(__file__), bootstrap_path}
    for module in list(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if filename is not None:
            source = Path(filename).resolve()
            if source.is_relative_to(tools) and source.suffix == ".py":
                source_paths.add(source)
    sources = {str(source.resolve()): hashlib.sha256(source.read_bytes()).hexdigest() for source in source_paths}

    def observe(n):
        phase = "complete-controller-and-log-guards"
        inputs = bootstrap.ReadOnlyInputs(n, args.fixture_cache)
        hooks = []
        try:
            context = n.q(n.base + 0x2470B70)
            if n.allocations.get(context) != 0x640 or len(getattr(n, "local_controller_log_accesses", [])) != 3:
                raise ValueError("Complete original controller and three unchanged disk-log guard controls required")
            phase = "original-ui-archive-signature"
            archive = register_resource_archive(inputs, args.installation, "UI.wad.client")
            archive_path = Path(archive["path"])
            phase = "original-ui-subchunks"
            archive["subchunks"] = load_installed_subchunks(inputs, args.installation, archive_path,
                archive["archive"], inputs.raw(archive_path))
            observation["archive"] = archive
            phase = "original-binary-cache-and-postload-thread"
            observation["cache"] = initialize_binary_resource_cache(n)
            observation["postloadTls"] = initialize_binary_postload_tls(n)
            phase = "original-ui-reflection-modules"
            observation["characterTypes"] = n.initialize_character_types()
            module_runs = []
            n.initializing_resource_types = True
            try:
                for entry in [0x19089A0, 0xF0ED80]:
                    n.call(entry, {})
                    module_runs.append({"entryRva": entry, "originalCallReturned": True})
            finally:
                n.initializing_resource_types = False
            observation["uiReflectionModules"] = module_runs
            handle = n.allocate(16)
            n.call(0x14B7670, {r.UC_X86_REG_RDI: handle})
            before = bytes(n.u.mem_read(handle, 16)).hex()
            text = n.allocate_text("gameplay.replaycontrols.bin")
            observation["serializedProgress"], hooks = observe_serialized_asset_progress(n)
            phase = "original-complete-replay-controls-bin-loader"
            n.call(0x14BA7D0, {r.UC_X86_REG_RDI: handle, r.UC_X86_REG_RSI: text})
            observation["loader"] = {"entryRva": 0x14BA7D0, "originalCallReturned": True,
                "handleBeforeHex": before, "handleAfterHex": bytes(n.u.mem_read(handle, 16)).hex(),
                "returnValue": n.u.reg_read(r.UC_X86_REG_RAX), "nativeWidgetSceneBound": False}
            phase = "complete"
        except Exception as error:
            observation["boundary"] = {"phase": phase, "kind": type(error).__name__, "message": str(error),
                "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                "registers": {name: n.u.reg_read(getattr(r, "UC_X86_REG_" + name.upper()))
                    for name in ["rax", "rbx", "rcx", "rdx", "rdi", "rsi", "rbp", "rsp"]}}
        finally:
            for hook in hooks:
                n.u.hook_del(hook)
            inputs.verify()
            observation.update(phase=phase, inputs=inputs.inputs, originalBlocks=list(n.blocks.values()))
            inputs.close()

    base_class = bootstrap.NativeArchivedReplayUiControl

    class UiDataControl(base_class):
        def close_files(self):
            if not getattr(self, "ui_data_observed", False):
                self.ui_data_observed = True
                observe(self)
            return super().close_files()

    bootstrap.NativeArchivedReplayUiControl = UiDataControl
    startup = args.output.with_name(args.output.stem + "-bootstrap.json")
    saved = sys.argv
    try:
        sys.argv = [str(bootstrap_path), str(args.assets), str(args.client), str(args.installation),
            str(args.fixture_cache), str(startup)]
        bootstrap.main()
    finally:
        sys.argv = saved
    for filename, expected in sources.items():
        if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != expected:
            raise ValueError("Original UI data control source changed during execution")
    startup_bytes = startup.read_bytes()
    if json.loads(startup_bytes)["boundary"] is not None:
        raise ValueError("Original complete archive/controller bootstrap did not finish")
    report = {"schema": 1, "kind": "original-signed-ui-typed-replay-data-control",
        "sources": sources, "bootstrapReceiptSha256": hashlib.sha256(startup_bytes).hexdigest(), **observation,
        "scope": "Original signed UI index/subchunks and unchanged BIN read with an owned postload thread; controller resource fields, scene/widget objects and native HUD event/render readiness remain separate"}
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "phase": observation["phase"], "boundary": observation["boundary"]}))
    if observation["boundary"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

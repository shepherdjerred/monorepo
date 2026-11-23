"""Extend the unchanged complete Shared sampler/resource control with UI rows.

The existing control executes its genuine sampler construction, registration,
GPU readback and negative cases first. This tool then adds the exact UI resource
consumers in the same owned VM, before its normal cleanup.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import shader_global_registry_native
from ui_shared_constants_native import initialize_original_ui_shared_constants
from ui_shared_texture_native import initialize_original_ui_primary_texture


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["assets", "client", "fields", "raw", "typed", "output"]:
        parser.add_argument(name, type=Path)
    parser.add_argument("--registration", type=Path, action="append", required=True)
    parser.add_argument("--graphics", type=Path, required=True)
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    observer = tools / "observe-native-shader-global-fields.py"
    sources = {str(observer): sha(observer.read_bytes()), str(Path(__file__).resolve()): sha(Path(__file__).read_bytes())}
    for module in list(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if filename is not None:
            path = Path(filename).resolve()
            if path.is_relative_to(tools) and path.suffix == ".py":
                sources[str(path)] = sha(path.read_bytes())
    original = shader_global_registry_native.observe_shared_remap_registration
    extension = {}

    def observe_ui(n, records, angle):
        proven = original(n, records, angle)
        extension["existingOriginalControlReturned"] = True
        extension["constants"] = initialize_original_ui_shared_constants(n, n.shared_backend, args.fields, args.registration)
        extension["texture"] = initialize_original_ui_primary_texture(n, n.shared_backend, args.raw, args.typed)
        return proven

    previous = sys.argv
    shader_global_registry_native.observe_shared_remap_registration = observe_ui
    sys.argv = [str(observer), str(args.assets / "decoder-16.21-macos"), str(args.client), str(args.fields), str(args.output),
                *[value for path in args.registration for value in ["--registration", str(path)]],
                "--graphics-angle", str(args.graphics)]
    try:
        spec = importlib.util.spec_from_file_location("complete_original_ui_shared_control", observer)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    finally:
        sys.argv = previous
        shader_global_registry_native.observe_shared_remap_registration = original
        for path, expected in sources.items():
            if sha(Path(path).read_bytes()) != expected:
                raise ValueError("UI resource extension source changed during execution")
        if args.output.exists():
            report = json.loads(args.output.read_bytes())
            report["uiResourceExtension"] = extension
            report["uiResourceExtensionSources"] = sources
            args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

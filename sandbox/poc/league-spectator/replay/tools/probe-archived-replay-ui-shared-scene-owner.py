"""Run UI scene ownership with exact original Shared CPU parameter rows."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

from ui_shared_constants_native import initialize_original_ui_shared_constants
from vfx_graphics_native import DEVICE

source = Path(__file__).with_name("probe-archived-replay-ui-dynamic-scene-owner.py")
spec = importlib.util.spec_from_file_location("archived_shared_ui_scene_probe", source)
dynamic = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dynamic
spec.loader.exec_module(dynamic)
options = None
shared = {}


class SharedUiSceneControl(dynamic.DynamicUiSceneControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        shared["constants"] = initialize_original_ui_shared_constants(self, DEVICE, options.shared_fields, options.registration)
        original = self.q(self.base + 0x2408570 + 0x278)
        if original != self.base + 0x1914DC0:
            raise ValueError("Original named texture lookup virtual differs")
        # Execute the genuine lookup against the same original CPU-owned map.
        # No texture entry or success value is inserted by this binding.
        self.put(self.q(DEVICE) + 0x278, "Q", original)
        shared["originalTextureLookupRva"] = 0x1914DC0
        return result


def main():
    global options
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--shared-fields", type=Path, required=True)
    parser.add_argument("--registration", type=Path, action="append", required=True)
    options, remaining = parser.parse_known_args()
    previous = sys.argv
    sys.argv = [previous[0], *remaining]
    dynamic.scene.UiSceneControl = SharedUiSceneControl
    try:
        dynamic.scene.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-shared-scene-owner-control"
            report["sharedCpuParameters"] = shared
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        sys.argv = previous


if __name__ == "__main__":
    main()

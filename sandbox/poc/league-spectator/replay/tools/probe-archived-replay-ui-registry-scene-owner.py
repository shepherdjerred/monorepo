"""Run actual UI ownership with its original graphics-cache dependency group."""
import importlib.util
import json
import sys
from pathlib import Path

from ui_graphics_registries_native import initialize_original_ui_graphics_registries

source = Path(__file__).with_name("probe-archived-replay-ui-shared-scene-owner.py")
spec = importlib.util.spec_from_file_location("archived_registry_ui_scene_probe", source)
shared = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = shared
spec.loader.exec_module(shared)
registries = {}


class RegistryUiSceneControl(shared.SharedUiSceneControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        registries.update(initialize_original_ui_graphics_registries(self))
        return result


if __name__ == "__main__":
    shared.SharedUiSceneControl = RegistryUiSceneControl
    try:
        shared.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-graphics-registry-scene-owner-control"
            report["graphicsRegistries"] = registries
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")

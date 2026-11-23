"""Run original UI scene binding with its original material-cache owner."""
import importlib.util
import json
import sys
from pathlib import Path

from ui_material_cache_native import initialize_original_ui_material_cache

source = Path(__file__).with_name("probe-archived-replay-ui-shared-scene-owner.py")
spec = importlib.util.spec_from_file_location("archived_material_ui_scene_probe", source)
shared = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = shared
spec.loader.exec_module(shared)
material_cache = {}


class MaterialUiSceneControl(shared.SharedUiSceneControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        material_cache.update(initialize_original_ui_material_cache(self))
        return result


if __name__ == "__main__":
    shared.SharedUiSceneControl = MaterialUiSceneControl
    try:
        shared.main()
    finally:
        # The shared driver restores its complete argv, including the original
        # five explicit inputs/output positions, before returning here.
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-material-scene-owner-control"
            report["materialCache"] = material_cache
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")

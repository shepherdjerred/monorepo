"""Run original UI scene ownership with source-bounded dynamic GPU storage."""
import importlib.util
import json
import sys
from pathlib import Path

from ui_dynamic_buffers_native import NativeUiDynamicBuffers

source = Path(__file__).with_name("probe-archived-replay-ui-scene-owner.py")
spec = importlib.util.spec_from_file_location("archived_dynamic_ui_scene_probe", source)
scene = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = scene
spec.loader.exec_module(scene)


class DynamicUiSceneControl(NativeUiDynamicBuffers, scene.UiSceneControl):
    def close_graphics(self):
        backend = getattr(self, "dynamic_buffer_device", None)
        if backend is not None:
            scene.scene["dynamicBufferAllocations"] = backend.records
        return super().close_graphics()


if __name__ == "__main__":
    scene.UiSceneControl = DynamicUiSceneControl
    try:
        scene.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-dynamic-scene-owner-control"
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")

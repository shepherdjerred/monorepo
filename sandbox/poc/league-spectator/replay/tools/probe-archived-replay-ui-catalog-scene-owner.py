"""Use an actual exact-build translated shader catalog for original UI startup."""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from shared_graphics_registries_native import initialize_shared_graphics_registries

source = Path(__file__).with_name("probe-archived-replay-ui-shader-requests.py")
spec = importlib.util.spec_from_file_location("archived_catalog_ui_request_probe", source)
requested = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = requested
spec.loader.exec_module(requested)
options = None
shader_inputs, setup = {}, {}


class CatalogUiControl(requested.ShaderRequestedUiControl):
    def initialize_character_graphics(self, angle):
        # Retain the same source observer but enter the ordinary Shared setup
        # directly, before the exploratory absent-provider registry call.
        result = super(requested.ShaderRequestedUiControl, self).initialize_character_graphics(angle)
        setup.update(initialize_shared_graphics_registries(self, options.shader_catalog))
        return result

    def close_graphics(self):
        if self.shader_catalog is not None:
            shader_inputs.update(self.shader_catalog.inputs)
        return super().close_graphics()


def main():
    global options
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--shader-catalog", type=Path, required=True)
    options, remaining = parser.parse_known_args()
    previous = sys.argv
    sys.argv = [previous[0], *remaining]
    requested.shared.SharedUiSceneControl = CatalogUiControl
    try:
        requested.shared.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            for path, expected in shader_inputs.items():
                if hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected:
                    raise ValueError("Actual UI shader catalog input changed during native execution")
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-catalog-scene-owner-control"
            report["graphicsRegistries"] = setup
            report["originalShaderRequests"] = requested.requests
            report["shaderInputs"] = shader_inputs
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        sys.argv = previous


if __name__ == "__main__":
    main()

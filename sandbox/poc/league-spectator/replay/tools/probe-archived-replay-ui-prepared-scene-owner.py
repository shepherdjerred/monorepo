"""Prepare only actual missing UI shader requests in the suspended native VM.

The existing bounded append-only preparer keeps original CPU/GL ownership. Its
file-input owner uses an isolated cache, while all archived fixtures stay read-only.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

from shader_package_preparation_native import NativeShaderPackagePreparation

source = Path(__file__).with_name("probe-archived-replay-ui-catalog-scene-owner.py")
spec = importlib.util.spec_from_file_location("archived_prepared_ui_catalog_probe", source)
catalog = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = catalog
spec.loader.exec_module(catalog)
options = None
preparation = {}


if NativeShaderPackagePreparation not in catalog.CatalogUiControl.__mro__:
    raise ValueError("Original control must retain its existing shader-preparation owner")


class PreparedUiControl(catalog.CatalogUiControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        active_root = Path(self.shader_catalog.directory).resolve()
        if active_root.parent.name != "public":
            raise ValueError("Isolated shader catalog must belong to its public artifact root")
        inputs_class = catalog.requested.shared.dynamic.scene.driver.driver.bootstrap.ReadOnlyInputs
        inputs = inputs_class(self, active_root.parent.parent)
        inputs.root = Path(__file__).resolve().parent.parent
        self.ui_shader_preparation_inputs = inputs
        installation = Path(sys.argv[3]).resolve()
        for path in [installation / "Game/League of Legends.exe",
                     installation / "Game/DATA/FINAL/ShaderCache.dx11.wad.client"]:
            inputs.raw(path)
        preparation["config"] = self.configure_shader_preparation(inputs, installation, options.compiler, options.bun)
        preparation["batches"] = self.shader_preparation_batches
        return result

    def close_graphics(self):
        inputs = getattr(self, "ui_shader_preparation_inputs", None)
        if inputs is not None:
            self.ui_shader_preparation_inputs = None
            try:
                inputs.verify()
                preparation["inputs"] = dict(inputs.inputs)
            finally:
                inputs.close()
        return super().close_graphics()


def main():
    global options
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--compiler", type=Path, required=True)
    parser.add_argument("--bun", type=Path, required=True)
    options, remaining = parser.parse_known_args()
    previous = sys.argv
    sys.argv = [previous[0], *remaining]
    catalog.CatalogUiControl = PreparedUiControl
    try:
        catalog.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-bounded-shader-preparation-control"
            report["shaderPreparation"] = preparation
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        sys.argv = previous


if __name__ == "__main__":
    main()

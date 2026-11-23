"""Capture actual original UI dependency shader requests before provider gates.

This installs the existing strict GPU ABI callbacks. It supplies no shader or
successful result; an absent catalog still fails at the unchanged boundary.
"""
import importlib.util
import json
import sys
from pathlib import Path

from unicorn import x86_const as r
from ui_graphics_registries_native import initialize_original_ui_graphics_registries
from vfx_graphics_native import DEVICE, CALLBACKS

source = Path(__file__).with_name("probe-archived-replay-ui-shared-scene-owner.py")
spec = importlib.util.spec_from_file_location("archived_shader_requested_ui_scene_probe", source)
shared = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = shared
spec.loader.exec_module(shared)
requests, registries = [], {}


class ShaderRequestedUiControl(shared.SharedUiSceneControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        table = self.q(DEVICE)
        for offset, name in [(0x138, "vertex"), (0x148, "pixel"), (0x168, "program")]:
            self.put(table + offset, "Q", CALLBACKS[name])
        registries.update(initialize_original_ui_graphics_registries(self))
        return result

    def shader_call(self, kind):
        if kind in ["vertex", "pixel"]:
            device, extra, descriptor, defines = [self.u.reg_read(register) for register in
                [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX]]
            if device != DEVICE or extra != 0 or not self.library_pointer(descriptor, 0x28):
                raise ValueError("Original UI shader request escaped its owned ABI")
            pointer, length = self.q(descriptor + 0x18), self.u32(descriptor + 0x20)
            if not 0 < length < 4096 or not self.library_pointer(pointer, length):
                raise ValueError("Original UI shader descriptor path escaped bounds")
            rows = self.vector(defines, 24, 256)
            macros = []
            for row in rows:
                values = [self.cstring(self.q(row + offset)).decode("ascii") for offset in [0, 8]]
                if any(len(value) > 4095 for value in values):
                    raise ValueError("Original UI shader macro escaped its string bounds")
                macros.append({"name": values[0], "value": values[1]})
            requests.append({"kind": kind, "path": bytes(self.u.mem_read(pointer, length)).decode("ascii"),
                "defines": macros, "descriptor": descriptor,
                "descriptorHex": bytes(self.u.mem_read(descriptor, 0x28)).hex(),
                "returnRva": self.q(self.u.reg_read(r.UC_X86_REG_RSP)) - self.base,
                "shaderProviderPresent": self.shader_catalog is not None})
        return super().shader_call(kind)


if __name__ == "__main__":
    shared.SharedUiSceneControl = ShaderRequestedUiControl
    try:
        shared.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-native-shader-request-control"
            report["graphicsRegistries"] = registries
            report["originalShaderRequests"] = requests
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")

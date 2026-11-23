"""Retain exact scene-decompression stack ownership during UI initialization."""
import importlib.util
import json
import sys
from pathlib import Path

from ui_scene_stack_zero_native import UiSceneStackZero

source = Path(__file__).with_name('probe-archived-replay-ui-offscreen-service.py')
spec = importlib.util.spec_from_file_location('archived_ui_stack_service_parent', source)
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)
stack_fill = {}


class StackServiceControl(driver.OffscreenServiceControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        self.ui_scene_stack_zero = UiSceneStackZero(self)
        stack_fill['calls'] = self.ui_scene_stack_zero.records
        return result

    def imported(self, engine, address, size, user):
        if (getattr(self, 'ui_manager_startup_active', False) and
                self.source.imports[address - self.base] == '___bzero' and
                self.ui_scene_stack_zero.apply(engine)):
            return
        return super().imported(engine, address, size, user)


def main():
    driver.OffscreenServiceControl = StackServiceControl
    try:
        driver.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report['kind'] = 'original-signed-ui-owned-stack-service-control'
            report['sceneDecoderStackFill'] = stack_fill
            output.write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

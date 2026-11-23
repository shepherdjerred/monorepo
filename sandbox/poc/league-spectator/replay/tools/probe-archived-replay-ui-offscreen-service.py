"""Run original UI initialization with actual owned pbuffer dimension queries."""
import importlib.util
import json
import sys
from pathlib import Path

from ui_offscreen_display_native import UiOffscreenDisplay

source = Path(__file__).with_name('probe-archived-replay-ui-scene-service.py')
spec = importlib.util.spec_from_file_location('archived_ui_offscreen_service_parent', source)
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)
display = {}


class OffscreenServiceControl(driver.SceneServiceControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        self.ui_offscreen_display = UiOffscreenDisplay(self)
        display['queries'] = self.ui_offscreen_display.records
        display['scope'] = 'Actual EGL pbuffer dimensions, not a native client window'
        return result


def main():
    driver.SceneServiceControl = OffscreenServiceControl
    try:
        driver.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report['kind'] = 'original-signed-ui-offscreen-surface-service-control'
            report['offscreenDisplay'] = display
            output.write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

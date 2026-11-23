"""Construct the original text-style cache before authored scene postload."""
import importlib.util
import json
import sys
from pathlib import Path

source = Path(__file__).with_name('probe-archived-replay-ui-stack-service.py')
spec = importlib.util.spec_from_file_location('archived_ui_text_service_parent', source)
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)
text_style = {}


class TextServiceControl(driver.StackServiceControl):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        if self.q(self.base + 0x2470EB8):
            raise ValueError('Original text-style cache must be cold before its complete startup block')
        if self.image[0x665FC4:0x665FC9] != bytes.fromhex('bf48000000'):
            raise ValueError('Original text-style cache allocation caller changed')
        returned = self.u.context_save()
        self.ui_manager_startup_active = True
        try:
            # Complete independent app-startup block: original allocation,
            # constructor/publication, device height and cache initialization.
            self.call(0x665FC4, {}, end=0x665FFE)
            owner = self.q(self.base + 0x2470EB8)
            if self.allocations.get(owner) != 0x48:
                raise ValueError('Original text-style cache did not publish its owned allocation')
            text_style.update({'originalStartupBlock': [0x665FC4, 0x665FFE],
                'constructorRva': 0x1694250, 'owner': owner, 'bytes': 0x48,
                'originalHeight': self.u32(owner + 0x20),
                'originalHex': bytes(self.u.mem_read(owner, 0x48)).hex(),
                'completed': True})
        finally:
            self.ui_manager_startup_active = False
            self.u.context_restore(returned)
        return result


def main():
    driver.StackServiceControl = TextServiceControl
    try:
        driver.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report['kind'] = 'original-signed-ui-text-style-scene-control'
            report['textStyleCache'] = text_style
            output.write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

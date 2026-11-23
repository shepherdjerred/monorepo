"""Invoke the original published UI manager's full initialization method.

The authored scene was enqueued by its original controller first. This control
does not supply viewport values, widget pointers, readiness bits or callbacks.
"""
import importlib.util
import json
import sys
from pathlib import Path

from unicorn import x86_const as r
from ui_serialized_objects_native import UiSerializedObjects

source = Path(__file__).with_name("probe-archived-replay-ui-prepared-scene-owner.py")
spec = importlib.util.spec_from_file_location("archived_ui_scene_service_parent", source)
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)
service = {"boundary": None}


class SceneServiceControl(driver.PreparedUiControl):
    def call(self, entry, registers, *args, **kwargs):
        result = super().call(entry, registers, *args, **kwargs)
        if entry != 0x14BA7D0 or getattr(self, "ui_scene_service_observed", False):
            return result
        self.ui_scene_service_observed = True
        returned = self.u.context_save()
        observed = UiSerializedObjects(self)
        phase = "original-ui-manager-initialization-method"
        try:
            manager = self.q(self.base + 0x246D7C0)
            if (self.allocations.get(manager) != 0x1A0 or
                    self.q(manager) != self.base + 0x23FFC18 or
                    self.q(self.q(manager) + 0x30) != self.base + 0x188B620):
                raise ValueError("Original published manager and initialization vtable method required")
            service["owner"] = manager
            service["methodRva"] = 0x188B620
            service["vtableSlot"] = 0x30
            service["beforeHex"] = bytes(self.u.mem_read(manager, 0x1A0)).hex()
            service["queueBefore"] = self.asset_queue_state()
            self.ui_manager_startup_active = True
            self.ui_asset_wait_dispatch.call(0x188B620, {r.UC_X86_REG_RDI: manager})
            service["originalMethodReturned"] = True
            completed = self.u.context_save()
            try:
                self.drain_asset_read_jobs()
                service["originalDrainReturned"] = True
            finally:
                self.u.context_restore(completed)
            service["afterHex"] = bytes(self.u.mem_read(manager, 0x1A0)).hex()
            service["queueAfter"] = self.asset_queue_state()
            phase = "complete"
        except Exception as error:
            service["boundary"] = {"phase": phase, "kind": type(error).__name__,
                "message": str(error), "rva": self.u.reg_read(r.UC_X86_REG_RIP) - self.base,
                "registers": {name: self.u.reg_read(getattr(r, "UC_X86_REG_" + name.upper()))
                    for name in ["rax", "rbx", "rcx", "rdx", "rdi", "rsi", "rbp", "rsp"]}}
            raise
        finally:
            service["phase"] = phase
            service["typedArenas"] = list(observed.arenas.values())
            service["typedObjects"] = list(observed.objects.values())
            observed.close()
            self.ui_manager_startup_active = False
            if service["boundary"] is None:
                self.u.context_restore(returned)
        return result


def main():
    driver.PreparedUiControl = SceneServiceControl
    try:
        driver.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-authored-scene-service-control"
            report["sceneService"] = service
            report["scope"] = ("Original published manager initialization method and owned asset dispatch; "
                "widget cache bindings, event dispatch and native GPU draw readiness are separate")
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

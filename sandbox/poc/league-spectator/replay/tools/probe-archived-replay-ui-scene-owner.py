"""Execute original UI manager construction and authored loadable enqueue.

All native archives, typed fields, textures and callback work come from the
accepted original bootstrap/data path. This does not supply widget pointers,
viewport values or readiness flags, and does not automate a native client.
"""
import importlib.util
import json
import sys
from pathlib import Path

from unicorn import x86_const as r
from ui_manager_native import NativeUiManager
from ui_serialized_objects_native import UiSerializedObjects

driver_path = Path(__file__).with_name("probe-archived-replay-ui-dispatch-data.py")
spec = importlib.util.spec_from_file_location("archived_ui_scene_dispatch_probe", driver_path)
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)
scene = {"boundary": None}


class UiSceneControl(driver.UiDispatchControl):
    def reject(self, engine, address, size, user):
        if (getattr(self, "ui_manager_startup_active", False) and address - self.base == 0x1FEE5FA
                and self.source.imports.get(0x1FEE5FA) == "___bzero"):
            return NativeUiManager.reject(self, engine, address, size, user)
        return super().reject(engine, address, size, user)

    def imported(self, engine, address, size, user):
        if getattr(self, "ui_manager_startup_active", False) and self.source.imports[address - self.base] == "___bzero":
            # Reuse the exact owned-allocation bound/zero-fill ABI, without
            # changing the pristine block-cache observer's required MRO.
            return NativeUiManager.imported(self, engine, address, size, user)
        return super().imported(engine, address, size, user)

    def call(self, entry, registers, *args, **kwargs):
        if entry == 0x14BA7D0 and not hasattr(self, "ui_serialized_objects"):
            self.ui_serialized_objects = UiSerializedObjects(self)
        result = super().call(entry, registers, *args, **kwargs)
        if entry != 0x14BA7D0 or getattr(self, "ui_scene_owner_observed", False):
            return result
        self.ui_scene_owner_observed = True
        returned = self.u.context_save()
        phase = "original-complete-ui-manager-factory"
        try:
            if self.q(self.base + 0x246D7C0):
                raise ValueError("Original UI manager must be cold before its complete factory")
            if self.image[0x67A58E:0x67A593] != bytes.fromhex("bfa0010000"):
                raise ValueError("Original UI manager caller allocation size changed")
            manager = self.allocate(0x1A0)
            scene["manager"] = manager
            scene["originalAllocationCallerRva"] = 0x67A58E
            self.ui_manager_startup_active = True
            super().call(0x188B540, {r.UC_X86_REG_RDI: manager})
            if self.q(self.base + 0x246D7C0) != manager or self.q(manager) != self.base + 0x23FFC18:
                raise ValueError("Original UI factory did not publish its own class/owner")
            scene["originalManagerFactoryReturned"] = True
            scene["managerBeforeEnqueueHex"] = bytes(self.u.mem_read(manager, 0x1A0)).hex()
            phase = "original-controller-authored-base-loadable-enqueue"
            controls = self.q(self.base + 0x24723C0)
            scene["controllerPlacement"] = self.ui_serialized_objects.require(controls, 0x7E8, 0x23A9310)
            loadable = self.q(controls + 0x58)
            scene["authoredLoadable"] = {"object": loadable,
                "placement": self.ui_serialized_objects.require(loadable, 0x28),
                "originalHex": bytes(self.u.mem_read(loadable, 0x28)).hex()}
            # The original base constructor registers controllers here. The
            # complete processor owns the dynamic UI scope while invoking each
            # controller's +28 load method. Directly invoking that method would
            # enqueue its authored scene with a cold/null UI context.
            count = self.u32(self.base + 0x256E0A8)
            pending = self.q(self.base + 0x256E0A0)
            if (not 0 < count <= 4096 or not self.library_pointer(pending, count * 8) or
                    self.q(self.q(controls) + 0x28) != self.base + 0x18DC9A0):
                raise ValueError("Original pending-controller registry and load method required")
            registered = [self.q(pending + index * 8) for index in range(count)]
            if registered.count(controls) != 1:
                raise ValueError("Published controller is not uniquely source-registered for loading")
            scene["originalPendingControllers"] = registered
            context = self.q(self.base + 0x256E088)
            super().call(0x188E100, {})
            request = self.q(loadable + 0x20)
            if (self.allocations.get(request) != 0x10 or self.q(request + 8) != controls or
                    self.q(self.base + 0x256E088) != context):
                raise ValueError("Original controller processor did not retain/restore its owned UI context")
            scene["originalControllerProcessorReturned"] = True
            scene["queuedUiContext"] = self.q(request + 8)
            scene["originalCurrentContextRestored"] = True
            scene["originalLoadableEnqueueReturned"] = True
            scene["managerAfterEnqueueHex"] = bytes(self.u.mem_read(manager, 0x1A0)).hex()
            phase = "complete"
        except Exception as error:
            scene["boundary"] = {"phase": phase, "kind": type(error).__name__, "message": str(error),
                "rva": self.u.reg_read(r.UC_X86_REG_RIP) - self.base,
                "registers": {name: self.u.reg_read(getattr(r, "UC_X86_REG_" + name.upper()))
                              for name in ["rax", "rbx", "rdi", "rsi", "rbp", "rsp"]}}
            raise
        finally:
            self.ui_manager_startup_active = False
            scene["serializedArenaObservation"] = {
                "arenas": list(self.ui_serialized_objects.arenas.values()),
                "typedObjects": list(self.ui_serialized_objects.objects.values())}
            self.ui_serialized_objects.close()
            scene["phase"] = phase
            if scene["boundary"] is None:
                self.u.context_restore(returned)
        return result


def main():
    # The graphics driver captures this class once at main entry. Retain the
    # dispatch subclass and its shared native methods through the normal MRO.
    driver.driver.bootstrap.NativeArchivedReplayUiControl = UiSceneControl
    try:
        driver.driver.main()
    finally:
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["kind"] = "original-signed-ui-scene-owner-control"
            report["assetDispatch"] = driver.dispatch
            report["sceneOwner"] = scene
            report["scope"] = "Original UI manager factory and actual authored loadable enqueue; widget service processing, event ownership and rendered native HUD remain separate"
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

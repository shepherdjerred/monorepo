"""Original UI factory controls with one bounded owned C zero-fill import."""
from unicorn import x86_const as registers
from vfx_spawn_native import NativeSpawn

class NativeUiManager(NativeSpawn):
    def initialize_layout_constants(self):
        # Same original math initialization lineage as the animation sampler,
        # extended through its actual four-component UI factory default store.
        # Include the existing original 3D/math prefix and ARGB suffix so data
        # constructors never observe a partially initialized constant bank.
        self.call(0x14aa3bf, {}, end=0x14aa5f9)

    def reject(self, uc, address, size, user):
        if address - self.base == 0x1fee5fa and self.source.imports.get(0x1fee5fa) == "___bzero": return
        return super().reject(uc, address, size, user)

    def imported(self, uc, address, size, user):
        if self.source.imports[address - self.base] != "___bzero":
            return super().imported(uc, address, size, user)
        destination, count = uc.reg_read(registers.UC_X86_REG_RDI), uc.reg_read(registers.UC_X86_REG_RSI)
        allocation = next(((start, length) for start, length in self.allocations.items() if start <= destination <= start + length - count), None)
        if not 0 <= count < 0x100000 or allocation is None:
            raise ValueError("UI factory zero-fill escaped a single original owned allocation")
        if count: uc.mem_write(destination, bytes(count))
        self.services["ui-factory-owned-bzero"] = self.services.get("ui-factory-owned-bzero", 0) + 1
        self.ret()

    def construct_layout_manager(self, manager):
        # Complete the original settings factory, before live owner registration.
        self.call(0x188b540, {registers.UC_X86_REG_RDI: manager}, end=0x188b567)
        settings = self.u.reg_read(registers.UC_X86_REG_R14)
        if self.allocations.get(settings) != 0x180: raise ValueError("Original UI settings allocation changed")
        # Original global-owner and manager default-store fragments. The caller
        # supplies a bounded stack frame for the original temporary stores.
        frame = 0x10030000
        self.call(0x188b295, {registers.UC_X86_REG_RDI: manager}, end=0x188b2a6)
        self.call(0x188b2cd, {registers.UC_X86_REG_RBX: manager, registers.UC_X86_REG_RBP: frame,
            registers.UC_X86_REG_R14: 0}, end=0x188b3fc)
        self.put(frame - 0x60, "Q", settings)
        self.call(0x188b40b, {registers.UC_X86_REG_RBX: manager, registers.UC_X86_REG_RBP: frame}, end=0x188b413)
        if self.q(manager) != self.base + 0x23ffc18 or self.q(manager + 0x40) != settings:
            raise ValueError("Original layout manager defaults/settings binding changed")
        return settings

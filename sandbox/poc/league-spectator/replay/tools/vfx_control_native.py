"""Original reversible birth suppression on an owned loaded-quad runtime.

This is not system retirement, effect destruction or a replay-event mapping.
The original setter and object-to-emitter propagation fragment execute unchanged.
The scratch object/list represent only one controlled complex emitter; mesh
siblings are explicitly absent. Complete emitter assets and particle pools stay
under their existing ownership and execution contracts.
"""
import unicorn
from unicorn import x86_const as r

from vfx_bound_quad_native import NativeBoundQuad
from vfx_spawn_native import ADDRESSES as A

CONTROL = 0x100f0000
ACTOR_LIST = 0x100f0400
SETTER = (0x1767070, 0x1767081)
PROPAGATE = (0x17661c5, 0x1766243)


class NativeVfxControl(NativeBoundQuad):
    def call(self, entry, registers, end=None):
        if (entry, end) != PROPAGATE:
            return super().call(entry, registers, end)
        # Endpoints inside a larger cached function need an instruction hook.
        self.u.context_restore(self.initial)
        self.put(A['stack'], 'Q', A['stop'])
        self.u.reg_write(r.UC_X86_REG_RSP, A['stack'])
        for register, value in registers.items():
            self.u.reg_write(register, value)
        hook = self.u.hook_add(unicorn.UC_HOOK_CODE, lambda uc, address, size, user: uc.emu_stop(),
                               begin=self.base + end, end=self.base + end)
        try:
            self.u.emu_start(self.base + entry, A['stop'], count=5000000)
        finally:
            self.u.hook_del(hook)
        if self.u.reg_read(r.UC_X86_REG_RIP) != self.base + end:
            raise ValueError('Native emission-control fragment exceeded its endpoint')

    def suspend(self, suspended):
        if type(suspended) is not bool:
            raise ValueError('Explicit boolean emission suspension required')
        scratch = bytes(self.u.mem_read(CONTROL, 0x500))
        lists = [(at, bytes(self.u.mem_read(at, 16))) for at in [A['system'] + 0x40, A['system'] + 0x60]]
        try:
            self.u.mem_write(CONTROL, bytes(0x500))
            self.put(CONTROL + 0x28, 'Q', A['system'])
            self.put(ACTOR_LIST, 'Q', A['actor'])
            self.put(A['system'] + 0x40, 'QII', ACTOR_LIST, 1, 1)
            self.put(A['system'] + 0x60, 'QII', 0, 0, 0)
            before = self.u.mem_read(A['actor'] + 0x18, 1)[0]
            self.call(SETTER[0], {r.UC_X86_REG_RDI: CONTROL, r.UC_X86_REG_RSI: int(suspended)})
            self.call(PROPAGATE[0], {r.UC_X86_REG_RBX: CONTROL}, PROPAGATE[1])
            after = self.u.mem_read(A['actor'] + 0x18, 1)[0]
            if after != (before & ~2) | (int(suspended) << 1):
                raise ValueError('Original emitter birth-suppression bit differs')
            return {'before': before, 'after': after,
                    'objectValue': self.u.mem_read(CONTROL + 0x1b8, 1)[0],
                    'objectDirty': self.u.mem_read(CONTROL + 0x1a, 1)[0]}
        finally:
            self.u.mem_write(CONTROL, scratch)
            for at, data in lists:
                self.u.mem_write(at, data)

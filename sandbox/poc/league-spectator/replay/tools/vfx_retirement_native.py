"""Original system retirement, parent tick and deferred disposal queue.

One complete loaded quad emitter runs under constructor-default parent settings.
OS mutex services are explicit single-thread ownership models. Audio IDs are
absent and mesh/simple siblings are absent. Deferred disposal is observed, not
replaced by a fake destructor. Replay lifecycle mapping remains unresolved.
"""
import struct
import unicorn
from unicorn import x86_const as r

from vfx_bound_quad_native import NativeBoundQuad
from vfx_spawn_native import ADDRESSES as A

LINK_TIMERS = (0x16e1742, 0x16e17e6)
RETIRE = 0x1761b00
COLLECT = 0x174c2d0
PARENT_TICK = 0x1763220
LIST = 0x1002f000
POSITION = 0x1002f008
BASIS = 0x1002f018
MUTEX_IMPORTS = {'_pthread_mutex_init': 0x1feebf4,
                 '_pthread_mutex_lock': 0x1feebfa,
                 '_pthread_mutex_unlock': 0x1feec06}


class NativeVfxRetirement(NativeBoundQuad):
    def __init__(self, *args):
        self.mutexes, self.os_calls, self.substeps = {}, [], []
        super().__init__(*args)
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.capture_substep,
                        begin=self.base + 0x1757f10, end=self.base + 0x1757f10)
        for name, at in MUTEX_IMPORTS.items():
            if self.source.imports[at] != name:
                raise ValueError('Retirement mutex import changed')

    def imported(self, uc, address, size, user):
        name = self.source.imports[address - self.base]
        if name not in MUTEX_IMPORTS:
            return super().imported(uc, address, size, user)
        at = self.u.reg_read(r.UC_X86_REG_RDI)
        if at not in [A['manager'] + 0x190, A['manager'] + 0x1e0]:
            raise ValueError('Unowned retirement mutex')
        if name == '_pthread_mutex_init':
            if at in self.mutexes or self.u.reg_read(r.UC_X86_REG_RSI):
                raise ValueError('Duplicate or attributed retirement mutex')
            self.mutexes[at] = False
        else:
            if at not in self.mutexes or self.mutexes[at] != (name == '_pthread_mutex_unlock'):
                raise ValueError('Invalid retirement mutex ownership')
            self.mutexes[at] = not self.mutexes[at]
        self.os_calls.append({'name': name, 'address': at, 'result': 0})
        self.u.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()

    def fragment(self, start, end, registers):
        self.u.context_restore(self.initial)
        self.put(A['stack'], 'Q', A['stop'])
        self.u.reg_write(r.UC_X86_REG_RSP, A['stack'])
        for register, value in registers.items():
            self.u.reg_write(register, value)
        hook = self.u.hook_add(unicorn.UC_HOOK_CODE, lambda uc, address, size, user: uc.emu_stop(),
                               begin=self.base + end, end=self.base + end)
        try:
            self.u.emu_start(self.base + start, A['stop'], count=5000000)
        finally:
            self.u.hook_del(hook)
        if self.u.reg_read(r.UC_X86_REG_RIP) != self.base + end:
            raise ValueError('Retirement fragment endpoint exceeded')

    def capture_substep(self, uc, address, size, user):
        if self.u.reg_read(r.UC_X86_REG_RDI) != A['actor']:
            raise ValueError('Unadmitted retirement sibling')
        self.substeps.append(struct.unpack('<f', struct.pack('<I', self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0])

    def reset_parent(self, graph, seed, quality, bound_meta, system_meta, created_at=0):
        self.reset_bound(graph, seed, quality, bound_meta)
        self.mutexes, self.os_calls, self.substeps = {}, [], []
        self.call(system_meta['rootConstructorRva'], {r.UC_X86_REG_RDI: A['systemDefinition']})
        for block in system_meta['initializers']:
            regs = {getattr(r, 'UC_X86_REG_' + name):
                    A['stack'] - 0x100 if name == 'RBP' else A[value] if isinstance(value, str) else value
                    for name, value in block['registers'].items()}
            self.fragment(block['startRva'], block['endRva'], regs)
        self.u.mem_write(A['manager'] + 0x284, bytes.fromhex(system_meta['nativeQualityMultipliersHex']))
        self.put(A['system'] + 0x30, 'Q', A['manager'])
        self.put(A['system'] + 0x40, 'QII', LIST, 1, 1)
        self.put(LIST, 'Q', A['actor'])
        self.put(BASIS, 'fff', 0, 1, 0)
        self.call(system_meta['basisRva'], {r.UC_X86_REG_RDI: A['system'], r.UC_X86_REG_RSI: BASIS})
        self.fragment(0x174bbb3, 0x174bbd5, {r.UC_X86_REG_RBX: A['system'],
                      r.UC_X86_REG_XMM0: int.from_bytes(struct.pack('<f', created_at), 'little')})
        self.put(POSITION, 'fff', 0, 0, 0)
        self.fragment(0x174bc15, 0x174bc8d, {r.UC_X86_REG_RBX: A['system'], r.UC_X86_REG_RCX: POSITION, r.UC_X86_REG_RAX: A['resource']})
        self.fragment(*LINK_TIMERS, {r.UC_X86_REG_RDI: A['link'], r.UC_X86_REG_R15: A['link']})
        active = self.allocate(8)
        self.put(active, 'Q', A['system'])
        self.put(A['manager'] + 0x180, 'QII', active, 1, 1)
        for offset in [0x190, 0x1e0]:
            self.call(MUTEX_IMPORTS['_pthread_mutex_init'], {r.UC_X86_REG_RDI: A['manager'] + offset, r.UC_X86_REG_RSI: 0})
        self.last_time = self.created_time = created_at

    def retire(self, mode):
        if type(mode) is not bool:
            raise ValueError('Explicit retirement mode required')
        self.call(RETIRE, {r.UC_X86_REG_RDI: A['system'], r.UC_X86_REG_RSI: int(mode)})
        if any(self.mutexes.values()):
            raise ValueError('Retirement left a mutex locked')
        return self.lifecycle()

    def collect(self):
        # Native false mode transfers completed roots to deferred disposal.
        # True mode invokes the complete destructor, outside this component.
        self.call(COLLECT, {r.UC_X86_REG_RDI: A['manager'], r.UC_X86_REG_RSI: 0})
        if any(self.mutexes.values()):
            raise ValueError('Retirement collector left a mutex locked')
        return self.lifecycle()

    def lifecycle(self):
        lists = {}
        for name, offset in [('active', 0x180), ('retiring', 0x1d0), ('deferred', 0x220)]:
            pointer, count, capacity = struct.unpack('<QII', self.u.mem_read(A['manager'] + offset, 16))
            if count > capacity or capacity > 32 or count and pointer not in self.allocations:
                raise ValueError('Retirement queue ownership bound')
            lists[name] = {'pointer': pointer, 'count': count, 'capacity': capacity,
                           'values': [self.q(pointer + i * 8) for i in range(count)]}
        return {'flags': struct.unpack('<H', self.u.mem_read(A['system'] + 0x2a9, 2))[0],
                'actorFlags': self.u.mem_read(A['actor'] + 0x18, 1)[0], 'lists': lists,
                'linkTimersHex': bytes(self.u.mem_read(A['link'] + 0x90, 8)).hex(),
                'systemHex': bytes(self.u.mem_read(A['system'], 0x2b8)).hex(),
                'managerHex': bytes(self.u.mem_read(A['manager'], 0x400)).hex()}

    def tick_parent(self, value):
        if not self.last_time <= value['time'] <= self.created_time + 30 or not 1 <= value['maxSubsteps'] <= 20:
            raise ValueError('Retirement clock or substep bound')
        self.last_time = value['time']
        self.births.clear(); self.math_calls.clear(); self.services.clear(); self.substeps.clear(); self.library_inputs.clear()
        self.put(A['system'] + 0x108, 'fff', *value['current'])
        self.put(A['link'] + 0x58, 'Q', 0x20000000 if value['multTexturePresent'] else 0)
        self.u.mem_write(A['stack'] - 0x8000, bytes(0x8000))
        self.call(PARENT_TICK, {r.UC_X86_REG_RDI: A['system'], r.UC_X86_REG_RSI: value['maxSubsteps'],
                  r.UC_X86_REG_XMM0: int.from_bytes(struct.pack('<f', value['time']), 'little')})
        state = self.snapshot()
        self.camera_right, self.camera_up, self.view_axis = [value[k] for k in ['cameraRight', 'cameraUp', 'viewAxis']]
        geometry = self.render_quad(value['viewPosition'])
        return {'state': state, 'geometry': geometry, 'substeps': list(self.substeps), 'lifecycle': self.lifecycle()}

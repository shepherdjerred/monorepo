"""Bounded Mach semaphore ABI; blocking waits require an explicit scheduler."""
from unicorn import x86_const as r
from vfx_object_native import TASK_VALUE, TASK_ID, MANAGER, SEMAPHORE_OFFSETS

TASK_SELF_SLOT = 0x22e03f8
CREATE, DESTROY, SIGNAL, TIMEDWAIT, WAIT = 0x1feecf6, 0x1feecfc, 0x1feed02, 0x1feed08, 0x1feed0e
KERN_OPERATION_TIMED_OUT = 49
MAX_SEMAPHORES, MAX_COUNT = 128, 0x10000


class NativeMachSemaphores:
    def __init__(self, *args, **kwargs):
        self.mach_task_port = None
        self.mach_task_port_cell = None
        self.mach_semaphores = {}
        self.mach_semaphore_calls = []
        super().__init__(*args, **kwargs)
        expected = {CREATE: '_semaphore_create', DESTROY: '_semaphore_destroy', SIGNAL: '_semaphore_signal',
                    TIMEDWAIT: '_semaphore_timedwait', WAIT: '_semaphore_wait'}
        if (self.source.data_imports.get(TASK_SELF_SLOT) != '_mach_task_self_' or
                any(self.source.imports.get(at) != name for at, name in expected.items())):
            raise ValueError('Original Mach task/semaphore platform imports differ')

    def initialize_mach_semaphore_platform(self):
        previous = self.q(self.base + TASK_SELF_SLOT)
        if (self.mach_task_port is not None or previous not in [0, TASK_VALUE] or
                previous and self.u32(previous) != TASK_ID or
                not self.writable_file_memory(TASK_VALUE, 4)):
            raise ValueError('Cold or existing owned Mach task port binding required')
        # This value is an opaque platform port name, not a live OS task or a
        # game object. It is dereferenced by the unchanged original wrapper.
        # Share the established opaque process task ABI with the existing
        # asset/VFX providers. Their original queue initialization rebinds this
        # same cell; it must not invalidate another provider's ownership.
        self.mach_task_port = TASK_ID
        self.mach_task_port_cell = TASK_VALUE
        self.put(self.mach_task_port_cell, 'I', self.mach_task_port)
        self.put(self.base + TASK_SELF_SLOT, 'Q', self.mach_task_port_cell)
        return {'taskPort': self.mach_task_port, 'taskPortCell': self.mach_task_port_cell,
                'dataImportRva': TASK_SELF_SLOT, 'platformPortOnly': True, 'liveOsTaskCreated': False,
                'sharedWithExistingAssetAndVfxProviders': True,
                'blockingWaitSchedulerEstablished': False}

    def imported(self, engine, address, size, user):
        at = address - self.base
        if at not in [CREATE, DESTROY, SIGNAL, TIMEDWAIT, WAIT]:
            return super().imported(engine, address, size, user)
        first, second, third, fourth = [engine.reg_read(register) for register in
            [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX]]
        asset_destinations = ([self.asset_work_queue + 0xc] if getattr(self, 'asset_work_queue', None) is not None else [])
        if getattr(self, 'asset_completion_dispatcher', None) is not None:
            asset_destinations.extend([self.asset_completion_dispatcher + 0x60,
                                       self.asset_completion_dispatcher + 0x64])
        if (at == CREATE and (second in asset_destinations or
                              second - MANAGER in SEMAPHORE_OFFSETS) or
                at in [SIGNAL, WAIT] and first in getattr(self, 'asset_semaphores', {})):
            # These existing providers own their counters and validation. Do
            # not capture a successful call into a second semaphore registry.
            return super().imported(engine, address, size, user)
        if (self.mach_task_port is None or self.q(self.base + TASK_SELF_SLOT) != self.mach_task_port_cell or
                self.u32(self.mach_task_port_cell) != self.mach_task_port):
            raise ValueError('Owned initialized Mach task port required')
        result = 0
        if at == CREATE:
            if (first != self.mach_task_port or third != 0 or fourth > MAX_COUNT or
                    not self.writable_file_memory(second, 4) or len(self.mach_semaphores) >= MAX_SEMAPHORES):
                raise ValueError('Bounded owned FIFO Mach semaphore creation required')
            port = 0x4d530100 + len(self.mach_semaphores)
            self.mach_semaphores[port] = {'port': port, 'initialCount': fourth, 'count': fourth, 'destroyed': False}
            self.put(second, 'I', port)
            operation = 'create'
        else:
            port = second if at == DESTROY else first
            state = self.mach_semaphores.get(port)
            if state is None or state['destroyed'] or at == DESTROY and first != self.mach_task_port:
                raise ValueError('Owned live Mach semaphore and task required')
            if at == DESTROY:
                state['destroyed'] = True
                operation = 'destroy'
            elif at == SIGNAL:
                if state['count'] >= MAX_COUNT:
                    raise ValueError('Mach semaphore count exceeds explicit bound')
                state['count'] += 1
                operation = 'signal'
            else:
                seconds, nanoseconds = second & 0xffffffff, (second >> 32) & 0xffffffff
                if at == TIMEDWAIT and nanoseconds >= 1000000000:
                    raise ValueError('Valid bounded Mach timespec required')
                if state['count']:
                    state['count'] -= 1
                    operation = 'timedwait-acquired' if at == TIMEDWAIT else 'wait-acquired'
                elif at == TIMEDWAIT and seconds == 0 and nanoseconds == 0:
                    result, operation = KERN_OPERATION_TIMED_OUT, 'timedwait-zero-timeout'
                else:
                    # Do not invent a signal, completed job, clock advance or
                    # timeout. No kernel wait has been enqueued by this model.
                    raise ValueError('Mach semaphore wait requires an explicit scheduler and clock')
        self.mach_semaphore_calls.append({'operation': operation, 'port': port,
            'count': self.mach_semaphores[port]['count'], 'result': result,
            'callerRva': self.q(engine.reg_read(r.UC_X86_REG_RSP)) - self.base,
            'platformLibraryBoundary': True})
        engine.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()

    def mach_semaphore_summary(self):
        return [dict(state) for state in self.mach_semaphores.values()]

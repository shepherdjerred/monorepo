"""Pinned Darwin scheduler-range query ABI, separate from worker creation.

The modeled default user priority is an explicit platform input, not a query
of this Windows host or proof of realtime/OS-thread scheduling.
"""
from unicorn import x86_const as r
from vfx_spawn_native import sha


SOURCE_SHA256 = '20dbfe99ea37add77c34da12d3590d267aacb4e92c862d649db4d43bc3274669'
SOURCE_URL = 'https://raw.githubusercontent.com/apple-oss-distributions/libpthread/42d026df5b07825070f60134b980a1ec2552dfee/src/pthread.c'


class NativeDarwinSchedulerQueries:
    def configure_scheduler_queries(self, original_source, *, default_user_priority):
        if getattr(self, 'darwin_scheduler_queries', None) is not None:
            raise ValueError('Original scheduler-query platform ownership is not reentrant')
        if sha(original_source) != SOURCE_SHA256 or default_user_priority != 31:
            raise ValueError('Pinned Darwin scheduler source and explicit default user priority31 required')
        for name, expected in [('_sched_get_priority_max', 0x1feece4), ('_sched_get_priority_min', 0x1feecea)]:
            if self.source.imports.get(expected) != name:
                raise ValueError('Original scheduler priority import identity differs')
        self.darwin_scheduler_queries = {'sourceSha256': SOURCE_SHA256, 'sourceUrl': SOURCE_URL,
            'defaultUserPriority': default_user_priority, 'calls': [],
            'hostDarwinSchedulerQueried': False, 'osThreadsCreated': False,
            'realTimeSchedulingEstablished': False, 'workerReadinessAdmitted': False}
        return self.darwin_scheduler_queries

    def imported(self, engine, address, size, user):
        name = self.source.imports[address-self.base]
        state = getattr(self, 'darwin_scheduler_queries', None)
        if state is None or name not in ['_sched_get_priority_min', '_sched_get_priority_max']:
            return super().imported(engine, address, size, user)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
        allowed = ([0x1caf4af, 0x1caf4ed, 0x1c1dc3d, 0x1c034d6, 0x1c03523,
                    0x1c03560, 0x1c0357b, 0x1c035b9, 0x1c035d5, 0x1c03613]
                   if name == '_sched_get_priority_max' else
                   [0x1caf4bc, 0x1caf4d6, 0x1c1dc32, 0x1c034e3, 0x1c034fd,
                    0x1c03530, 0x1c0354a, 0x1c03588, 0x1c035a2, 0x1c035e2, 0x1c035fc])
        policy = engine.reg_read(r.UC_X86_REG_RDI)
        if (caller not in allowed or policy != 4 or len(state['calls']) >= 4096 or
                self.image[0x1caf470:0x1caf514] != self.source.image[0x1caf470:0x1caf514] or
                self.image[0x1c1dbb0:0x1c1dce1] != self.source.image[0x1c1dbb0:0x1c1dce1] or
                self.image[0x1c034b0:0x1c03621] != self.source.image[0x1c034b0:0x1c03621]):
            raise ValueError(f'Unowned original scheduler priority query caller/policy: caller={caller:x} policy={policy}')
        value = state['defaultUserPriority']+(16 if name == '_sched_get_priority_max' else -16)
        state['calls'].append({'name': name, 'policy': policy, 'callerRva': caller, 'result': value})
        engine.reg_write(r.UC_X86_REG_RAX, value)
        self.ret()

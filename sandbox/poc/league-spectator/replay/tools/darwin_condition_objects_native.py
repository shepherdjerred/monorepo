"""Owned condition-variable initialization ABI; waits/scheduling stay unavailable.

Opaque platform storage belongs to this port, not the sound SDK or a game job.
Creating it does not run a worker, wake a waiter, or report audio readiness.
"""
from unicorn import x86_const as r
from vfx_spawn_native import sha


CONDITION_SHA = '1ae8db5b479ad2a7314fc5c5d61b765a0a88be5c9521a2db64448f40b1232a0b'
TYPES_SHA = '8e48a8ad40e3ade70facc56d506634c0c8adaa66e9e61232ed56d75a20d099ee'


class NativeDarwinConditionObjects:
    def configure_condition_objects(self, condition_source, types_source):
        if getattr(self, 'darwin_condition_objects', None) is not None:
            raise ValueError('Condition platform ownership is not reentrant')
        if sha(condition_source) != CONDITION_SHA or sha(types_source) != TYPES_SHA:
            raise ValueError('Pinned original Darwin condition/type sources required')
        self.darwin_condition_objects = {'attributes': {}, 'conditions': {}, 'calls': [],
            'conditionSourceSha256': CONDITION_SHA, 'typesSourceSha256': TYPES_SHA,
            'opaquePlatformStorage': True, 'nativeWaitsExecuted': False,
            'workerReadinessAdmitted': False, 'audioDeviceAdmitted': False}
        return self.darwin_condition_objects

    def imported(self, engine, address, size, user):
        name = self.source.imports[address-self.base]
        state = getattr(self, 'darwin_condition_objects', None)
        if state is None or name not in ['_pthread_condattr_init', '_pthread_condattr_destroy', '_pthread_cond_init', '_pthread_cond_broadcast']:
            return super().imported(engine, address, size, user)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
        allowed = {'_pthread_condattr_init': [0x1cb1d58, 0x1cb1de3],
                   '_pthread_condattr_destroy': [0x1cb1dbb, 0x1cb1e16],
                   '_pthread_cond_init': [0x1cb1d7b, 0x1cb1e00, 0x1bc3a1a],
                   '_pthread_cond_broadcast': [0x1c33550]}
        if (caller not in allowed[name] or len(state['calls']) >= 4096 or
                self.image[0x1cb1d20:0x1cb1e20] != self.source.image[0x1cb1d20:0x1cb1e20] or
                self.image[0x1bc39a9:0x1bc3a1a] != self.source.image[0x1bc39a9:0x1bc3a1a] or
                self.image[0x1c33520:0x1c33550] != self.source.image[0x1c33520:0x1c33550]):
            raise ValueError(f'Unowned original condition-object caller: {name} at{caller:x}')
        at = engine.reg_read(r.UC_X86_REG_RDI)
        if name == '_pthread_condattr_init':
            if not self.writable_file_memory(at, 16) or state['attributes'].get(at, {}).get('live'):
                raise ValueError('Owned cold condition attribute storage required')
            self.put(at, 'Q', 0x434e4441)
            self.put(at+8, 'I', (self.u32(at+8) & ~3) | 2)
            state['attributes'][at] = {'live': True, 'processShared': False}
        elif name == '_pthread_condattr_destroy':
            if not state['attributes'].get(at, {}).get('live') or self.q(at) != 0x434e4441:
                raise ValueError('Owned live condition attribute required')
            self.put(at, 'Q', 0)
            state['attributes'][at]['live'] = False
        elif name == '_pthread_cond_broadcast':
            condition = state['conditions'].get(at)
            if (condition is None or not condition['live'] or condition['waiters'] != 0 or
                    bytes(engine.mem_read(at, 48)) != (0x434f4e44).to_bytes(8, 'little')+bytes(40)):
                raise ValueError('Owned pristine condition without waiters required; wakes remain unadmitted')
            # Pinned pthread_cond.c:_pthread_cond_signal returns immediately
            # for a pristine condition. No signal is retained for future waits.
            state.setdefault('emptyBroadcasts', []).append({'object': at, 'callerRva': caller,
                'waiters': 0, 'threadsWoken': 0, 'futureWakeStored': False})
        else:
            attr = engine.reg_read(r.UC_X86_REG_RSI)
            if (not self.writable_file_memory(at, 48) or at in state['conditions'] or
                    len(state['conditions']) >= 1024 or
                    caller == 0x1bc3a1a and attr != 0 or
                    attr and (not state['attributes'].get(attr, {}).get('live') or self.q(attr) != 0x434e4441)):
                raise ValueError('Owned cold condition/attribute storage required')
            # Opaque storage is a platform token. It is not a claim that the
            # Apple kernel's internal wait/sequence representation was run.
            engine.mem_write(at, bytes(48))
            self.put(at, 'Q', 0x434f4e44)
            state['conditions'][at] = {'live': True, 'processShared': False, 'waiters': 0}
        state['calls'].append({'name': name, 'callerRva': caller, 'object': at, 'result': 0})
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()

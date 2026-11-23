"""Pinned SDK pthread attributes and owned cooperative contexts, not OS threads.

Attribute bytes are opaque platform storage; their admitted values live in this
port. The original SDK wrapper sets/reads them through its real pthread imports.
Creation preserves stack and scheduling metadata but does not execute a worker,
grant realtime privileges, signal conditions, or establish audio readiness.
"""
from unicorn import x86_const as r
from vfx_spawn_native import sha
from darwin_scheduler_query_native import SOURCE_SHA256
from darwin_condition_objects_native import TYPES_SHA
from darwin_sdk_thread_local_native import configure_sdk_thread_local


PUBLIC_SHA = 'c14ac88c6c17f6eaea94ecd5a6fed5bb2a509cc154be43bfea44e6a4430468ca'
IMPL_SHA = '42896cbc575d9099c53f8c0afbaa04f40b2d11d24f92af5ccd7dacdaf8690231'
CALLERS = {'_pthread_attr_init': [0x1c1dbe8],
    '_pthread_attr_setstacksize': [0x1c1dbf5],
    '_pthread_attr_setdetachstate': [0x1c1dc02],
    '_pthread_attr_setschedpolicy': [0x1c1dc12, 0x1c1dc2a],
    '_pthread_attr_getschedparam': [0x1c1dc5d],
    '_pthread_attr_setschedparam': [0x1c1dc6f],
    '_pthread_attr_getinheritsched': [0x1c1dc7f],
    '_pthread_attr_setinheritsched': [0x1c1dc8c],
    '_pthread_attr_destroy': [0x1c1dca9]}


class NativeDarwinSdkThreads:
    def configure_sdk_threads(self, source, types, public, implementation):
        if getattr(self, 'darwin_sdk_threads', None) is not None:
            raise ValueError('SDK thread platform ownership is not reentrant')
        hashes = [sha(value) for value in [source, types, public, implementation]]
        if hashes != [SOURCE_SHA256, TYPES_SHA, PUBLIC_SHA, IMPL_SHA]:
            raise ValueError('Pinned Darwin pthread source/type/public/implementation references required')
        if getattr(self, 'darwin_scheduler_queries', {}).get('defaultUserPriority') != 31:
            raise ValueError('SDK attributes require the explicit pinned scheduler-query platform')
        self.darwin_sdk_threads = {'sourceSha256': hashes[0], 'typesSha256': hashes[1],
            'publicSha256': hashes[2], 'implementationSha256': hashes[3],
            'attributes': {}, 'calls': [], 'contexts': [], 'maximumSdkContexts': 8,
            'mainThread': self.allocate(8),
            'osThreadsCreated': False,
            'realTimeSchedulingEstablished': False, 'workerReadinessAdmitted': False,
            'opaquePlatformAttributeStorage': True}
        configure_sdk_thread_local(self, self.darwin_sdk_threads)
        return self.darwin_sdk_threads

    def _sdk_attribute(self, at):
        state = self.darwin_sdk_threads['attributes'].get(at)
        if (state is None or not state['live'] or not self.writable_file_memory(at, 64) or
                bytes(self.u.mem_read(at, 64)) != bytes.fromhex(state['opaqueHex'])):
            raise ValueError('Owned live unchanged SDK pthread attribute required')
        return state

    def imported(self, engine, address, size, user):
        name = self.source.imports[address-self.base]
        state = getattr(self, 'darwin_sdk_threads', None)
        attributes = engine.reg_read(r.UC_X86_REG_RSI)
        if state is not None and name == '_pthread_self':
            caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
            owner = self.cooperative_active_thread
            if (caller not in [0x1c00672, 0x1c006a2] or len(state['calls']) >= 4096 or
                    owner is not None and owner not in state['contexts'] or
                    self.image[0x1c00660:0x1c006c0] != self.source.image[0x1c00660:0x1c006c0]):
                raise ValueError('Owned original SDK pthread_self caller/context required')
            value = state['mainThread'] if owner is None else owner
            state['calls'].append({'name': name, 'callerRva': caller, 'result': value,
                'logicalContext': owner, 'hostOsThreadIdentityAdmitted': False})
            engine.reg_write(r.UC_X86_REG_RAX, value)
            self.ret()
            return
        if state is None or name not in CALLERS and not (name == '_pthread_create' and attributes):
            return super().imported(engine, address, size, user)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
        allowed = [0x1c1dc9e] if name == '_pthread_create' else CALLERS[name]
        if (caller not in allowed or len(state['calls']) >= 4096 or
                self.image[0x1c1dbb0:0x1c1dce1] != self.source.image[0x1c1dbb0:0x1c1dce1]):
            raise ValueError(f'Unowned original SDK pthread caller: {name} at{caller:x}')
        at, value = engine.reg_read(r.UC_X86_REG_RDI), attributes
        result = 0
        if name == '_pthread_attr_init':
            if not self.writable_file_memory(at, 64) or state['attributes'].get(at, {}).get('live'):
                raise ValueError('Owned cold SDK pthread attribute storage required')
            opaque = (0x54484441).to_bytes(8, 'little')+bytes(56)
            engine.mem_write(at, opaque)
            state['attributes'][at] = {'live': True, 'opaqueHex': opaque.hex(),
                'stackBytes': 0, 'detached': 1, 'inherit': 1, 'policy': 1,
                'priority': 31, 'quantum': 10, 'schedSet': False}
        elif name == '_pthread_create':
            attr = self._sdk_attribute(attributes)
            if (attr['policy'] != 4 or attr['inherit'] != 2 or attr['detached'] != 1 or
                    not attr['schedSet'] or not 15 <= attr['priority'] <= 47 or not attr['stackBytes'] or
                    len(state['contexts']) >= state['maximumSdkContexts']):
                raise ValueError('Explicit bounded joinable SDK FIFO thread attributes required')
            metadata = {key: attr[key] for key in
                ['stackBytes', 'detached', 'inherit', 'policy', 'priority', 'quantum']}
            metadata.update({'source': 'original-sdk-pthread-wrapper', 'osSchedulingApplied': False})
            handle = self.create_owned_cooperative_context(engine, at,
                engine.reg_read(r.UC_X86_REG_RDX), engine.reg_read(r.UC_X86_REG_RCX),
                stack_bytes=attr['stackBytes'], platform_attributes=metadata, maximum_contexts=16)
            state['contexts'].append(handle)
            state['calls'].append({'name': name, 'callerRva': caller, 'attribute': attributes,
                'handle': handle, 'result': 0})
            engine.reg_write(r.UC_X86_REG_RAX, 0)
            self.ret()
            return
        else:
            attr = self._sdk_attribute(at)
            if name == '_pthread_attr_destroy':
                self.put(at, 'Q', 0)
                attr['live'] = False
            elif name == '_pthread_attr_setstacksize':
                if not 0x4000 <= value <= 0x200000 or value % 0x1000:
                    result = 22
                else:
                    attr['stackBytes'] = value
            elif name in ['_pthread_attr_setdetachstate', '_pthread_attr_setinheritsched']:
                if value not in [1, 2]:
                    result = 22
                else:
                    attr['detached' if name == '_pthread_attr_setdetachstate' else 'inherit'] = value
            elif name == '_pthread_attr_setschedpolicy':
                if value not in [1, 2, 4]:
                    result = 22
                else:
                    attr['policy'] = value
            elif name == '_pthread_attr_getschedparam':
                if not self.writable_file_memory(value, 8):
                    raise ValueError('Owned SDK scheduling parameter output required')
                self.put(value, 'ii', attr['priority'], attr['quantum'])
            elif name == '_pthread_attr_setschedparam':
                if not self.writable_file_memory(value, 8):
                    raise ValueError('Owned SDK scheduling parameter input required')
                attr['priority'] = int.from_bytes(engine.mem_read(value, 4), 'little', signed=True)
                attr['quantum'] = int.from_bytes(engine.mem_read(value+4, 4), 'little', signed=True)
                attr['schedSet'] = True
            elif name == '_pthread_attr_getinheritsched':
                if not self.writable_file_memory(value, 4):
                    raise ValueError('Owned SDK inherited scheduling output required')
                self.put(value, 'I', attr['inherit'])
        state['calls'].append({'name': name, 'callerRva': caller, 'attribute': at,
            'value': value, 'result': result})
        engine.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()

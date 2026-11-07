"""Original character/resource reflection, extending the VFX asset reader.

The character initializer also zeroes a bounded data-image region through the C
bzero import. That standard memory operation is scoped to this initializer;
the original VFX loader's existing ownership contract remains unchanged.
"""
import unicorn
from unicorn import x86_const as r
from vfx_system_asset_native import NativeVfxSystemAssets
from vfx_asset_native import REGISTRY, WRAPPER, STREAM, VTABLE, CALLBACK, CONTEXT, CACHE


class NativeEffectResolverAssets(NativeVfxSystemAssets):
    def __init__(self, *args):
        self.initializing_resource_types = False
        self.resource_global_zeroes = []
        self.resource_stack_probes = []
        super().__init__(*args)
        self.resolver_chain_stop = False
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.stop_before_global_resolver,
            begin=self.base+0x377a2d, end=self.base+0x377a2d)
        self.resolver_allocator_calls = []
        for at in [0x149a460, 0x149a4c0]:
            entry = next(v for v in self.profile['modeledServices'] if v['rva'] == at)
            if entry['service'] != 'bounded byte allocation in RDI':
                raise ValueError('Resource map allocation ABI differs')
            self.u.hook_add(unicorn.UC_HOOK_CODE, self.resolver_allocate,
                begin=self.base+at, end=self.base+at)
        self.initializing_resource_types = True
        try:
            self.call(0x167ce00, {})
        finally:
            self.initializing_resource_types = False
        count = self.u32(self.base+REGISTRY+8)
        if not 318 <= count <= 2048:
            raise ValueError('Character reflection type count exceeds bounds')
        array = self.q(self.base+REGISTRY)
        self.types = {}
        for i in range(count):
            pointer = self.q(array+i*8)
            if not self.base+0x1fef000 <= pointer <= self.base+len(self.image)-0x88:
                raise ValueError('Character reflection descriptor is outside static data')
            identity = self.u32(pointer+8)
            if identity in self.types:
                raise ValueError('Duplicate original character reflection identity')
            self.types[identity] = pointer
        self.type_catalog = self.catalog()
        for identity in [0xef3a0f33, 0x72a165de, 0xe9212d72]:
            if identity not in self.types:
                raise ValueError('Original resource resolver type missing')
        self.baseline_heap = self.next_heap
        self.baseline_allocations = dict(self.allocations)
        self.system_baseline = bytes(self.u.mem_read(0x10400000, self.baseline_heap-0x10400000))

    def resolver_allocate(self, uc, address, size, user):
        size = uc.reg_read(r.UC_X86_REG_RDI)
        result = self.allocate(size, 0xa5)
        self.resolver_allocator_calls.append({'rva': address-self.base, 'bytes': size, 'result': result})
        uc.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()

    def reject(self, uc, address, size, user):
        if address-self.base not in [0x149a460, 0x149a4c0]:
            return super().reject(uc, address, size, user)

    def check_block(self, uc, address, size, user):
        if address-self.base not in [0x149a460, 0x149a4c0]:
            return super().check_block(uc, address, size, user)

    def read_resolver_fields(self, fields):
        descriptor = self.types[0xef3a0f33]
        size = self.q(descriptor+0x40)
        if size != 24:
            raise ValueError('Original ResourceResolver size differs')
        obj = self.allocate(size)
        self.u.mem_write(WRAPPER, bytes(0x500))
        self.put(WRAPPER, 'Q', STREAM)
        self.put(STREAM, 'Q', VTABLE)
        for i, offset in enumerate([0x10, 0x28, 0x30]):
            self.put(VTABLE+offset, 'Q', CALLBACK+i*16)
        self.ignored, self.mismatched, self.stream_calls = [], [], []
        self.loading = True
        try:
            self.call(self.q(descriptor+0x20)-self.base, {r.UC_X86_REG_RDI: obj})
            for field in fields:
                self.input, self.cursor = field, 0
                self.put(CACHE, 'Q', 0)
                self.call(0x14bc830, {r.UC_X86_REG_RDI: CONTEXT, r.UC_X86_REG_RSI: obj,
                    r.UC_X86_REG_RDX: descriptor, r.UC_X86_REG_RCX: WRAPPER, r.UC_X86_REG_R8: CACHE})
                if self.cursor != len(field):
                    raise ValueError('Resource resolver field has unread serialized bytes')
        finally:
            self.loading = False
        if self.ignored or self.mismatched:
            raise ValueError('Original resource resolver skipped serialized fields')
        pointer, count = self.q(obj+8), self.u32(obj+0x10)
        if count > 65536 or count and not self.library_pointer(pointer, count*16):
            raise ValueError('Original resource map is outside owned bounds')
        rows = [{'key': self.u32(pointer+i*16), 'value': self.q(pointer+i*16+8)} for i in range(count)]
        if [v['key'] for v in rows] != sorted(set(v['key'] for v in rows)):
            raise ValueError('Original resource map is not sorted and unique')
        return {'object': obj, 'objectHex': bytes(self.u.mem_read(obj, size)).hex(),
            'mapAddress': pointer, 'mapBytesHex': bytes(self.u.mem_read(pointer, count*16)).hex(),
            'rows': rows, 'streamCalls': len(self.stream_calls),
            'pendingLinkCount': self.u32(CONTEXT+0x10)}

    def lookup_resource(self, obj, key):
        if type(key) is not int or not 0 <= key <= 0xffffffff:
            raise ValueError('Unsigned resource lookup key required')
        if self.q(self.q(obj)+0x28)-self.base != 0x16153d0:
            raise ValueError('Original resource lookup vtable slot differs')
        self.put(0x100e8000, 'I', key)
        self.put(0x100e8010, 'Q', 0)
        self.call(0x16153d0, {r.UC_X86_REG_RDI: obj,
            r.UC_X86_REG_RSI: 0x100e8000, r.UC_X86_REG_RDX: 0x100e8010})
        return {'found': bool(self.u.reg_read(r.UC_X86_REG_RAX)&255),
                'value': self.q(0x100e8010)}

    def stop_before_global_resolver(self, uc, address, size, user):
        if self.resolver_chain_stop:
            uc.emu_stop()

    def resolve_auxiliary_chain(self, key, objects):
        if type(key) is not int or not 0 <= key <= 0xffffffff or not 0 < len(objects) <= 64:
            raise ValueError('Bounded explicit resource chain required')
        first = next((obj for obj in objects if self.lookup_resource(obj, key)['found']), None)
        vectors, array, selected = 0x100e9000, 0x100ea000, 0x100eb000
        self.u.mem_write(vectors, bytes(0x40))
        for i, obj in enumerate(objects):
            self.put(array+i*8, 'Q', obj)
        self.put(vectors+0x20, 'QQQ', array, array+len(objects)*8, array+len(objects)*8)
        self.put(selected, 'Q', 0)
        # The complete original resolver is used with explicitly empty unit
        # contexts. On a miss, stop before its unresolved global lookup stages.
        self.resolver_chain_stop = first is None
        try:
            self.call(0x377890, {r.UC_X86_REG_RDI: key, r.UC_X86_REG_RSI: vectors,
                r.UC_X86_REG_RDX: vectors+0x20, r.UC_X86_REG_RCX: 0,
                r.UC_X86_REG_R8: selected}, 0x377a2d if first is None else None)
        finally:
            self.resolver_chain_stop = False
        value = self.u.reg_read(r.UC_X86_REG_RAX) if first is not None else None
        owner = self.q(selected)
        if first is not None and (owner != first or value != self.lookup_resource(first, key)['value']):
            raise ValueError('Original auxiliary chain did not choose its first authored match')
        return {'status': 'matched-authored-reference' if first is not None else 'continue-global-resolution',
                'value': value, 'owner': owner if first is not None else None}

    def imported(self, uc, address, size, user):
        name = self.source.imports[address-self.base]
        if name == '____chkstk_darwin' and self.initializing_resource_types:
            count = uc.reg_read(r.UC_X86_REG_RAX)
            stack = uc.reg_read(r.UC_X86_REG_RSP)
            caller = self.q(stack)-self.base
            if not 0 < count <= 0x7000 or not 0x10008000 <= stack-count <= stack <= 0x10010008 or not 0 <= caller < 0x1fef000:
                raise ValueError('Character reflection stack probe exceeds owned stack/code')
            for at in range(stack-count, stack+1, 4096):
                self.u.mem_read(at, 1)
            self.resource_stack_probes.append({'bytes': count, 'callerRva': caller})
            self.ret()
            return
        if name == '___bzero' and self.initializing_resource_types:
            target = uc.reg_read(r.UC_X86_REG_RDI)
            count = uc.reg_read(r.UC_X86_REG_RSI)
            caller = self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
            if self.base+0x1fef000 <= target <= self.base+len(self.image)-count:
                if not 0 < count <= 0x100000 or not 0x167ce00 <= caller < 0x1687e20:
                    raise ValueError('Character initializer bzero exceeds its original data/callsite bounds')
                self.u.mem_write(target, bytes(count))
                self.resource_global_zeroes.append({'targetRva': target-self.base, 'bytes': count, 'callerRva': caller})
                self.ret()
                return
        return super().imported(uc, address, size, user)

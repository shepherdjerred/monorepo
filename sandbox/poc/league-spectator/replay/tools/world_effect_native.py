"""Original shared world-effect helper over an explicit prepared definition.

This supplies a one-entry resource resolver and an empty unit vector. It does
not infer live unit stacks, decoded descriptor finalization or attachments.
"""
from unicorn import x86_const as r
from parent_placement_native import NativeParentPlacement
from vfx_spawn_native import ADDRESSES as A

VECTORS, POSITION, OUTPUT, AUXILIARIES = 0x100e6000, 0x100e6100, 0x100e6200, 0x100e6300


class NativeWorldEffects(NativeParentPlacement):
    def initialize_world_factory(self):
        world, config = self.allocate(0x168, 0xa5), self.allocate(0x60, 0xa5)
        self.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
        self.call(0x374c00, {})
        self.call(0x6143e0, {r.UC_X86_REG_RDI: config})
        if self.q(self.base+0x24722c0) != world or self.q(self.base+0x246c568) != config:
            raise ValueError('Original world factory singleton publication differs')
        return {'world': world, 'config': config,
            'worldHex': bytes(self.u.mem_read(world, 0x168)).hex(),
            'configHex': bytes(self.u.mem_read(config, 0x60)).hex()}

    def create_from_prepared_definition(self, key, position):
        if type(key) is not int or not 0 < key <= 0xffffffff or len(position) != 3:
            raise ValueError('An explicit authored resource key and world position are required')
        resolver, table = self.allocate(24, 0xa5), self.allocate(16, 0xa5)
        self.call(0x16659b0, {r.UC_X86_REG_RDI: resolver})
        self.put(table, 'IIQ', key, 0, A['definition'])
        self.put(resolver+8, 'QII', table, 1, 1)
        self.u.mem_write(VECTORS, bytes(0x40))
        self.put(AUXILIARIES, 'Q', resolver)
        self.put(VECTORS+0x20, 'QQQ', AUXILIARIES, AUXILIARIES+8, AUXILIARIES+8)
        self.put(POSITION, 'fff', *position)
        self.u.mem_write(OUTPUT, bytes(16))
        self.call(0x377550, {r.UC_X86_REG_RDI: OUTPUT, r.UC_X86_REG_RSI: key,
            r.UC_X86_REG_RDX: VECTORS, r.UC_X86_REG_RCX: VECTORS+0x20,
            r.UC_X86_REG_R8: 0, r.UC_X86_REG_R9: POSITION})
        shared, control = self.q(OUTPUT), self.q(OUTPUT+8)
        if self.allocations.get(shared) != 8 or self.allocations.get(control) != 0x20:
            raise ValueError('Original world helper did not return its owned shared pointer')
        wrapper = self.q(shared)
        if self.allocations.get(wrapper) != 0x268:
            raise ValueError('Original world helper created another entity class')
        obj = self.q(wrapper+0x178)
        if self.allocations.get(obj) != 0x238 or self.q(obj+0x48) != A['definition']:
            raise ValueError('World wrapper did not bind the selected prepared definition')
        if obj in self.object_addresses:
            raise ValueError('World helper reused a tracked particle object')
        self.object_addresses.append(obj)
        self.observe_objects()
        created = {'resolver': resolver, 'table': table, 'shared': shared, 'control': control,
            'wrapper': wrapper, 'object': obj, 'position': position, 'resourceKey': key,
            'wrapperHex': bytes(self.u.mem_read(wrapper, 0x268)).hex(),
            'objectHex': bytes(self.u.mem_read(obj, 0x238)).hex(),
            'worldHex': bytes(self.u.mem_read(self.q(self.base+0x24722c0), 0x168)).hex()}
        self.call(0x1765960, {r.UC_X86_REG_RDI: obj})
        ownership = self.own_parent(obj)
        synchronization = self.synchronize_placement(obj)
        return {**created, 'ownership': ownership, 'synchronization': synchronization,
            'activatedWrapperHex': bytes(self.u.mem_read(wrapper, 0x268)).hex(),
            'initialState': self.parent_state()}

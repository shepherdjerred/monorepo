"""Original map collision-provider prerequisite with one typed large allocation.

The map-loading caller 0x6102df supplies the embedded +0x246ccf0 provider.
Its +0x28 method dispatches to the spatial singleton published by 0x195dc0.
No game object fields, collision results, or readiness bits are supplied here.
"""
from unicorn import x86_const as r

BUCKET_BYTES = 0x1000000


class NativeNavgridCollisionArena:
    def __init__(self, *args, **kwargs):
        self.navgrid_collision_initializing = False
        self.navgrid_collision_allocations = []
        self.navgrid_collision_fills = []
        super().__init__(*args, **kwargs)

    def allocate(self, size, fill=0):
        if size != BUCKET_BYTES:
            return super().allocate(size, fill)
        caller = self.q(self.u.reg_read(r.UC_X86_REG_RSP)) - self.base
        arena = self.asset_arena
        if (not self.navgrid_collision_initializing or caller != 0x1ab8e0 or
                arena is None or self.navgrid_collision_allocations):
            raise ValueError('Spatial bucket allocation requires its original scoped constructor caller')
        address = max(arena['start'], self.next_heap)
        after = (address + size + 15) & ~15
        if after > arena['end']:
            raise ValueError('Spatial buckets exceed the owned supplemental arena')
        self.u.mem_write(address, bytes([fill]) * size)
        self.allocations[address] = size
        self.asset_arena_starts.append(address)
        self.next_heap = after
        arena['allocations'] += 1
        arena['requestedBytes'] += size
        arena['highWater'] = after
        self.navgrid_collision_allocations.append({'address': address, 'bytes': size,
                                                   'originalCallerRva': caller})
        return address

    def imported(self, engine, address, size, user):
        name = self.source.imports[address - self.base]
        count = engine.reg_read(r.UC_X86_REG_RSI)
        if name != '___bzero' or count != BUCKET_BYTES:
            return super().imported(engine, address, size, user)
        destination = engine.reg_read(r.UC_X86_REG_RDI)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP)) - self.base
        if (not self.navgrid_collision_initializing or caller != 0x1ab7b8 or
                len(self.navgrid_collision_allocations) != 1 or
                destination != self.navgrid_collision_allocations[0]['address'] or
                not self.owns_asset_bytes(destination, count)):
            raise ValueError('Spatial bucket fill escaped its original constructor and owned allocation')
        engine.mem_write(destination, bytes(count))
        self.navgrid_collision_fills.append({'address': destination, 'bytes': count,
                                             'originalCallerRva': caller})
        self.library_calls.append({'name': name, 'result': 0, 'bytes': count})
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()


def initialize_navgrid_collision_provider(n):
    provider = n.base + 0x246ccf0
    product = n.q(n.base + 0x24728c0)
    if (not product or n.u32(product + 8) != 1 or n.q(n.base + 0x255b730) or
            n.q(provider) != n.base + 0x2302f70 or
            n.q(n.base + 0x2302f98) != n.base + 0x1966a0):
        raise ValueError('Cold original LoL spatial singleton and recovered map provider required')
    n.navgrid_collision_initializing = True
    try:
        n.call(0x195dc0, {})
    finally:
        n.navgrid_collision_initializing = False
    spatial = n.q(n.base + 0x255b730)
    expected = [7, 6, 65536, 15, 65535, 512, 512, 1024, 1024, 262143, 1048575]
    if (n.allocations.get(spatial) != 0x4068 or
            [n.u32(spatial + offset) for offset in range(0, 0x2c, 4)] != expected or
            len(n.navgrid_collision_allocations) != 1 or len(n.navgrid_collision_fills) != 1):
        raise ValueError('Original spatial constructor layout/allocation differs')
    buckets = n.q(spatial + 0x40)
    if (buckets != n.navgrid_collision_allocations[0]['address'] or
            n.u32(spatial + 0x48) != 1048576 or not n.owns_asset_bytes(buckets, BUCKET_BYTES) or
            any(n.u.mem_read(buckets, BUCKET_BYTES))):
        raise ValueError('Original spatial bucket vector differs or is not empty')
    return {'provider': provider, 'spatial': spatial, 'buckets': buckets,
            'originalMapProviderCallerRva': 0x6102df, 'originalMapWrapperRva': 0x16bd5d0,
            'originalInitializerRva': 0x195dc0, 'originalConstructorRva': 0x1ab620,
            'originalProviderQueryRva': 0x1966a0, 'bucketBytes': BUCKET_BYTES,
            'constructorParameters': expected[:4], 'collisionResultsSupplied': False,
            'gameObjectFieldsSupplied': False, 'coldSpatialWorld': True}

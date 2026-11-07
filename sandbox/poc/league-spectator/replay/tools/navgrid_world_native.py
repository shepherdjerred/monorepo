"""Original navgrid manager/loading over a bounded, owned read-only stream."""
import struct
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES

CALLBACK_START = 0x10320000


class NativeNavgridStream:
    def __init__(self, *args):
        self.navgrid_stream = None
        super().__init__(*args)

    def check_block(self, uc, address, size, user):
        if CALLBACK_START <= address < CALLBACK_START + 0x30:
            return
        return super().check_block(uc, address, size, user)

    def open_navgrid_stream(self, data):
        if self.navgrid_stream is not None or not isinstance(data, bytes) or not 3 <= len(data) <= 32 * 1024 * 1024:
            raise ValueError('A single bounded immutable navgrid stream is required')
        if (any(a < CALLBACK_START + 0x30 and a + size > CALLBACK_START for a, size in self.allocations.items()) or
                any(self.u.mem_read(CALLBACK_START, 0x30))):
            raise ValueError('Navgrid stream callbacks require unused owned scratch')
        stream, table = self.allocate(0x28), self.allocate(0x38)
        state = {'object': stream, 'bytes': data, 'position': 0, 'reads': [], 'seeks': []}
        self.navgrid_stream = state
        self.put(stream, 'Q', table)

        def operation(engine, address, size, user):
            if engine.reg_read(r.UC_X86_REG_RDI) != stream:
                raise ValueError('Original navgrid selected a different input stream')
            index = (address - CALLBACK_START) // 16
            if index == 0:
                destination, count = engine.reg_read(r.UC_X86_REG_RSI), engine.reg_read(r.UC_X86_REG_RDX)
                start = state['position']
                if count > len(data) - start or count and not self.writable_file_memory(destination, count):
                    raise ValueError('Original navgrid stream read escaped source or owned output')
                if count:
                    engine.mem_write(destination, data[start:start + count])
                state['position'] += count
                state['reads'].append({'offset': start, 'bytes': count})
                engine.reg_write(r.UC_X86_REG_RAX, count)
            elif index == 1:
                engine.reg_write(r.UC_X86_REG_RAX, state['position'])
            elif index == 2:
                position = engine.reg_read(r.UC_X86_REG_RSI)
                if position > len(data):
                    raise ValueError('Original navgrid seek escaped its input')
                state['seeks'].append({'from': state['position'], 'to': position})
                state['position'] = position
            else:
                raise ValueError('Unknown navgrid stream operation')
            self.ret()

        for index, offset in enumerate([0x10, 0x28, 0x30]):
            callback = CALLBACK_START + index * 16
            self.u.mem_write(callback, b'\xc3')
            self.put(table + offset, 'Q', callback)
            self.u.hook_add(unicorn.UC_HOOK_CODE, operation, begin=callback, end=callback)
        return stream


def initialize_navgrid_world(fixture, owner_context=0):
    n = fixture.native
    if owner_context not in [0, n.base + 0x246ccf0]:
        raise ValueError('Navgrid owner must be absent or the recovered original map provider')
    if owner_context and (n.q(owner_context) != n.base + 0x2302f70 or
                          n.q(n.base + 0x2302f98) != n.base + 0x1966a0 or
                          not n.q(n.base + 0x255b730)):
        raise ValueError('Recovered navgrid provider requires its original spatial initialization')
    scene = fixture.read(fixture.cache / 'public/latest-scene/manifest.json')
    data = fixture.raw(fixture.cache / 'research/latest-map12.aimesh_ngrid')
    heights = fixture.raw(fixture.cache / 'public/latest-scene/heights.bin')
    from vfx_spawn_native import sha
    if (scene['build'] != n.profile['clientVersion'] or scene['protocol'] != n.profile['protocolDigest'] or
            scene['map']['id'] != 12 or sha(data) != scene['map']['heightGrid']['sourceSha256']):
        raise ValueError('Matching exact-build Map12 navgrid and scene required')
    if n.q(n.base + 0x246c948):
        raise ValueError('Original navgrid manager must be cold')
    stream = n.open_navgrid_stream(data)
    manager = n.allocate(0x130)
    n.u.mem_write(manager + 0x30, b'\xa5' * 0x100)
    n.call(0x16b3670, {r.UC_X86_REG_RDI: manager})
    if n.q(n.base + 0x246c948) != manager or n.q(manager + 8):
        raise ValueError('Original navgrid manager publication/empty data differs')
    n.call(0x16b9530, {})
    if n.u.reg_read(r.UC_X86_REG_RAX) & 0xff:
        raise ValueError('Original navgrid ready predicate is true before loading')
    record = {'manager': manager, 'originalManagerConstructorRva': 0x16b3670,
              'originalLoaderRva': 0x16b6ef0, 'ownerContextInput': owner_context or None,
              'completed': False, 'slices': [], 'sourceBytes': len(data)}
    n.navgrid_world_observation = record
    n.u.context_restore(n.initial)
    n.put(ADDRESSES['stack'], 'Q', ADDRESSES['stop'])
    for register, value in {r.UC_X86_REG_RSP: ADDRESSES['stack'], r.UC_X86_REG_RDI: manager,
                            r.UC_X86_REG_RSI: owner_context, r.UC_X86_REG_RDX: stream}.items():
        n.u.reg_write(register, value)
    start = n.base + 0x16b6ef0
    for index in range(64):
        n.u.emu_start(start, ADDRESSES['stop'], count=5000000)
        start = n.u.reg_read(r.UC_X86_REG_RIP)
        record['slices'].append({'slice': index + 1, 'instructionBound': 5000000,
                                 'streamPosition': n.navgrid_stream['position'], 'stop': start})
        if start == ADDRESSES['stop']:
            break
    else:
        raise ValueError('Original navgrid loading exceeds sixty-four bounded CPU slices')
    runtime = n.q(manager + 8)
    if (n.allocations.get(runtime) != 0x708 or n.q(runtime + 0x6f0) != manager or
            n.q(runtime + 0x6f8) != owner_context):
        raise ValueError('Original navgrid allocation/manager/optional owner differs')
    dimensions = list(struct.unpack('<IIff', n.u.mem_read(runtime + 0x100, 16)))
    grid = scene['map']['heightGrid']
    if dimensions != [grid['x'], grid['z'], *grid['step']]:
        raise ValueError('Original complete navgrid dimensions differ from the prepared scene')
    pointer = n.q(runtime + 0xf8)
    if bytes(n.u.mem_read(pointer, len(heights))) != heights:
        raise ValueError('Original complete navgrid heights differ from the prepared scene')
    n.call(0x16b9530, {})
    # C++ bool is returned in AL. SETNE leaves the pointer's other RAX bits
    # intact; the original hero handler also tests AL, not the whole register.
    predicate = n.u.reg_read(r.UC_X86_REG_RAX) & 0xff
    if predicate != 1:
        raise ValueError('Original navgrid ready predicate remains false after complete loading')
    if bytes(n.u.mem_read(manager + 0x30, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original navgrid manager escaped its guarded allocation')
    record.update(completed=True, runtime=runtime, dimensions=dimensions,
                  sourcePosition=n.navgrid_stream['position'], heightsMatch=True,
                  originalReadyPredicate=True, readinessBitsSupplied=False,
                  readyBeforeLoad=False, readyReturnLowByte=predicate,
                  ownerContextRecovered=bool(owner_context), collisionQueriesVerified=False,
                  acceptedReplayEntities=False, mainViewerExpanded=False)
    return record

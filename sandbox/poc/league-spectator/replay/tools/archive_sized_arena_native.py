"""Extend the owned supplemental arena to the existing WAD byte-buffer bound."""
from unicorn import x86_const as r
from wad_file_native import NativeWadFiles

MAX_ARCHIVE_BYTES = 0x800000


class NativeArchiveSizedArena:
    def __init__(self, *args, **kwargs):
        self.archive_sized_allocations = []
        super().__init__(*args, **kwargs)
        if not isinstance(self, NativeWadFiles):
            raise ValueError('Archive-sized arena requires the bounded WAD byte-buffer ABI')

    def initialize_asset_arena(self, extra_mib):
        super().initialize_asset_arena(extra_mib)
        self.asset_arena['maximumAllocationBytes'] = MAX_ARCHIVE_BYTES
        return dict(self.asset_arena)

    def allocate(self, size, fill=0):
        arena = self.asset_arena
        if arena is None or size < 0x100000 or self.next_heap + size <= arena['start']:
            return super().allocate(size, fill)
        if not 0x100000 <= size <= MAX_ARCHIVE_BYTES:
            raise ValueError('Archive-sized allocation exceeds the existing WAD byte-buffer bound')
        address = max(arena['start'], self.next_heap)
        after = (address + size + 15) & ~15
        if after > arena['end']:
            raise ValueError('Archive-sized allocation exceeds supplemental arena capacity')
        self.u.mem_write(address, bytes([fill]) * size)
        self.allocations[address] = size
        self.asset_arena_starts.append(address)
        self.next_heap = after
        arena['allocations'] += 1
        arena['requestedBytes'] += size
        arena['highWater'] = after
        self.archive_sized_allocations.append({'address': address, 'bytes': size})
        return address

    def imported(self, engine, address, size, user):
        name = self.source.imports[address - self.base]
        if name not in ['___bzero', '_memset_pattern16'] or self.asset_arena is None:
            return super().imported(engine, address, size, user)
        destination = engine.reg_read(r.UC_X86_REG_RDI)
        count = engine.reg_read(r.UC_X86_REG_RSI if name == '___bzero' else r.UC_X86_REG_RDX)
        if destination < self.asset_arena['start'] or count < 0x100000:
            return super().imported(engine, address, size, user)
        if count > MAX_ARCHIVE_BYTES or not self.owns_asset_bytes(destination, count):
            raise ValueError('Archive-sized fill escaped its single owned allocation')
        pattern = None
        if name == '_memset_pattern16':
            source = engine.reg_read(r.UC_X86_REG_RSI)
            if not self.library_pointer(source, 16):
                raise ValueError('Archive-sized pattern source escaped owned memory')
            pattern = bytes(engine.mem_read(source, 16))
        raw = bytes(count) if pattern is None else (pattern * ((count + 15) // 16))[:count]
        engine.mem_write(destination, raw)
        self.library_calls.append({'name': name, 'result': 0, 'bytes': count})
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()

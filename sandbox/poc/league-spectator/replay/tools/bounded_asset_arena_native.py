"""Optional additional owned data memory for composite native asset controls.

The original particle fixture keeps its small arena. Composite loading may opt
into a separate bounded RW region; allocations and accesses must remain owned.
This retains the existing bump allocator's explicit no-reuse platform policy.
"""
import unicorn
from bisect import bisect_right
from unicorn import x86_const as r


class NativeBoundedAssetArena:
    def __init__(self, *args, **kwargs):
        self.asset_arena = None
        self.asset_arena_starts = []
        super().__init__(*args, **kwargs)

    def initialize_asset_arena(self, extra_mib):
        if self.asset_arena is not None or extra_mib not in [32, 64, 128]:
            raise ValueError('One explicit bounded asset arena capacity required')
        start = 0x12000000
        end = start + extra_mib * 1024 * 1024
        if any(first < end and last + 1 > start for first, last, _ in self.u.mem_regions()):
            raise ValueError('Additional asset arena overlaps an existing native mapping')
        self.u.mem_map(start, end - start, unicorn.UC_PROT_READ | unicorn.UC_PROT_WRITE)
        self.asset_arena = {'start': start, 'end': end, 'additionalMiB': extra_mib,
                            'allocations': 0, 'requestedBytes': 0, 'highWater': start,
                            'executable': False, 'freedStorageReused': False}
        return dict(self.asset_arena)

    def allocate(self, size, fill=0):
        arena = self.asset_arena
        if arena is None or self.next_heap + size <= arena['start']:
            return super().allocate(size, fill)
        if not 0 < size < 0x100000:
            raise ValueError('Composite asset allocation exceeds its per-allocation bound')
        address = max(arena['start'], self.next_heap)
        after = (address + size + 15) & ~15
        if after > arena['end']:
            raise ValueError('Composite asset arena capacity exceeded')
        self.u.mem_write(address, bytes([fill]) * size)
        self.allocations[address] = size
        self.asset_arena_starts.append(address)
        self.next_heap = after
        arena['allocations'] += 1
        arena['requestedBytes'] += size
        arena['highWater'] = after
        return address

    def owns_asset_bytes(self, address, size):
        arena = self.asset_arena
        if arena is None or size < 0 or not arena['start'] <= address <= arena['end'] - size:
            return False
        index = bisect_right(self.asset_arena_starts, address) - 1
        if index < 0:
            return False
        first = self.asset_arena_starts[index]
        return address <= first + self.allocations[first] - size

    def library_pointer(self, address, size):
        return super().library_pointer(address, size) or self.owns_asset_bytes(address, size)

    def writable_file_memory(self, address, size):
        return self.owns_asset_bytes(address, size) or super().writable_file_memory(address, size)

    def imported(self, engine, address, size, user):
        destination = engine.reg_read(r.UC_X86_REG_RDI)
        name = self.source.imports[address - self.base]
        if (self.asset_arena is None or destination < self.asset_arena['start'] or
                name not in ['___bzero', '_memset_pattern16']):
            return super().imported(engine, address, size, user)
        count = engine.reg_read(r.UC_X86_REG_RSI if name == '___bzero' else r.UC_X86_REG_RDX)
        if count > 0x100000 or not self.owns_asset_bytes(destination, count):
            raise ValueError('Composite asset fill escaped its owned allocation')
        pattern = None
        if name == '_memset_pattern16':
            source = engine.reg_read(r.UC_X86_REG_RSI)
            if not self.library_pointer(source, 16):
                raise ValueError('Composite pattern fill escaped its owned source')
            pattern = bytes(engine.mem_read(source, 16))
        if count:
            raw = bytes(count) if pattern is None else (pattern * ((count + 15) // 16))[:count]
            engine.mem_write(destination, raw)
        self.library_calls.append({'name': name, 'result': 0})
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()

    def service(self, engine, address, size, user):
        entry = address - self.base
        copies = [0x1fee65a, 0x1fee660, 0x1feea44, 0x1feea4a]
        sets = [0x1fee666, 0x1feea50]
        destination = engine.reg_read(r.UC_X86_REG_RDI)
        if self.asset_arena is None or destination < self.asset_arena['start'] or entry not in copies + sets:
            return super().service(engine, address, size, user)
        source = engine.reg_read(r.UC_X86_REG_RSI)
        count = engine.reg_read(r.UC_X86_REG_RDX)
        if not self.owns_asset_bytes(destination, count):
            raise ValueError('Composite asset copy/set escaped its owned allocation')
        if entry in copies and count and not self.library_pointer(source, count):
            raise ValueError('Composite asset copy escaped its owned source')
        self.services[hex(entry)] = self.services.get(hex(entry), 0) + 1
        if count:
            raw = bytes([source & 255]) * count if entry in sets else bytes(engine.mem_read(source, count))
            engine.mem_write(destination, raw)
        engine.reg_write(r.UC_X86_REG_RAX, destination)
        self.ret()

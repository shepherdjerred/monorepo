"""Map asset compilation with the observed native byte-buffer reserve ABI.

The original 0x14a9410 copies the byte count at +8, replaces the pointer at +0
and capacity at +12, and releases a previously owned buffer. Its allocator lazily
reserves 512 MB through mmap. Model this memory-only operation in the existing
bounded arena; all field decoding, resizing/zeroing and postload stay original.
This extension is deliberately outside the frozen champion asset compiler.
"""
import unicorn
from unicorn import x86_const as r
from vfx_system_asset_native import NativeVfxSystemAssets
from vfx_spawn_native import sha

RESERVE_RVA = 0x14a9410
RESERVE_END_RVA = 0x14a95a0


class NativeMapVfxSystemAssets(NativeVfxSystemAssets):
    def __init__(self, *args):
        super().__init__(*args)
        self.map_buffer_reserves = []
        self.map_memory_service = {
            'rva': RESERVE_RVA, 'endRva': RESERVE_END_RVA,
            'sourceSha256': sha(self.image[RESERVE_RVA:RESERVE_END_RVA]),
            'service': 'bounded byte-buffer reserve',
            'header': {'pointer': 0, 'countU32': 8, 'capacityU32': 12},
            'arguments': ['RDI=owned header', 'RSI=requested byte capacity'],
            'return': 'void; volatile registers unspecified',
            'uninitializedBytes': '0xa5 diagnostic fill',
            'scope': 'offline map asset compilation only',
        }
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.reserve_map_bytes,
            begin=self.base+RESERVE_RVA, end=self.base+RESERVE_RVA)

    def reserve_map_bytes(self, uc, address, size, user):
        if not self.loading:
            raise ValueError('Map byte-buffer service outside asset read/postload')
        header = uc.reg_read(r.UC_X86_REG_RDI)
        requested = uc.reg_read(r.UC_X86_REG_RSI)
        if not any(start <= header and header+16 <= start+length
                   for start,length in self.allocations.items()):
            raise ValueError('Map byte-buffer header is not owned')
        pointer, count, capacity = self.q(header), self.u32(header+8), self.u32(header+12)
        if not 0 < requested < 0x100000 or count > requested or count > (capacity & 0x7fffffff):
            raise ValueError('Map byte-buffer count/capacity exceeds bounds')
        if pointer and not any(start <= pointer and pointer+count <= start+length
                               for start,length in self.allocations.items()):
            raise ValueError('Map byte-buffer source is not owned')
        if count and not pointer:
            raise ValueError('Map byte-buffer count has no source')
        if pointer and not capacity & 0x80000000 and pointer not in self.allocations:
            raise ValueError('Map byte-buffer release is not an allocation base')
        result = self.allocate(requested, 0xa5)
        if count:
            self.u.mem_write(result, bytes(self.u.mem_read(pointer,count)))
        self.put(header,'Q',result)
        self.put(header+12,'I',requested)
        self.map_buffer_reserves.append({'header':header,'oldPointer':pointer,'count':count,
            'oldCapacity':capacity,'requested':requested,'result':result})
        self.ret()

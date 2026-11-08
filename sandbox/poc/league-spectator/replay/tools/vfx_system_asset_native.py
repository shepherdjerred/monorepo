"""Complete authored VFX system roots through the original field/post-load code.

This extends the frozen emitter loader without changing its package or results.
Root data and all embedded definitions remain intact; no runtime admission,
graphics acquisition or world registry is supplied.
"""
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_asset_native import OBJECT, WRAPPER, STREAM, VTABLE, CALLBACK, CONTEXT, CACHE

SYSTEM_TYPE = 0x45cd899f


class NativeVfxSystemAssets(NativeVfxPostload):
    def __init__(self, *args):
        super().__init__(*args)
        self.system_type = self.types[SYSTEM_TYPE]
        self.system_size = self.q(self.system_type + 0x40)
        if self.system_size != 0x160 or self.q(self.system_type + 0x20) - self.base != 0x1786e80:
            raise ValueError('Unsupported original VFX system root')
        self.system_baseline = bytes(self.u.mem_read(0x10400000, self.baseline_heap - 0x10400000))

    def load_system(self, fields):
        if self.arena_before is not None:
            raise ValueError('System post-load transaction still active')
        for page, raw in self.dirty_pages.items(): self.u.mem_write(page, raw)
        self.dirty_pages = {}
        self.next_heap, self.allocations = self.baseline_heap, dict(self.baseline_allocations)
        self.heap_high_water = self.baseline_heap
        self.mutexes = dict(self.baseline_mutexes)
        self.u.mem_write(0x10400000, self.system_baseline)
        self.u.mem_write(OBJECT, bytes([0xa5]) * 0x470)
        self.u.mem_write(WRAPPER, bytes(0x500))
        self.put(WRAPPER, 'Q', STREAM); self.put(STREAM, 'Q', VTABLE)
        for i, offset in enumerate([0x10, 0x28, 0x30]): self.put(VTABLE + offset, 'Q', CALLBACK + i * 16)
        self.ignored, self.mismatched, self.stream_calls = [], [], []
        self.loading = True
        try:
            self.call(0x1786e80, {r.UC_X86_REG_RDI: OBJECT})
            for field in fields:
                self.input, self.cursor = field, 0; self.put(CACHE, 'Q', 0)
                self.call(0x14bc830, {r.UC_X86_REG_RDI: CONTEXT, r.UC_X86_REG_RSI: OBJECT,
                    r.UC_X86_REG_RDX: self.system_type, r.UC_X86_REG_RCX: WRAPPER, r.UC_X86_REG_R8: CACHE})
                if self.cursor != len(field): raise ValueError('System field reader left trailing bytes')
        finally:
            self.loading = False
        return {'objectHex': bytes(self.u.mem_read(OBJECT, self.system_size)).hex(),
            'heapHex': bytes(self.u.mem_read(self.baseline_heap, self.next_heap - self.baseline_heap)).hex(),
            'heapStart': self.baseline_heap, 'ignored': list(self.ignored), 'mismatched': list(self.mismatched),
            'streamCalls': len(self.stream_calls)}

    def postload_system(self):
        if self.arena_before is not None: raise ValueError('Prior system post-load transaction still active')
        self.arena_before = bytes(self.u.mem_read(0x10400000, self.heap_high_water - 0x10400000))
        self.object_before = bytes(self.u.mem_read(OBJECT, 0x470))
        self.heap_before, self.allocations_before = self.next_heap, dict(self.allocations)
        self.visits = []; self.math_calls.clear()
        self.postloading = self.loading = True
        try:
            self.call(0x14bc490, {r.UC_X86_REG_RDI: OBJECT, r.UC_X86_REG_RSI: self.system_type})
        finally:
            self.postloading = self.loading = False
        return {'objectHex': bytes(self.u.mem_read(OBJECT, self.system_size)).hex(),
            'heapHex': bytes(self.u.mem_read(self.baseline_heap, self.next_heap - self.baseline_heap)).hex(),
            'heapStart': self.baseline_heap, 'visits': list(self.visits), 'mathCalls': list(self.math_calls),
            'pendingLinkFixups': self.u32(CONTEXT + 0x10)}

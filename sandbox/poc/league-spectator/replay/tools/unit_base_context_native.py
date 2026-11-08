"""Original named resource acquisition and unit base-context installation.

A prepared typed asset library is an explicit TLS input. The resource-path
formatting result and library-ready bit are supplied; full character loading,
global asset fallback, live hero state and VFX reference fixups are excluded.
"""
from unicorn import x86_const as r
from unit_resource_native import NativeUnitResources
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import ADDRESSES

TLS_DESCRIPTOR, TLS_CELL = 0x24882c8, 0x100f7000
PATH, FRAME, KEY = 0x100e0000, 0x100f5000, 0x100eb800


class NativeUnitBaseContexts(NativeUnitResources):
    original_string = NativeEffectContexts.original_string
    character_context = NativeEffectContexts.character_context

    def fragment(self, start, end, registers):
        self.call(start, registers, end)

    def __init__(self, *args):
        super().__init__(*args)
        self.slots[self.base+TLS_DESCRIPTOR] = TLS_CELL
        self.put(self.base+TLS_DESCRIPTOR, 'Q', ADDRESSES['tls'])
        self.put(TLS_CELL, 'Q', 0)

    def prepared_library(self, entries):
        if not entries or [x['identity'] for x in entries] != sorted(set(x['identity'] for x in entries)):
            raise ValueError('A nonempty sorted unique typed asset library is required')
        library, table = self.allocate(0x48), self.allocate(len(entries)*24)
        for index, entry in enumerate(entries):
            if (not 0 < entry['identity'] <= 0xffffffff or
                    entry['object'] not in self.allocations or entry['type'] not in self.types.values()):
                raise ValueError('Library entries must refer to owned original typed objects')
            self.put(table+index*24, 'QQII', entry['object'], entry['type'], entry['identity'], 0)
        self.put(library+0x10, 'QII', table, len(entries), len(entries))
        self.put(TLS_CELL, 'Q', library)
        return {'object': library, 'table': table, 'entries': entries}

    def lookup_prepared_entry(self, identity, present):
        self.put(KEY, 'I', identity)
        self.call(0x14b7950, {r.UC_X86_REG_RDI: 0, r.UC_X86_REG_RSI: KEY,
                            r.UC_X86_REG_RDX: 0}, None if present else 0x14b7a15)
        return self.u.reg_read(r.UC_X86_REG_RAX) if present else None

    def acquire_prepared_context(self, context, path):
        if not isinstance(path, str) or '\0' in path or len(path.encode('ascii')) > 1023:
            raise ValueError('A bounded exact resource-path formatting result is required')
        self.u.mem_write(PATH, path.encode('ascii')+b'\0')
        self.u.mem_write(FRAME-0x500, bytes(0x500))
        self.put(FRAME-0x378, 'Q', PATH)
        # Full asset loading is excluded. This explicit loaded-library predicate
        # admits only the original lookup/cast/store suffix on the supplied TLS
        # library. Missing keys must be checked at the separate global boundary.
        self.put(context+0x50, 'B', 1)
        self.call(0x3526ff, {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RBX: context,
                            r.UC_X86_REG_R14: context+0x50}, 0x352767)
        return {'identity': self.u32(FRAME-0x3e8), 'resolver': self.q(context+0x60),
                'ready': bool(self.u.mem_read(context+0x68, 1)[0])}

    def install_context(self, unit, context):
        if unit not in self.unit_resources or context and self.allocations.get(context) != 0x90:
            raise ValueError('Originally constructed owned unit/context required')
        self.call(0x548bf0, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: context})
        group = self.unit_resources[unit]
        return {'unit': unit, 'context': self.q(unit+0x110), 'baseResolver': self.q(group+0x10),
                'overlays': [self.q(at) for at in range(self.q(group+0x18), self.q(group+0x20), 8)]}

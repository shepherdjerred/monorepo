"""Original typed asset reference fixups over caller-owned asset libraries.

Resource maps and system roots are deserialized by the original typed reader in
one live arena. The library table is explicit fixture input; no global asset
registry, unit component, world factory or graphics callback is substituted.
"""
import unicorn
from unicorn import x86_const as r
from effect_resolver_native import NativeEffectResolverAssets
from vfx_asset_native import WRAPPER, STREAM, VTABLE, CALLBACK, CONTEXT, CACHE


class NativeEffectLinks(NativeEffectResolverAssets):
    def __init__(self, *args):
        super().__init__(*args)
        self.stop_missing_asset = False
        self.missing_asset_boundary = False
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.global_asset_boundary,
            begin=self.base+0x14bc000, end=self.base+0x14bc000)

    def global_asset_boundary(self, uc, address, size, user):
        if self.stop_missing_asset:
            self.missing_asset_boundary = True
            uc.emu_stop()

    def load_live_system(self, fields):
        if self.u32(CONTEXT+0x10):
            raise ValueError('Prior asset reference fixups remain outstanding')
        obj = self.allocate(self.system_size)
        self.u.mem_write(WRAPPER, bytes(0x500))
        self.put(WRAPPER, 'Q', STREAM)
        self.put(STREAM, 'Q', VTABLE)
        for i, offset in enumerate([0x10, 0x28, 0x30]):
            self.put(VTABLE+offset, 'Q', CALLBACK+i*16)
        self.ignored, self.mismatched, self.stream_calls = [], [], []
        self.loading = True
        try:
            self.call(0x1786e80, {r.UC_X86_REG_RDI: obj})
            for field in fields:
                self.input, self.cursor = field, 0
                self.put(CACHE, 'Q', 0)
                self.call(0x14bc830, {r.UC_X86_REG_RDI: CONTEXT,
                    r.UC_X86_REG_RSI: obj, r.UC_X86_REG_RDX: self.system_type,
                    r.UC_X86_REG_RCX: WRAPPER, r.UC_X86_REG_R8: CACHE})
                if self.cursor != len(field):
                    raise ValueError('Live system left unread serialized bytes')
            if self.ignored or self.mismatched or self.u32(CONTEXT+0x10):
                raise ValueError('Live system has skipped fields or unresolved external links')
            self.visits = []
            self.math_calls.clear()
            self.postloading = True
            try:
                self.call(0x14bc490, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: self.system_type})
            finally:
                self.postloading = False
        finally:
            self.loading = False
        if self.u32(CONTEXT+0x10):
            raise ValueError('Live system post-load left unresolved links')
        return {'object': obj, 'typeRva': self.system_type-self.base,
            'bytes': self.system_size, 'visits': len(self.visits),
            'objectHex': bytes(self.u.mem_read(obj, self.system_size)).hex()}

    def fix_resolver_links(self, loaded, entries):
        # The original loader queues {destination slot, expected type descriptor}
        # for every serialized linked reference, including an authored null.
        count, pending = self.u32(CONTEXT+0x10), self.q(CONTEXT+8)
        if count != len(loaded['rows']) or not self.library_pointer(pending, count*16):
            raise ValueError('Native resolver link queue differs from its loaded rows')
        links = [{'slot': self.q(pending+i*16), 'typeRva': self.q(pending+i*16+8)-self.base}
            for i in range(count)]
        if {v['slot'] for v in links} != {loaded['mapAddress']+i*16+8 for i in range(count)}:
            raise ValueError('Pending links do not cover exactly the original resolver map')
        identities = [v['identity'] for v in entries]
        if identities != sorted(set(identities)):
            raise ValueError('Typed asset library must be sorted and unique')
        library = self.allocate(0x48)
        table = self.allocate(max(24, len(entries)*24))
        for i, entry in enumerate(entries):
            if not 0 < entry['identity'] <= 0xffffffff or entry['typeRva'] != self.system_type-self.base:
                raise ValueError('Only prepared typed system roots are admitted')
            if self.allocations.get(entry['object']) != self.system_size:
                raise ValueError('Typed asset library contains an unowned root')
            self.put(table+i*24, 'QQII', entry['object'], self.system_type, entry['identity'], 0)
        self.put(library+0x10, 'QII', table, len(entries), len(entries))
        self.put(CONTEXT, 'Q', library)
        before = {'contextHex': bytes(self.u.mem_read(CONTEXT, 24)).hex(),
            'contextAddress': CONTEXT, 'pendingAddress': pending,
            'pendingHex': bytes(self.u.mem_read(pending, count*16)).hex(),
            'libraryAddress': library, 'libraryHex': bytes(self.u.mem_read(library, 0x48)).hex(),
            'tableAddress': table, 'tableHex': bytes(self.u.mem_read(table, len(entries)*24)).hex(),
            'resolverAddress': loaded['object'], 'resolverHex': loaded['objectHex'],
            'mapAddress': loaded['mapAddress'], 'mapBeforeHex': loaded['mapBytesHex']}
        missing = [v['value'] for v in loaded['rows'] if v['value'] and v['value'] not in identities]
        self.stop_missing_asset = True
        self.missing_asset_boundary = False
        try:
            self.call(0x14bbf40, {r.UC_X86_REG_RDI: CONTEXT},
                0x14bc000 if missing else None)
        finally:
            self.stop_missing_asset = False
        # Unicorn's explicit end address stops before its code hook executes.
        # Treat only that exact original instruction as the observed boundary.
        if missing and self.u.reg_read(r.UC_X86_REG_RIP) == self.base+0x14bc000:
            self.missing_asset_boundary = True
        if self.missing_asset_boundary != bool(missing):
            raise ValueError('Original link fixup did not respect its local asset-library boundary')
        values = [self.q(loaded['mapAddress']+i*16+8) for i in range(count)]
        if not missing:
            expected = {v['identity']: v['object'] for v in entries}
            if values != [expected[v['value']] if v['value'] else 0 for v in loaded['rows']]:
                raise ValueError('Original typed fixup selected another root')
            if self.u32(CONTEXT+0x10):
                raise ValueError('Original typed fixup left resolved links queued')
        return {**before, 'entries': entries, 'links': links, 'missingReferenceTokens': missing,
            'status': 'requires-global-asset-library' if missing else 'typed-local-links-resolved',
            'mapAfterHex': bytes(self.u.mem_read(loaded['mapAddress'], count*16)).hex(),
            'contextAfterHex': bytes(self.u.mem_read(CONTEXT, 24)).hex(),
            'resolvedValues': values, 'pendingAfter': self.u32(CONTEXT+0x10)}

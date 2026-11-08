"""Original entity/resource-component construction and resolver precedence.

Unit stacks are explicit caller inputs. They are not inferred from hero skins,
and no replay's live overlay state or world registry is fabricated.
"""
from unicorn import x86_const as r
from effect_resolver_native import NativeEffectResolverAssets


class NativeUnitResources(NativeEffectResolverAssets):
    def __init__(self, *args):
        super().__init__(*args)
        self.unit_resources = {}

    def create_unit(self, base_resolver=None, overlays=()):
        obj = self.allocate(0x168)
        self.call(0x5481e0, {r.UC_X86_REG_RDI: obj})
        interface = self.q(obj+0x10)
        if self.q(interface+0x18)-self.base != 0xd1790:
            raise ValueError('Original entity component getter differs')
        self.call(0x37f7d0, {r.UC_X86_REG_RDI: obj+0x118})
        group = self.u.reg_read(r.UC_X86_REG_RAX)
        if self.allocations.get(group) != 0x30 or self.q(group+8) != obj+0x118:
            raise ValueError('Original resource component registration failed')
        self.call(0x377380, {r.UC_X86_REG_RDI: group, r.UC_X86_REG_RSI: base_resolver or 0})
        for resolver in overlays:
            self.call(0x377390, {r.UC_X86_REG_RDI: group, r.UC_X86_REG_RSI: resolver or 0})
        self.unit_resources[obj] = group
        return {'object': obj, 'group': group,
            'componentManager': obj+0x118,
            'baseResolver': self.q(group+0x10),
            'overlays': [self.q(at) for at in range(self.q(group+0x18), self.q(group+0x20), 8)]}

    def load_prepared_map(self, case):
        # Reuse exact native-loaded row bytes; initialize this owned object via
        # its original constructor. Values remain authored reference tokens.
        if case['status'] != 'native-resource-map-loaded':
            raise ValueError('A complete native authored resource map is required')
        data = bytes.fromhex(case['loaded']['mapBytesHex'])
        rows = case['loaded']['rows']
        if len(data) != len(rows)*16 or not rows:
            raise ValueError('Prepared resource row count differs')
        obj, table = self.allocate(24), self.allocate(len(data))
        self.call(0x16659b0, {r.UC_X86_REG_RDI: obj})
        self.u.mem_write(table, data)
        self.put(obj+8, 'QII', table, len(rows), len(rows))
        for row in rows:
            if self.lookup_resource(obj, row['key']) != {'found': True, 'value': row['value']}:
                raise ValueError('Prepared row bytes do not match the original typed map')
        return obj

    def resolve(self, key, units, auxiliaries):
        if type(key) is not int or not 0 < key <= 0xffffffff or len(units)>64 or len(auxiliaries)>64:
            raise ValueError('Bounded explicit unit/auxiliary resource inputs required')
        if any(unit not in self.unit_resources for unit in units):
            raise ValueError('Resource resolver requires originally constructed owned units')
        ordered = []
        for unit in units:
            group = self.unit_resources[unit]
            ordered.extend(self.q(at) for at in range(self.q(group+0x20)-8, self.q(group+0x18)-1, -8))
            ordered.append(self.q(group+0x10))
        ordered.extend(auxiliaries)
        first = next((obj for obj in ordered if obj and self.lookup_resource(obj, key)['found']), None)
        vectors, unit_array, auxiliary_array, selected = 0x100e9000, 0x100e9800, 0x100ea000, 0x100eb000
        self.u.mem_write(vectors, bytes(0x40))
        for container, array, objects in [(vectors, unit_array, units), (vectors+0x20, auxiliary_array, auxiliaries)]:
            for i, obj in enumerate(objects):
                self.put(array+i*8, 'Q', obj)
            self.put(container, 'QQQ', array, array+len(objects)*8, array+len(objects)*8)
        self.put(selected, 'Q', 0)
        self.resolver_chain_stop = first is None
        try:
            self.call(0x377890, {r.UC_X86_REG_RDI: key, r.UC_X86_REG_RSI: vectors,
                r.UC_X86_REG_RDX: vectors+0x20, r.UC_X86_REG_RCX: 0, r.UC_X86_REG_R8: selected},
                0x377a2d if first is None else None)
        finally:
            self.resolver_chain_stop = False
        value, owner = self.u.reg_read(r.UC_X86_REG_RAX), self.q(selected)
        if first is not None and (owner != first or value != self.lookup_resource(first, key)['value']):
            raise ValueError('Original resource precedence differs from the supplied stack order')
        return {'status': 'matched-authored-reference' if first is not None else 'continue-global-resolution',
            'value': value if first is not None else None, 'owner': owner if first is not None else None}

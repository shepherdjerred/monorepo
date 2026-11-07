"""Complete original static module owning Ambiance/Music/Vfx category keys."""
from unicorn import x86_const as r

KEYS = [
    ('Ambiance', 0x21e664a, 0x255b790),
    ('Music', 0x21e6653, 0x255b794),
    ('Vfx', 0x21e6297, 0x255b798),
    ('GameplayLane', 0x21e6659, 0x255b78c),
    ('GameplayArea', 0x21e6666, 0x255b79c),
    ('GameplayPOI', 0x21e6673, 0x255b7a0),
    ('AREA_Base', 0x21e667f, 0x255b7a4),
]
TYPES = [(0x2493f20, 0x70678bd0, 0x3e30, 16),
         (0x2494b20, 0xbeba9102, 0x3ec0, 16),
         (0x2494c08, 0xb2ff06ac, 0x10, 8)]


def initialize_unit_category_module(n):
    if any(n.u32(n.base + slot) for _, _, slot in KEYS):
        raise ValueError('Original category keys must be cold before the complete static initializer')
    if any(n.u32(n.base + descriptor + 8) for descriptor, _, _, _ in TYPES):
        raise ValueError('Original static module descriptors must be cold before full initialization')
    for name, text, _ in KEYS:
        if n.cstring(n.base + text).decode('ascii') != name:
            raise ValueError('Original category name bytes differ')
    n.call(0x1dac90, {})
    values = []
    for name, text, slot in KEYS:
        value = n.u32(n.base + slot)
        n.call(0x16c9af0, {r.UC_X86_REG_RDI: n.base + text})
        if not value or n.u.reg_read(r.UC_X86_REG_RAX) & 0xffffffff != value:
            raise ValueError('Complete static initializer category differs from original name hash')
        values.append({'name': name, 'literalRva': text, 'globalRva': slot, 'value': value})
    for descriptor, identity, size, alignment in TYPES:
        at = n.base + descriptor
        if n.u32(at + 8) != identity or n.q(at + 0x40) != size or n.q(at + 0x48) != alignment:
            raise ValueError('Complete static module runtime descriptor differs')
    return {'originalCompleteInitializerRva': 0x1dac90, 'originalReturnRva': 0x1db451,
            'originalCategoryHashRva': 0x16c9af0, 'categoryKeys': values,
            'runtimeDescriptors': [{'rva': d, 'identity': i, 'bytes': size, 'alignment': a}
                                   for d, i, size, a in TYPES],
            'staticBuildDataOnly': True, 'categoryValuesSupplied': False,
            'completeStaticInitializerExecuted': True, 'acceptedReplayState': False}

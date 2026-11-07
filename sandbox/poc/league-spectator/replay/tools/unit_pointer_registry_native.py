"""Original keyed unit-pointer association service, with neutral class naming."""


def initialize_unit_pointer_registry(n):
    if n.q(n.base + 0x246e1a8):
        raise ValueError('Original unit pointer registry must be cold')
    n.call(0x66a795, {}, 0x66a7b1)
    obj = n.q(n.base + 0x246e1a8)
    if (n.allocations.get(obj) != 0xd0 or n.q(obj) != n.base + 0x2316bb8 or
            n.q(obj + 0x18) != obj or n.q(obj + 0x20) != n.base + 0x2f2e10 or
            n.q(obj + 0x30) != obj + 0x10 or
            any(n.q(obj + offset) for offset in [0x40, 0x48, 0x50, 0x58])):
        raise ValueError('Original unit pointer registry publication/layout differs')
    return {'object': obj, 'bytes': 0xd0, 'globalRva': 0x246e1a8,
            'originalStartupBlock': [0x66a795, 0x66a7b1],
            'originalConstructorThunkRva': 0x2f3050,
            'originalConstructorRva': 0x2f2ce0,
            'originalInsertRva': 0x2f3560,
            'originalEventCode': 0x122,
            'headerHex': bytes(n.u.mem_read(obj, 0xd0)).hex(),
            'gameFieldsSupplied': False, 'acceptedReplayState': False}

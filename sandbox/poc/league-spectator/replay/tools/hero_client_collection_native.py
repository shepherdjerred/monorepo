"""Original cold collection startup reached by the Hero initialization path.

Constructing these original empty collections does not register a replay unit,
complete Hero initialization, or establish any resource/appearance readiness.
"""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def initialize_hero_client_collection(n):
    if n.q(n.base + 0x246d780) or n.q(n.base + 0x246cbd8):
        raise ValueError('Original Hero-path collections must both be cold')
    n.call(0x66a244, {r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, 0x66a260)
    collection = n.q(n.base + 0x246d780)
    secondary = n.q(n.base + 0x246cbd8)
    if (n.allocations.get(collection) != 0x30 or n.q(collection) != n.base + 0x22f9a08 or
            n.q(collection + 0x18) != n.base + 0x22f9a50 or n.q(collection + 8) or
            n.u32(collection + 0x10) or n.u32(collection + 0x14) or
            n.q(collection + 0x20) or n.u.mem_read(collection + 0x28, 1)[0]):
        raise ValueError('Original Hero-path collection constructor layout differs')
    expected = bytearray(0x860)
    expected[:8] = (n.base + 0x22fd650).to_bytes(8, 'little')
    expected[0x858:] = (n.base + 0x22fd6b0).to_bytes(8, 'little')
    if n.allocations.get(secondary) != 0x860 or bytes(n.u.mem_read(secondary, 0x860)) != bytes(expected):
        raise ValueError('Original secondary collection allocation/zero initialization differs')
    return {'object': collection, 'globalRva': 0x246d780,
            'secondaryObject': secondary, 'secondaryGlobalRva': 0x246cbd8,
            'startupBlock': [0x66a244, 0x66a260], 'constructorRva': 0x149df0,
            'headerHex': bytes(n.u.mem_read(collection, 0x30)).hex(),
            'secondaryHeaderHex': bytes(n.u.mem_read(secondary, 0x860)).hex(),
            'originalInitializationCompleted': True, 'acceptedReplayEntities': False,
            'fullHeroHandlerCompleted': False, 'appearanceReadinessEstablished': False}

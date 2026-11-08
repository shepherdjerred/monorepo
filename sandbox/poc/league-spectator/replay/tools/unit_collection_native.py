"""Original independent unit-pointer collection construction/publication."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def initialize_unit_collection(n):
    if n.q(n.base + 0x246c938):
        raise ValueError('Original unit collection must be cold')
    n.call(0x66a2c9, {r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, 0x66a2eb)
    pointer = n.q(n.base + 0x246c938)
    if (n.allocations.get(pointer) != 0x18 or n.q(pointer) != n.base + 0x2348c60 or
            n.q(pointer+8) or n.u32(pointer+0x10) or n.u32(pointer+0x14)):
        raise ValueError('Original unit collection class/empty vector differs')
    return {'object':pointer,'globalRva':0x246c938,'startupBlock':[0x66a2c9,0x66a2eb],
            'headerHex':bytes(n.u.mem_read(pointer,0x18)).hex(),
            'originalInitializationCompleted':True,'acceptedReplayEntities':False}

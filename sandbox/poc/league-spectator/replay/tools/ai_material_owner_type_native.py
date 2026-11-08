"""Original missing AI runtime ancestor for material owner-interface casts."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def initialize_ai_material_owner_type(n):
    descriptor = n.base + 0x248d700
    parent = n.base + 0x248e550
    if n.u32(descriptor + 8):
        raise ValueError('AI material-owner runtime ancestor must be cold')
    if (n.u32(parent + 8) != 0x2092043f or n.q(parent + 0x40) != 0xb08 or
            n.q(parent + 0x38) != n.base + 0x24bdcd8 or
            n.u32(n.base + 0x24bdcd8 + 8) != 0x1fac8b64 or
            n.u32(n.base + 0x24bddb0 + 8) != 0xb2305647):
        raise ValueError('Original registered GameObject and AI parent metadata required')
    start, end = 0xdb497, 0xdb4fc
    if n.image[start:end] != n.source.image[start:end]:
        raise ValueError('Original AI runtime ancestor instructions differ')
    n.call(start, {r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, end)
    if (n.u32(descriptor + 8) != 0x5c93a47b or n.q(descriptor + 0x38) != parent or
            n.q(descriptor + 0x40) != 0x38e0 or n.q(descriptor + 0x48) != 4):
        raise ValueError('Original AI material-owner ancestor layout differs')
    return {'originalRegistrationBlock':[start,end], 'descriptorRva':descriptor-n.base,
            'identity':0x5c93a47b,'parentDescriptorRva':parent-n.base,
            'originalConstructorCompleted':True,'acceptedReplayEntity':False}

"""Original missing GameObject runtime descriptors for owner-interface casts."""


def initialize_game_object_runtime_types(n):
    concrete, owner = n.base + 0x24bdcd8, n.base + 0x24bddb0
    interface, material = n.base + 0x2531558, n.base + 0x25464d0
    if n.u32(concrete + 8) or n.u32(owner + 8):
        raise ValueError('GameObject runtime descriptors must be cold')
    if n.u32(interface + 8) != 0xa4f28691 or n.u32(material + 8) != 0xa4795108:
        raise ValueError('Original owner/material interface prerequisites required')
    ranges = [(0x557896, 0x5578a2), (0x557934, 0x557940)]
    for start, end in ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original GameObject startup instructions differ')
        n.call(start, {}, end)
    for at, identity, size in [(concrete, 0x1fac8b64, 0x168), (owner, 0xb2305647, 0x10)]:
        if n.u32(at + 8) != identity or n.q(at + 0x40) != size or n.q(at + 0x48) != 8:
            raise ValueError('Original GameObject runtime descriptor layout differs')
    if n.q(concrete + 0x38) != owner:
        raise ValueError('Original GameObject parent publication differs')
    for at, expected, offset in [(owner, interface, 8), (concrete, material, 0x18)]:
        if n.u32(at + 0x70) != 1 or n.q(n.q(at + 0x68)) != expected or n.u32(n.q(at + 0x68) + 8) != offset:
            raise ValueError('Original GameObject interface declaration differs')
    return {'originalStartupPairs': ranges, 'concreteDescriptorRva': concrete - n.base,
            'ownerDescriptorRva': owner - n.base, 'ownerInterfaceOffset': 8,
            'materialInterfaceOffset': 0x18, 'originalConstructorsCompleted': True,
            'acceptedReplayEntity': False}

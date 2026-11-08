"""One-time original network-ID assignment of an owned, registered AI client."""
from unicorn import x86_const as r


def assign_network_control(n, world, unit, identity):
    if (type(identity) is not int or not 0 < identity <= 0xffffffff or
            n.q(n.base + 0x24722c0) != world or n.q(unit + 0xe8) != world or
            n.q(unit) != n.base + 0x22ef3d0 or n.u32(unit + 0x78) != 0):
        raise ValueError('One cold owned AI client and unsigned network identity required')
    local_id = n.u32(unit + 0x20)
    if not local_id:
        raise ValueError('Original local world admission required before network assignment')
    n.call(0x548f00, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: identity})
    if n.u.reg_read(r.UC_X86_REG_RAX):
        raise ValueError('Network identity already belongs to a world object')
    count = n.q(world + 0x48)
    callback = n.q(n.q(unit) + 0x1c8) - n.base
    n.call(0x549580, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: identity})
    if n.u32(unit + 0x78) != identity or n.u32(unit + 0x20) != local_id or n.q(world + 0x48) != count + 1:
        raise ValueError('Original network assignment changed a local handle or omitted its map entry')
    n.call(0x548f00, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: identity})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError('Original network lookup did not recover its assigned AI client')
    return {'unit': unit, 'networkId': identity, 'localId': local_id,
            'assignmentRva': 0x549580, 'originalVirtualCallbackRva': callback,
            'lookupRva': 0x548f00, 'networkCountBefore': count, 'networkCountAfter': n.q(world + 0x48),
            'coldControlObject': True, 'acceptedReplayEntity': False}

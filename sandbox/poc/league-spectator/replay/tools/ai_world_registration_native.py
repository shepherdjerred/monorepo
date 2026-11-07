"""Original local-index admission of an explicitly supplied cold AI client."""
from unicorn import x86_const as r


def register_control(n, world, unit):
    if n.q(n.base + 0x24722c0) != world or n.q(unit) != n.base + 0x22ef3d0:
        raise ValueError('Original world and constructed AI client interfaces required')
    before = n.u32(unit + 0x20)
    if before != 0:
        raise ValueError('Cold AI local registration requires an unregistered object')
    before_count = n.u32(world + 0x14)
    if n.q(unit + 0xe8):
        raise ValueError('Cold AI world admission requires an unowned object')
    n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: unit})
    if (n.u32(world + 0x14) != before_count + 1 or n.q(unit + 0xe8) != world or
            not n.library_pointer(n.q(world + 0x118) - 8, 8) or
            n.q(n.q(world + 0x118) - 8) != unit):
        raise ValueError('Original world admission count, owner or pending list differs')
    local_id = n.u32(unit + 0x20)
    if local_id == 0:
        raise ValueError('Original local index did not assign a generation handle')
    n.call(0x54b0a0, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: local_id})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError('Original local lookup did not recover its registered AI client')
    n.call(n.q(n.q(unit) + 0x10) - n.base, {r.UC_X86_REG_RDI: unit})
    dynamic_type = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0xea3b0, {})
    required_type = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0x14b6400, {r.UC_X86_REG_RDI: dynamic_type, r.UC_X86_REG_RSI: unit,
                      r.UC_X86_REG_RDX: required_type})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError('Original animation callback type route did not recover its AI client')
    return {'unit': unit, 'localIdBefore': before, 'localId': local_id,
            'networkId': n.u32(unit + 0x78), 'registrationRva': 0x549f30,
            'localIndexRva': 0x54aa70, 'worldCountBefore': before_count,
            'worldCountAfter': n.u32(world + 0x14), 'originalWorldOwnershipVerified': True,
            'lookupRva': 0x54b0a0, 'originalClientTypeRouteVerified': True,
            'acceptedReplayEntity': False}

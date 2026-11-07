"""Original runtime-class registrations needed by hero-to-client callbacks."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def initialize_hero_client_types(n, reuse_existing=False):
    # Independent complete descriptor construction and parent publication blocks.
    # The surrounding static modules also own unrelated services/destructors.
    rows = [
        (0x137806, 0x13786b, 0x248e608, 0xf7fcc091, 0x3c50, 4),
        (0x185eaa, 0x185f0f, 0x24906b0, 0x66615e8b, 0x48e0, 4),
        (0x1860a8, 0x186118, 0x24913e0, 0xe260302c, 0x49a0, 16),
    ]
    if not reuse_existing and any(n.u32(n.base + descriptor + 8) for _, _, descriptor, _, _, _ in rows):
        raise ValueError('Original hero/client runtime descriptors must be cold')
    result = []
    for start, end, descriptor, identity, size, alignment in rows:
        existing = bool(n.u32(n.base + descriptor + 8))
        if existing and n.types.get(identity) != n.base + descriptor:
            raise ValueError('Existing hero/client descriptor is absent from the original initialized registry')
        registers = {r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}
        if identity == 0xe260302c:
            # RBX is the original parent descriptor retained by 185f0f.
            registers[r.UC_X86_REG_RBX] = n.base + 0x24906b0
        if not existing:
            n.call(start, registers, end)
        at = n.base + descriptor
        if (n.u32(at + 8) != identity or n.q(at + 0x40) != size or
                n.q(at + 0x48) != alignment or not n.base <= n.q(at + 0x38) < n.base + len(n.image)):
            raise ValueError('Original hero/client runtime descriptor layout differs')
        result.append({'descriptorRva': descriptor, 'identity': identity, 'objectBytes': size,
                       'alignment': alignment, 'parentRva': n.q(at + 0x38) - n.base,
                       'reusedOriginalRegistration': existing,
                       'originalRegistrationBlock': [start, end]})
    if (result[1]['parentRva'] != result[0]['descriptorRva'] or
            result[2]['parentRva'] != result[1]['descriptorRva'] or
            n.q(n.base + 0x24913e0 + 0x20) != n.base + 0x17e0e0):
        raise ValueError('Original concrete hero/client parent or constructor route differs')
    return {'registrations': result, 'originalParentPublications': True,
            'completeRuntimeTypeRegistry': False, 'acceptedReplayEntities': False}


def verify_hero_client_cast(n, unit):
    n.call(n.q(n.q(unit) + 0x10) - n.base, {r.UC_X86_REG_RDI: unit})
    dynamic = n.u.reg_read(r.UC_X86_REG_RAX)
    if dynamic != n.base + 0x24913e0:
        raise ValueError('Original hero dynamic-type getter differs')
    n.call(0xea3b0, {})
    required = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0x14b6400, {r.UC_X86_REG_RDI: dynamic, r.UC_X86_REG_RSI: unit,
                      r.UC_X86_REG_RDX: required})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError('Original hero-to-client callback cast did not recover its unit')
    return {'dynamicDescriptorRva': dynamic - n.base, 'requiredDescriptorRva': required - n.base,
            'castRva': 0x14b6400, 'unit': unit, 'originalParentChainCastCompleted': True,
            'acceptedReplayEntity': False}

"""Original AIMinionClient type registration, pool and allocation controls.

The complete original allocation constructor executes. Character appearance,
recorded network identity and successful gameplay factory creation remain
separate requirements.
"""
from unicorn import x86_const as r


def initialize_minion_factory(n):
    descriptor = n.base+0x2492760
    registry = n.base+0x247b7c0
    pool_global = n.base+0x246c950
    if n.u32(descriptor+8) or n.q(pool_global):
        raise ValueError('Original minion descriptor and pool must be cold')
    count_before = n.u32(registry+8)
    n.call(0xea3b0, {})
    base_type = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0x1afca8, {r.UC_X86_REG_RBX: base_type}, 0x1afd22)
    if (n.u32(descriptor+8) != 0xcaa58cb2 or n.q(descriptor+0x38) != base_type or
            n.u32(registry+8) != count_before+1):
        raise ValueError('Original minion descriptor identity, parent or publication differs')
    n.call(0x14b6f40, {r.UC_X86_REG_RDI: registry, r.UC_X86_REG_RSI: descriptor+8})
    if n.u.reg_read(r.UC_X86_REG_RAX) != descriptor:
        raise ValueError('Original runtime registry lookup did not select AIMinionClient')
    pool = n.allocate(0x178)
    n.u.mem_write(pool+0x78, b'\xa5'*0x100)
    n.call(0x18ae90, {r.UC_X86_REG_RDI: pool})
    if n.q(pool_global) != pool or bytes(n.u.mem_read(pool+0x78, 0x100)) != b'\xa5'*0x100:
        raise ValueError('Original minion pool constructor publication or bounds differs')
    if n.u32(pool+0x40) or n.q(pool+0x38):
        raise ValueError('Original minion pool is not initially empty')
    return {'descriptorRva': descriptor-n.base, 'typeHash': 0xcaa58cb2,
            'registryRva': registry-n.base, 'baseTypeRva': base_type-n.base,
            'registrationPrefix': [0x1afca8, 0x1afd22],
            'pool': pool, 'poolConstructorRva': 0x18ae90,
            'registryCountBefore': count_before, 'registryCountAfter': count_before+1}


def allocate_minion(n, state):
    pool = state['pool']
    if n.q(n.base+0x246c950) != pool or n.u32(pool+0x40):
        raise ValueError('Original control minion pool must remain empty before allocation')
    n.call(0x18bae0, {r.UC_X86_REG_RDI: pool})
    unit = n.u.reg_read(r.UC_X86_REG_RAX)
    if (n.allocations.get(unit) != 0x3f00 or n.q(unit) != n.base+0x23013b8 or
            n.u32(unit+0x20) or n.q(unit+0xe8) or n.u32(unit+0x78)):
        raise ValueError('Original minion factory did not return a cold owned AIMinionClient')
    if bytes(n.u.mem_read(pool+0x78, 0x100)) != b'\xa5'*0x100:
        raise ValueError('Original minion factory escaped its pool allocation')
    return unit

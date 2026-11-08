"""Original independent inline AI-unit manager initialization."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def initialize_ai_unit_manager(n):
    if n.q(n.base + 0x2472350):
        raise ValueError('Original AI-unit manager must be cold')
    # Preserve the original caller's aligned pre-call stack for this inline
    # allocation/constructor/publication block; stop before the next subsystem.
    stack = ADDRESSES['stack'] - 8
    n.put(stack, 'Q', ADDRESSES['stop'])
    try:
        n.call(0x66a029, {r.UC_X86_REG_RSP: stack}, 0x66a096)
    except Exception as error:
        raise ValueError('Original AI manager initialization stopped at RVA ' +
                         hex(n.u.reg_read(r.UC_X86_REG_RIP) - n.base) +
                         '; mode owner ' + hex(n.q(n.base + 0x246d4f0)) +
                         '; first argument ' + hex(n.u.reg_read(r.UC_X86_REG_RDI))) from error
    manager = n.q(n.base + 0x2472350)
    expected_vtable = n.base + 0x66a054 + 7 + 0x1cde805
    if (n.allocations.get(manager) != 0x48 or n.q(manager) != expected_vtable or
            n.q(manager + 8) or n.u32(manager + 0x10)):
        raise ValueError('Original AI-unit manager class, allocation or empty registry differs')
    return {'object': manager, 'originalInlineBlock': [0x66a029, 0x66a096],
            'nestedConstructorRva': 0x67b6f0, 'globalRva': 0x2472350,
            'headerHex': bytes(n.u.mem_read(manager, 0x48)).hex(),
            'originalInitializationCompleted': True, 'acceptedReplayEntities': False}


def initialize_ai_network_registry(n):
    if n.q(n.base + 0x246c5c8):
        raise ValueError('Original AI network-callback registry must be cold')
    n.call(0x677ca0, {})
    registry = n.q(n.base + 0x246c5c8)
    expected_vtable = n.base + 0x7966c4 + 7 + 0x1bbb55d
    if n.allocations.get(registry) != 0x70 or n.q(registry) != expected_vtable:
        raise ValueError('Original network-callback registry allocation/class differs')
    return {'object': registry, 'factoryRva': 0x677ca0, 'constructorRva': 0x7966b0,
            'globalRva': 0x246c5c8, 'originalInitializationCompleted': True,
            'headerHex': bytes(n.u.mem_read(registry, 0x70)).hex(), 'acceptedReplayEntities': False}


def initialize_actor_callback_service(n):
    if n.q(n.base + 0x2470b90):
        raise ValueError('Original actor-callback service must be cold')
    n.call(0x677f30, {})
    service = n.q(n.base + 0x2470b90)
    if (n.allocations.get(service) != 0xd8 or
            not n.base + 0x1fef000 <= n.q(service) < n.base + len(n.image)):
        raise ValueError('Original actor-callback service allocation/class differs')
    return {'object': service, 'factoryRva': 0x677f30, 'constructorRva': 0x5af450,
            'globalRva': 0x2470b90, 'originalInitializationCompleted': True,
            'headerHex': bytes(n.u.mem_read(service, 0xd8)).hex(), 'acceptedReplayEntities': False}

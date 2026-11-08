"""Original empty visibility-component registry startup before unit admission."""


def initialize_visibility_component_registry(n):
    if n.q(n.base + 0x246c960):
        raise ValueError('Original visibility component registry must be cold')
    n.call(0x66a140, {}, 0x66a16d)
    registry = n.q(n.base + 0x246c960)
    if (n.allocations.get(registry) != 0x20 or
            n.q(registry) != n.base + 0x66a151 + 0x1cdea0f or
            n.q(registry + 8) != registry + 0x10 or
            n.q(registry + 0x10) or n.q(registry + 0x18)):
        raise ValueError('Original visibility registry allocation or empty layout differs')
    return {'object': registry, 'globalRva': 0x246c960,
            'originalStartupBlock': [0x66a140, 0x66a16d],
            'originalInitializationCompleted': True,
            'headerHex': bytes(n.u.mem_read(registry, 0x20)).hex(),
            'acceptedReplayEntities': False, 'visibilityRecovered': False}

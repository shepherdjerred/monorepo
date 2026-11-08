"""Original startup allocation/construction/publication of global collection0.

This establishes the empty original singleton. It does not infer which later
mode, script or spell producers have appended resources, or publish a guessed
global resolver component.
"""
from unicorn import x86_const as r


def initialize_global_resource_collection(n):
    if n.q(n.base + 0x246efe8) or n.q(n.base + 0x24a8560):
        raise ValueError('Original global resource collection requires cold globals')
    n.call(0x66a4ab, {}, 0x66a50e)
    obj = n.q(n.base + 0x246efe8)
    if (n.allocations.get(obj) != 0x40 or
            n.q(obj) - n.base != 0x235f700 or
            n.q(obj + 8) - n.base != 0x235f730 or
            n.q(obj + 0x28) - n.base != 0x2348e60 or
            n.q(obj + 0x30) or n.u32(obj + 0x38) or
            n.q(n.base + 0x24a8560)):
        raise ValueError('Original global resource collection initialization differs')
    return {'object': obj, 'allocationBytes': 0x40,
            'originalStartupFragment': [0x66a4ab, 0x66a50e],
            'componentManagerConstructorRva': 0x15ef220,
            'resolver': obj + 0x28,
            'originalInitializationCompleted': True,
            'resolverRows': 0, 'globalResolverComponentPublished': False,
            'laterProducerStateRecovered': False,
            'acceptedReplayEntities': False}

"""Original unit key/value service startup; semantic feature names stay neutral."""
from unicorn import x86_const as r


def initialize_unit_key_value_service(n):
    if n.q(n.base + 0x246cb30):
        raise ValueError('Original unit key/value service must be cold')
    if not n.u32(n.base + 0x255b790):
        raise ValueError('Original Ambiance category static initialization is required')
    manager = n.q(n.base + 0x246c948)
    runtime = n.q(manager + 8) if manager else 0
    if not runtime or n.u.mem_read(runtime + 0xba, 1)[0] != 1:
        raise ValueError('Original unit key/value startup requires a loaded original navgrid')
    n.call(0x677080, {})
    service = n.q(n.base + 0x246cb30)
    if (n.allocations.get(service) != 0x48 or
            n.q(service) != n.base + 0x230a5f8 or
            n.q(service + 8) != n.base + 0x230a630 or
            n.q(n.base + 0x230a618) != n.base + 0x1c1f40 or
            n.u32(service + 0x34) > 8 or
            n.q(service + 0x38) or n.u32(service + 0x40) or n.u32(service + 0x44)):
        raise ValueError('Original unit key/value service publication/layout differs')
    return {'object': service, 'bytes': 0x48, 'originalInitializerRva': 0x677080,
            'originalConstructorRva': 0x1c17f0, 'originalWrapperRva': 0x102ab0,
            'originalUpdateMethodRva': 0x1c1f40,
            'originalUnitTreeUpdateRva': 0x169590,
            'navgrid': runtime, 'navgridLayerIndex': n.u32(service + 0x34),
            'originalActiveByte': n.u.mem_read(service + 0x10, 1)[0],
            'viewportDimensions': [n.u32(service + 0x14), n.u32(service + 0x18)],
            'specialKey': n.u32(n.base + 0x255b790),
            'bytesHex': bytes(n.u.mem_read(service, 0x48)).hex(),
            'gameFieldsSupplied': False, 'serviceResultSubstituted': False,
            'acceptedReplayState': False}

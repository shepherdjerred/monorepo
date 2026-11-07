"""Original data-only metadata initializers used by the recorded mode graph."""
from vfx_asset_native import REGISTRY
from vfx_spawn_native import ADDRESSES
from unicorn import x86_const as r


def initialize_mode_dependency_types(n):
    # Complete original static modules for inline definitions. Other classes
    # use their independent original caller LEA/CALL pair and full constructor.
    modules = [
        (0x44fc50, [0x409a5657, 0xe8c34b52, 0xcd940ce3]),
        (0x4963b0, [0xfe1f7ae3]),
        (0x4a4150, [0x5a92b195]),
        (0x4bec70, [0xc7ccb2ce, 0x5858e503, 0x572b790b]),
        (0x769ef0, [0x8b04b4cb]),
        (0xbefe10, [0xe348122d]),
        (0x208e20, [0xf3a72633, 0x93f5c410, 0xf0cf99ef]),
        (0x556a50, [0x7a1cab0d]),
        (0xca0f70, [0x68f56a56, 0xb35ad9d8, 0x38691790]),
        (0x5e2d10, [0xf49573c3, 0xac27b13a]),
    ]
    blocks = [
        # Complete independent inline definitions, ending before exit hooks.
        # Their enclosing module also registers already initialized classes.
        (0x29fcd7, 0x29fd72, 0xb53e2f1a),
        (0x29ff7d, 0x2a0018, 0x24e1cb45),
        (0x2a0032, 0x2a003e, 0x9f30b8a6),
        (0x5bbaac, 0x5bbab8, 0x67bfa45e),
        (0xf78b1a, 0xf78b26, 0x2c26c305),
        (0x5bbc4c, 0x5bbc58, 0x92309121),
        (0xf44f25, 0xf44f31, 0xaf15d530),
        (0xcc2cd3, 0xcc2cdf, 0x60e2ec74),
        (0xc5e7ef, 0xc5e7fb, 0xc3a44766),
        (0x292590, 0x29259c, 0x85bf79cf),
        (0xb86f39, 0xb86f45, 0x0d6825c4),
        (0x185fdb, 0x185fe7, 0x1307c9ed),
        (0xf78b40, 0xf78b4c, 0xa033f9cd),
        (0x2925b6, 0x2925c2, 0xc565e640),
        (0x29ed5b, 0x29ed67, 0xe189202c),
        (0x29f063, 0x29f06f, 0x7ebc692d),
        (0x2926ee, 0x2926fa, 0x3283e2d6),
        (0x2925dc, 0x2925e8, 0x16e6e17a),
        (0x29ed81, 0x29ed8d, 0x6256517d),
        (0xc7e733, 0xc7e73f, 0xc31e29fe),
        (0xf7d5d6, 0xf7d5e5, 0xbe0dceb0),
    ]
    if n.initializing_resource_types or len(n.types) < 1928:
        raise ValueError('Complete character types and a non-reentrant mode metadata control required')
    before = dict(n.types)
    operations = []
    n.mode_type_preparation = operations

    def refresh():
        count, array = n.u32(n.base + REGISTRY + 8), n.q(n.base + REGISTRY)
        if not len(before) <= count <= 4096 or not n.library_pointer(array, count * 8):
            raise ValueError('Mode metadata registry ownership/count differs')
        types = {}
        for i in range(count):
            pointer = n.q(array + i * 8)
            if not n.base + 0x1fef000 <= pointer <= n.base + len(n.image) - 0x88:
                raise ValueError('Original mode descriptor is outside static data')
            identity = n.u32(pointer + 8)
            if identity in types:
                raise ValueError(f'Original mode metadata introduced duplicate {identity:08x} at {pointer-n.base:x}')
            types[identity] = pointer
        if any(types.get(key) != value for key, value in before.items()):
            raise ValueError('Original mode metadata replaced an existing descriptor')
        n.types = types

    n.initializing_resource_types = True
    try:
        for start, identities in modules:
            if all(identity in n.types for identity in identities):
                continue
            if any(identity in n.types for identity in identities):
                raise ValueError('Original mode static module is only partially registered')
            operation = {'moduleRva': start, 'typeHashes': identities, 'completed': False}
            operations.append(operation)
            n.call(start, {})
            refresh()
            if any(identity not in n.types for identity in identities):
                raise ValueError('Original mode static module omitted its requested definitions')
            operation['completed'] = True
        for start, end, identity in blocks:
            if identity in n.types:
                continue
            operation = {'originalCallerBlock': [start, end], 'typeHashes': [identity], 'completed': False}
            operations.append(operation)
            n.call(start, {r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, end)
            refresh()
            if identity not in n.types:
                raise ValueError('Original mode descriptor constructor omitted its requested definition')
            operation['completed'] = True
    finally:
        n.initializing_resource_types = False
    n.type_catalog = n.catalog()
    return {'typeCountBefore': len(before), 'typeCountAfter': len(n.types), 'operations': operations,
            'addedTypeHashes': [key for key in n.types if key not in before],
            'originalMetadataExecuted': True, 'assetReferencesFixed': False,
            'readyGlobalProviderEstablished': False, 'acceptedReplayEntities': False}

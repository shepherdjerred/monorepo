"""Original graphics resource registry construction, retaining existing services."""
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_graphics_native import DEVICE,CALLBACKS

# Independent allocation/constructor/publication blocks from the original
# graphics factory and startup. The constructed texture manager is retained.
REGISTRIES = [
    (0x180d3c7,0x180d3e3,0x247d120,0xd0),
    (0x180d3e3,0x180d3ff,0x247d128,0x58),
    (0x180d41b,0x180d437,0x247c9c0,0x90),
    (0x180d437,0x180d459,0x247d130,0x18),
    (0x180d459,0x180d475,0x246eb30,0xb8),
    (0x180d475,0x180d491,0x24713f8,0x78),
    # Runtime particle material groups, required by legacy emitter post-load.
    (0x66a46e,0x66a48a,0x247caa0,0x18),
]


def initialize_shared_graphics_registries(n,shader_directory):
    texture = n.q(n.base+0x246fdf0)
    groups = n.q(n.base+0x24712c8)
    if n.device is None or n.allocations.get(texture) != 0x108 or not n.q(texture+0xd8) or not groups:
        raise ValueError('Completed original texture defaults and resource groups required')
    if n.shader_catalog is not None:
        raise ValueError('Shared shader provider is already installed')
    n.shader_catalog = GraphicsShaderCatalog(shader_directory,n.device)
    n.attach_shared_material_provider(n.shader_catalog)
    table = n.q(DEVICE)
    for offset,name in [(0x138,'vertex'),(0x148,'pixel'),(0x168,'program'),(0x50,'pipeline')]:
        n.put(table+offset,'Q',CALLBACKS[name])
    n.shared_graphics_registries = []
    for start,end,global_,size in REGISTRIES:
        existing = n.q(n.base+global_)
        record = {'startupBlock':[start,end],'globalRva':global_,'allocationBytes':size,
                  'reusedExistingObject':bool(existing),'completed':False}
        n.shared_graphics_registries.append(record)
        if not existing:
            n.call(start,{},end)
        pointer = n.q(n.base+global_)
        if n.allocations.get(pointer) != size or existing and pointer != existing:
            raise ValueError('Original shared graphics registry ownership/identity differs')
        if n.q(n.base+0x246fdf0) != texture or n.q(n.base+0x24712c8) != groups:
            raise ValueError('Shared graphics construction replaced an existing texture/group manager')
        record.update(object=pointer,objectHex=bytes(n.u.mem_read(pointer,size)).hex(),completed=True)
    return {'registries':n.shared_graphics_registries,'textureManagerRetained':texture,
            'resourceGroupManagerRetained':groups,'originalConstructionBlocksCompleted':True,
            'fullStartupFactoryExecuted':False,'allAssetsLoaded':False,'liveWorldRoutingVerified':False}

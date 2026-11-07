"""Original runtime class registration required by the appearance factory."""
from unicorn import x86_const as r


def initialize_appearance_factory(n,world_runtime=False):
    if type(world_runtime) is not bool:raise ValueError('Explicit runtime construction choice required')
    registry=n.base+0x247b7c0;descriptor=n.base+0x24a82f8;identity=0xdd4de76f
    def entries():
        rows,count=n.q(registry),n.u32(registry+8)
        if count>4096 or count and not n.library_pointer(rows,count*8):
            raise ValueError('Runtime class registry exceeds owned entry bounds')
        result={}
        for i in range(count):
            pointer=n.q(rows+i*8)
            if not n.base+0x1fef000<=pointer<=n.base+len(n.image)-0x40:
                raise ValueError('Runtime class descriptor escaped original static data')
            key=n.u32(pointer+8)
            if key in result:raise ValueError('Duplicate runtime class registry identity')
            result[key]=pointer
        return result
    before=entries()
    if identity in before or n.u32(descriptor+8):raise ValueError('Appearance runtime class is not cold')
    world_record=None;visibility_record=None
    if world_runtime:
        if n.q(n.base+0x24722c0) or n.q(n.base+0x24705d0):
            raise ValueError('Original world registry and visibility configuration must be cold')
        config=n.q(n.base+0x246c568)
        world=n.allocate(0x268);n.u.mem_write(world+0x168,b'\xa5'*0x100)
        n.call(0x54a4d0,{r.UC_X86_REG_RDI:world})
        if (n.q(n.base+0x24722c0)!=world or n.q(n.base+0x246c568)!=config or
                bytes(n.u.mem_read(world+0x168,0x100))!=b'\xa5'*0x100):
            raise ValueError('Original world registry publication, retained config or guard differs')
        world_record={'originalConstructorRva':0x54a4d0,'object':world,
            'headerHex':bytes(n.u.mem_read(world,0x168)).hex(),'guardIntact':True,'loadingConfigurationRetained':config}
        n.call(0x374c00,{})
        visibility=n.allocate(0x2c0);n.u.mem_write(visibility+0x1c0,b'\xa5'*0x100)
        n.call(0x624060,{r.UC_X86_REG_RDI:visibility})
        if (n.q(n.base+0x24705d0)!=visibility or
                bytes(n.u.mem_read(visibility+0x1c0,0x100))!=b'\xa5'*0x100):
            raise ValueError('Original visibility publication or guard differs')
        visibility_record={'originalConstructorRva':0x624060,'object':visibility,'guardIntact':True}
    else:
        # Independent descriptor construction, callback publication and base-type
        # linkage from the original static module. No registry entry is supplied.
        n.call(0x374ef9,{},0x374f67)
    after=entries()
    if (len(after)!=len(before)+1 or any(after.get(k)!=v for k,v in before.items()) or
            after.get(identity)!=descriptor or n.q(descriptor+0x10)!=n.base+0x371d90):
        raise ValueError('Original appearance registration changed existing classes or omitted its constructor')
    n.call(0x14b6f40,{r.UC_X86_REG_RDI:registry,r.UC_X86_REG_RSI:descriptor+8})
    if n.u.reg_read(r.UC_X86_REG_RAX)!=descriptor:
        raise ValueError('Original appearance factory lookup did not select its registered class')
    return {'originalRegistrationBlock':None if world_runtime else [0x374ef9,0x374f67],
            'originalStaticModuleRva':0x374c00 if world_runtime else None,'descriptorRva':0x24a82f8,
            'registryRva':0x247b7c0,'typeHash':identity,'originalAllocationConstructorRva':0x371d90,
            'descriptorHex':bytes(n.u.mem_read(descriptor,0x40)).hex(),
            'registryCountBefore':len(before),'registryCountAfter':len(after),
            'worldRegistry':world_record,'visibility':visibility_record,
            'scope':{'originalRegistrationExecuted':True,'fullStaticModuleExecuted':world_runtime,
                     'initializedWorldObject':False,'completeAppearanceVerified':False,'mainViewerExpanded':False}}

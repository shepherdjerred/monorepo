"""Additional original BuffData/SpellObject module reflection constructors."""
import struct
from vfx_asset_native import REGISTRY
from vfx_spawn_native import name_hash


def initialize_buff_metadata_types(n):
    initializers=[]
    for identity,start,end,constructor in [(name_hash('BuffData'),0x839ac3,0x839acf,0x8308a0),
                                             (name_hash('SpellObject'),0x870ee8,0x870ef4,0x861920)]:
        if (n.image[start:start+3]!=bytes.fromhex('488d3d') or n.image[end-5]!=0xe8 or
                end+struct.unpack_from('<i',n.image,end-4)[0]!=constructor or
                n.image[start:end]!=n.source.image[start:end]):
            raise ValueError('Original additional reflection initializer callsite differs')
        descriptor=n.base+start+7+struct.unpack_from('<i',n.image,start+3)[0]
        if identity in n.types:
            if n.types[identity]!=descriptor: raise ValueError('Original existing descriptor differs')
        else:
            n.call(start,{},end)
            count,array=n.u32(n.base+REGISTRY+8),n.q(n.base+REGISTRY)
            if not 0<count<=4096: raise ValueError('Bounded original type registry required')
            types={}
            for index in range(count):
                at=n.q(array+index*8)
                if not n.base+0x1fef000<=at<=n.base+len(n.image)-0x88 or n.u32(at+8) in types:
                    raise ValueError('Original additional type registry is unowned or duplicated')
                types[n.u32(at+8)]=at
            n.types=types
            if n.types.get(identity)!=descriptor: raise ValueError('Original additional descriptor was not published')
        initializers.append({'classHash':'%08x'%identity,'callerPrefix':[start,end],'constructorRva':constructor,'descriptorRva':descriptor-n.base})
    n.type_catalog=n.catalog()
    return initializers

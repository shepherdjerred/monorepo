"""Original BIN-backed shared constant definitions and CPU buffer layouts."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES,name_hash,sha
from vfx_graphics_native import DEVICE
from vfx_asset_native import REGISTRY


def initialize_shared_constant_types(n):
    # Independent original descriptor construction from static module 191cf90.
    # The already initialized texture invalidation mutex/map are retained.
    blocks=[(0x191cfa7,0x191cfb6),(0x191d001,0x191d00d),(0x191d027,0x191d033),
            (0x191d04d,0x191d059),(0x191d073,0x191d07f),(0x191d099,0x191d0a5),(0x191d0bf,0x191d0cb)]
    expected=[0x525cc130,0x0125d45c,0x95ef430a,0x344a9a75]
    if any(key in n.types for key in expected):raise ValueError('Shared constant descriptor cohort is not cold')
    previous=dict(n.types)
    for start,end in blocks:n.call(start,{},end)
    count,array=n.u32(n.base+REGISTRY+8),n.q(n.base+REGISTRY)
    if not len(previous)<count<=4096:raise ValueError('Shared constant reflection registry exceeds bounds')
    types={}
    for i in range(count):
        descriptor=n.q(array+i*8);identity=n.u32(descriptor+8)
        if (not n.base+0x1fef000<=descriptor<=n.base+len(n.image)-0x88 or identity in types):
            raise ValueError('Shared constant descriptor ownership/identity differs')
        types[identity]=descriptor
    if any(types.get(key)!=value for key,value in previous.items()) or any(key not in types for key in expected):
        raise ValueError('Shared constant registration replaced a type or omitted a required descriptor')
    n.types=types;n.type_catalog=n.catalog()
    return {'originalDescriptorBlocks':blocks,'typeCountBefore':len(previous),'typeCountAfter':count,
            'addedTypeHashes':[key for key in types if key not in previous],
            'fullStaticConstructorExecuted':False}


def load_constant_library(n,path):
    if not n.q(n.base+0x247b830):raise ValueError('Original binary-file cache required')
    handle=n.allocate(16);n.call(0x14b7670,{r.UC_X86_REG_RDI:handle})
    text=n.allocate_text(path)
    n.u.context_restore(n.initial);n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
    for reg,value in {r.UC_X86_REG_RSP:ADDRESSES['stack'],r.UC_X86_REG_RDI:handle,r.UC_X86_REG_RSI:text}.items():n.u.reg_write(reg,value)
    record={'path':path,'handle':handle,'originalReaderRva':0x14ba7d0,'slices':[],'completed':False}
    n.shared_constant_loads.append(record);start=n.base+0x14ba7d0
    for index in range(16):
        n.u.emu_start(start,ADDRESSES['stop'],count=5000000);start=n.u.reg_read(r.UC_X86_REG_RIP)
        record['slices'].append({'slice':index+1,'stop':start,'instructionBound':5000000})
        if start==ADDRESSES['stop']:break
    else:raise ValueError('Shared shader BIN read exceeds sixteen bounded CPU slices')
    if n.u.mem_read(handle,1)!=b'\x01':raise ValueError('Original shared shader BIN handle did not acquire its file')
    key=n.q(handle+8);manager=n.q(n.base+0x247b830)
    count,rows=n.u32(manager+0x10),n.q(manager+8)
    if not 0<count<=1024 or not n.library_pointer(rows,count*8):raise ValueError('Binary-cache library vector escaped bounds')
    libraries=[n.q(rows+i*8) for i in range(count)]
    matches=[lib for lib in libraries if n.library_pointer(lib,0x48) and n.q(lib)==key]
    if len(matches)!=1:raise ValueError('Original cache did not retain exactly one matching shader library')
    library=matches[0];table,size=n.q(library+0x10),n.u32(library+0x18)
    if not 0<size<=4096 or not n.library_pointer(table,size*24):raise ValueError('Shader library root table escaped owned bounds')
    entries={}
    for i in range(size):
        row=table+i*24;object_,type_,identity=n.q(row),n.q(row+8),n.u32(row+0x10)
        if identity in entries or type_ not in n.types.values() or not n.library_pointer(object_,n.q(type_+0x40)):
            raise ValueError('Native shader-library entry ownership/type differs')
        entries[identity]={'object':object_,'type':type_,'typeHash':n.u32(type_+8)}
    record.update(completed=True,key=key,library=library,entries=entries)
    return record


def initialize_shared_constant_inputs(n):
    n.shared_constant_loads=[];n.shared_constant_buffers=[]
    load_constant_library(n,'data/shaders/shaders.bin')
    shared=load_constant_library(n,'assets/shaders/shareddata.bin')
    root=shared['entries'].get(0x85390927)
    if root is None or root['typeHash']!=name_hash('X3DSharedData'):
        raise ValueError('Original X3DSharedData root is absent or has another type')
    properties=[p for p in n.type_catalog[f"{root['typeHash']:08x}"]['properties'] if p['hash']==name_hash('constantBuffers')]
    if len(properties)!=1:raise ValueError('Original constant-buffer field descriptor required')
    at=root['object']+properties[0]['offset'];rows,count=n.q(at),n.u32(at+8)
    if not 0<count<=256 or not n.library_pointer(rows,count*8):raise ValueError('Native shared constant-buffer vector escaped bounds')
    table=n.q(DEVICE)
    # Original CPU definition registration and the already proven Metal CPU
    # parameter factory. No scene values or successful GPU buffers are supplied.
    if (int.from_bytes(n.source.image[0x2408828:0x2408830],'little')!=n.base+0x19139e0 or
            int.from_bytes(n.source.image[0x2408848:0x2408850],'little')!=n.base+0x1928420):
        raise ValueError('Exact original shared-parameter vtable slots differ')
    n.put(table+0x2b8,'Q',n.base+0x19139e0);n.put(table+0x2d8,'Q',n.base+0x1928420)
    for i in range(count):
        definition=n.q(rows+i*8)
        if not n.library_pointer(definition,0x38):raise ValueError('Shared constant-buffer definition escaped owned memory')
        record={'definition':definition,'name':n.cstring(n.q(definition)).decode('utf-8'),
                'originalCpuLayoutBlock':[0x1928620,0x1928872],'originalPlatformInput':4,'completed':False,
                'fullMetalConstructorExecuted':False,'backendBufferPublished':False}
        n.shared_constant_buffers.append(record)
        # The final operation at 1928872 inserts into the derived Metal
        # device's +e38 map. This GLES port owns only the common CPU device.
        # Keep the real CPU layout/back-references and stop before that write;
        # backend buffer publication remains an explicit unfinished service.
        n.call(0x1928620,{r.UC_X86_REG_RDI:DEVICE,r.UC_X86_REG_RSI:definition},0x1928872)
        layout=n.q(n.u.reg_read(r.UC_X86_REG_RBP)-0x50)
        if n.allocations.get(layout)!=0x30 or n.u32(layout+4)>1048576:
            raise ValueError('Original shared CPU layout header escaped owned bounds')
        record.update(completed=True,layout=layout,bytes=n.u32(layout+4),
                      headerHex=bytes(n.u.mem_read(layout,0x30)).hex())
    n.call(0x1913b10,{r.UC_X86_REG_RDI:DEVICE,r.UC_X86_REG_RSI:n.allocate_text('BONES')})
    bones=n.u.reg_read(r.UC_X86_REG_RAX)
    if not bones or not n.library_pointer(bones,0x38) or n.u32(bones+0x10)%3:
        raise ValueError('Original shared constant initialization did not publish a bounded bone parameter')
    return {'sourceRoot':root,'libraries':n.shared_constant_loads,'constantBuffers':n.shared_constant_buffers,
            'bones':{'pointer':bones,'vectors':n.u32(bones+0x10),'matrices':n.u32(bones+0x10)//3,
                     'headerHex':bytes(n.u.mem_read(bones,0x38)).hex()},
            'scope':{'originalCpuLayoutsExecuted':True,'bonePoseValuesSupplied':False,'gpuUniformsBound':False,
                     'completeMetalConstructorsExecuted':False,'backendConstantBuffersPublished':False,
                     'sceneInputsBound':False,'mainViewerExpanded':False}}

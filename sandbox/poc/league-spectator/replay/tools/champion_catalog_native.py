"""Construct the original champion/skin catalog from mounted installed data."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES
import struct


def initialize_binary_postload_tls(n):
    # The original full BIN loader temporarily binds its current library and
    # entry during post-load. These are thread variables, not readiness bits.
    variables=[s for s in n.source.sections if s[0]=='__thread_vars']
    data=[s for s in n.source.sections if s[0]=='__thread_data']
    bss=[s for s in n.source.sections if s[0]=='__thread_bss']
    if not len(variables)==len(data)==len(bss)==1:raise ValueError('Exact binary post-load TLS sections required')
    rows=[]
    for descriptor,offset in [(0x24882c8,0x50),(0x24882e0,0x58)]:
        raw=bytes(n.source.image[descriptor:descriptor+24])
        template=data[0][1]+offset
        if (not variables[0][1]<=n.base+descriptor<=variables[0][1]+variables[0][2]-24 or
                struct.unpack('<QQQ',raw)!=(0,0,offset) or not bss[0][1]<=template<=bss[0][1]+bss[0][2]-8 or
                any(n.source.image[template-n.base:template-n.base+8])):
            raise ValueError('Original binary post-load thread-variable template differs')
        key=n.base+descriptor;existing=n.slots.get(key)
        if existing is None:
            cell=n.allocate(8);n.slots[key]=cell;n.put(key,'Q',ADDRESSES['tls'])
        else:
            cell=existing
            if n.q(key)!=ADDRESSES['tls'] or not n.library_pointer(cell,8):
                raise ValueError('Existing post-load thread-variable identity differs')
        rows.append({'descriptorRva':descriptor,'sourceDescriptorHex':raw.hex(),'templateOffset':offset,
                     'cell':cell,'reusedExistingCell':existing is not None,'initialValue':n.q(cell)})
    return {'variables':rows,'singleOwnedThread':True,'fullThreadRuntimeInitialized':False}


def initialize_binary_resource_cache(n):
    if n.q(n.base+0x247b830):
        raise ValueError('Original binary resource cache is not cold')
    owner=n.allocate(0x170)
    n.u.mem_write(owner+0x70,bytes([0xa5])*0x100)
    n.call(0x14b7c90,{r.UC_X86_REG_RDI:owner})
    mutex=n.character_mutexes.get(owner+0x18)
    if (n.q(n.base+0x247b830)!=owner or not mutex or not mutex['recursive'] or mutex['depth'] or
            bytes(n.u.mem_read(owner+0x70,0x100))!=bytes([0xa5])*0x100):
        raise ValueError('Original binary resource-cache constructor publication/guard differs')
    return {'object':owner,'constructorRva':0x14b7c90,'originalConstructorCompleted':True,
            'guardIntact':True,'objectBytes':0x70,'recursiveMutex':dict(mutex)}


def initialize_champion_catalog(n):
    if n.q(n.base+0x246bcb0):raise ValueError('Original champion catalog is already initialized')
    owner=n.allocate(0x128)
    n.u.mem_write(owner+0x28,bytes([0xa5])*0x100)
    record={'object':owner,'objectBytes':0x28,'constructorRva':0x2a29d0,
            'originalConstructorCompleted':False,'slices':[]}
    n.champion_catalog_observation=record
    n.u.context_restore(n.initial)
    n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
    n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
    n.u.reg_write(r.UC_X86_REG_RDI,owner)
    start=n.base+0x2a29d0
    for index in range(16):
        n.u.emu_start(start,ADDRESSES['stop'],count=5000000)
        start=n.u.reg_read(r.UC_X86_REG_RIP)
        record['slices'].append({'slice':index+1,'instructionBound':5000000,'stop':start})
        if start==ADDRESSES['stop']:break
    else:raise ValueError('Champion catalog constructor exceeds sixteen bounded CPU slices')
    if n.q(n.base+0x246bcb0)!=owner or bytes(n.u.mem_read(owner+0x28,0x100))!=bytes([0xa5])*0x100:
        raise ValueError('Original champion catalog publication/guard differs')
    pointer,count,capacity=n.q(owner+0x18),n.u32(owner+0x20),n.u32(owner+0x24)&0x7fffffff
    if not 0<count<=1024 or count>capacity or not n.library_pointer(pointer,count*8):
        raise ValueError('Original champion catalog has no bounded populated entry vector')
    names=[]
    for i in range(count):
        entry=n.q(pointer+i*8)
        if not n.library_pointer(entry,0x18):raise ValueError('Champion catalog entry escaped owned memory')
        text,length=n.q(entry+8),n.u32(entry+0x10)
        if not 0<length<=256 or not n.library_pointer(text,length):raise ValueError('Champion catalog name escaped owned string bounds')
        names.append(bytes(n.u.mem_read(text,length)).decode('utf-8'))
    if len(set(names))!=len(names):raise ValueError('Champion catalog contains duplicate names')
    record.update(originalConstructorCompleted=True,guardIntact=True,names=names,
                  entryCount=count,objectHex=bytes(n.u.mem_read(owner,0x28)).hex(),
                  scope={'worldBindingsVerified':False,'allSkinsVerified':False,'assetReadinessVerified':False})
    return record

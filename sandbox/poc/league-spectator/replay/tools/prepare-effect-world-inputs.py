"""Prove the four entity-pointer inputs to the original creation descriptor.

Original world/entity constructors and ID registration execute. Sampled decoded
IDs are registered to supplied base entities with explicitly empty resource
stacks; this is pointer-routing evidence, not reconstructed live unit state.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from unit_resource_native import NativeUnitResources
from vfx_spawn_native import sha

FIELDS={
    'resourceContextEntityId':{'entryOffset':0x24,'descriptorOffset':0x10,'getter':[0x84ec42,0x84ecfb]},
    'lookup14EntityId':{'entryOffset':0x14,'descriptorOffset':0x18,'getter':[0x84edc9,0x84ee42]},
    'attachmentEntityId':{'entryOffset':0x48,'descriptorOffset':0x20,'getter':[0x84ecfe,0x84edc9]},
    'lookupA8EntityId':{'entryOffset':0xa8,'descriptorOffset':0x28,'getter':[0x84ee42,0x84ef22]},
}
ENTRY,GROUP,FRAME=0x100f1000,0x100f2000,0x100f5000


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path);p.add_argument('client',type=Path);args=p.parse_args()
    cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    def read(path):return json.loads(raw(path))
    profile=read(assets/'decoder-16.21-macos/profile.json')
    package=read(assets/'latest-effect-descriptor/package.json')
    creation=read(cache/'research/effect-creation-native.json')
    objects=read(cache/'research/effect-creation-objects-native.json')
    report=read(cache/'research/latest-semantics-effects.json')
    if (report['build']!=profile['clientVersion'] or report['protocol']!=profile['protocolDigest'] or
            package['decoderImageSha256']!=profile['decoderImageSha256']):raise ValueError('Matching decoded descriptor inputs required')
    n=NativeUnitResources(assets/'decoder-16.21-macos',args.client)
    world=n.allocate(0x168);n.call(0x54a4d0,{r.UC_X86_REG_RDI:world})
    if n.q(n.base+0x24722c0)!=world:raise ValueError('Original world registry was not published')
    selected={}
    for record in creation['records']:
        mask=sum((1<<i) for i,key in enumerate(FIELDS) if record[key])
        selected.setdefault(mask,record)
    units={};cases=[]
    for mask,record in sorted(selected.items()):
        obs=objects['observations'][record['key']]
        if obs['status']!='complete':raise ValueError('Incomplete original packet object')
        obj=bytes.fromhex(obs['object']);heap=bytes.fromhex(obs['heap'])
        def at(pointer,length):
            offset=pointer-0x10200000
            if not 0<=offset<=len(heap)-length:raise ValueError('Packet vector exceeds original arena')
            return heap[offset:offset+length]
        gp=struct.unpack_from('<Q',obj,0x10)[0];group=at(gp+record['groupIndex']*0x50,0x50)
        ep=struct.unpack_from('<Q',group,0x38)[0];entry=at(ep+record['entryIndex']*0xb8,0xb8)
        for key in FIELDS:
            identity=record[key]
            if identity and identity not in units:
                unit=n.create_unit()
                n.call(0x549580,{r.UC_X86_REG_RDI:unit['object'],r.UC_X86_REG_RSI:identity})
                n.call(0x548f00,{r.UC_X86_REG_RDI:world,r.UC_X86_REG_RSI:identity})
                if n.u.reg_read(r.UC_X86_REG_RAX)!=unit['object']:raise ValueError('Original unit ID registration/lookup differs')
                units[identity]=unit
        n.u.mem_write(ENTRY,entry);n.u.mem_write(GROUP,group);n.u.mem_write(FRAME-0x200,bytes(0x200))
        n.put(FRAME-0x38,'Q',GROUP);n.put(FRAME-0x40,'Q',ENTRY)
        n.call(0x84ec42,{r.UC_X86_REG_RBP:FRAME,r.UC_X86_REG_RBX:ENTRY},0x84ef29)
        pointers={'resourceContextEntityId':n.u.reg_read(r.UC_X86_REG_R12),
            'lookup14EntityId':n.q(FRAME-0x80),'attachmentEntityId':n.q(FRAME-0x78),
            'lookupA8EntityId':n.u.reg_read(r.UC_X86_REG_R8)}
        expected={key:units[record[key]]['object'] if record[key] else 0 for key in FIELDS}
        if pointers!=expected:raise ValueError('Original four world lookups disagree with decoded ID fields')
        n.call(0x84f02b,{r.UC_X86_REG_RBP:FRAME,r.UC_X86_REG_R8:pointers['lookupA8EntityId'],
            r.UC_X86_REG_R12:pointers['resourceContextEntityId']},0x84f033)
        n.call(0x84f530,{r.UC_X86_REG_RBP:FRAME,r.UC_X86_REG_RBX:pointers['lookup14EntityId'],
            r.UC_X86_REG_R15:0,r.UC_X86_REG_R12:0},0x8501af)
        descriptor=bytes(n.u.mem_read(FRAME-0x190,0xc0))
        actual={key:struct.unpack_from('<Q',descriptor,value['descriptorOffset'])[0] for key,value in FIELDS.items()}
        if actual!=expected:raise ValueError('Original descriptor prefix omitted/reordered an entity pointer')
        cases.append({'mask':mask,'source':{'key':record['key'],'groupIndex':record['groupIndex'],'entryIndex':record['entryIndex']},
            'entityIds':{key:record[key] for key in FIELDS},'pointers':actual,'descriptorHex':descriptor.hex(),
            'entryHex':entry.hex(),'groupHex':group.hex()})
    ranges=[(0x84ec42,0x84ef29),(0x84f02b,0x84f033),(0x84f530,0x8501af),(0x548f00,0x548f50),(0x549580,0x549660)]
    blocks=[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])} for a,b in ranges]
    meta={'schema':1,'kind':'prepared-original-effect-world-inputs','build':profile['clientVersion'],
        'protocol':profile['protocolDigest'],'decoderImageSha256':profile['decoderImageSha256'],
        'descriptorPackageSha256':sha(raw(assets/'latest-effect-descriptor/package.json')),
        'fields':FIELDS,'factoryUnitOrder':['resourceContextEntityId','lookupA8EntityId'],
        'factoryUnitOrderScope':{'field8c':0},
        'sourceBlocks':blocks,'producerSha256':sha(Path(__file__).read_bytes()),
        'scope':{'staticBuildDataOnly':True,'containsReplayEvents':False,'originalWorldLookupAndPointerPrefixExecuted':True,
            'liveUnitStateReconstructed':False,'liveOverlayStateReconstructed':False,'factoryExecuted':False}}
    encoded=json.dumps(meta,indent=2).encode();out=assets/'latest-effect-world-inputs/package.json';out.parent.mkdir(exist_ok=True);out.write_bytes(encoded)
    current=bytes(n.u.mem_read(n.base,len(n.image)))
    patches=[{'rva':at,'bytesHex':current[at:at+4096].hex()} for at in range(0,len(n.image),4096) if current[at:at+4096]!=n.image[at:at+4096]]
    if any(patch['rva']<0x1fef000 for patch in patches):raise ValueError('World-input snapshot attempted to patch original code')
    per_field={key:sum(d[key]!=0 for d in report['effectDescriptors']) for key in FIELDS}
    with_refs=sum(any(d[key] for key in FIELDS) for d in report['effectDescriptors'])
    result={'schema':1,'kind':'original-effect-world-input-observations','inputs':inputs,'packageSha256':sha(encoded),
        'sources':{p.name:sha(p.read_bytes()) for p in {Path(__file__),*[Path(inspect.getfile(c)) for c in NativeUnitResources.__mro__ if c is not object]}},
        'originalBlocks':list(n.blocks.values()),'cases':cases,'units':units,
        'worldSnapshot':{'world':world,'heapAddress':0x10400000,'heapHex':bytes(n.u.mem_read(0x10400000,n.next_heap-0x10400000)).hex(),
            'imagePatches':patches},'counts':{'pointerPatterns':len(cases),
            'pointerFieldsCompared':len(cases)*4,'constructedUnits':len(units),'replayRequests':len(report['effectDescriptors']),
            'requestsWithEntityReferences':with_refs,'requestsWithoutEntityReferences':len(report['effectDescriptors'])-with_refs,
            'nonzeroFields':per_field},'scope':{'suppliedEmptyUnitStacks':True,'originalBaseUnitConstructor':True,
                'originalIdRegistration':True,'originalPacketLookupPrefix':True,'originalDescriptorPointerStores':True,
                'packetPositionOverrideExecuted':False,'actualMatchRegistryReconstructed':False,'factoryExecuted':False}}
    (cache/'research/effect-world-inputs-native.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(encoded),'counts':result['counts']}))


if __name__=='__main__':main()

"""Original typed skin bounds, processed-resource getters and cached-AABB math.

Model resource/scale/root inputs are supplied from the installed viewer model.
This never establishes live native model readiness, extra displays, or gameplay
scale selection. No collision radius or absent-model zero is substituted.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from vfx_asset_native import STREAM, VTABLE, CALLBACK
from vfx_spawn_native import name_hash, sha


def f(value): return struct.unpack('<f', struct.pack('<f', value))[0]
def floats(data): return list(struct.unpack('<'+'f'*(len(data)//4),data))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--scene-cache',required=True,type=Path)
    a=p.parse_args()
    cache=a.cache.resolve(); scene_cache=a.scene_cache.resolve(); inputs={}
    def raw(path):
        path=path.resolve(); data=path.read_bytes(); inputs[str(path)]=sha(data); return data
    n=NativeCharacterAssets(cache/'public/decoder-16.21-macos',a.client)
    n.initialize_character_types()
    typ=n.type_catalog['6111d8a4']
    properties={p['hash']:p for p in typ['properties']}
    expected=[('overrideBoundingBox',0x60,133),('boundingSphereRadius',0x74,133),('skinScale',0x48,10)]
    for name,offset,kind in expected:
        prop=properties[name_hash(name)]
        if (prop['offset'],prop['type'])!=(offset,kind): raise ValueError('Original skin bound property differs')
    frame=n.allocate(0x400)+0x300
    shell=n.allocate(0x100); header=n.allocate(0x100); processed=n.allocate(0xa0)
    n.put(shell+0x10,'Q',header); n.put(shell+0x18,'Q',processed)
    n.put(processed,'Q',n.base+0x23fdad0)
    if n.q(n.base+0x23fdad0+0x28)!=n.base+0x1863760: raise ValueError('Original radius vtable slot differs')
    def field(name,kind,payload): return struct.pack('<IB',name_hash(name),kind)+payload
    def load(box=None,radius=None,scale=None):
        fields=[]
        if box is not None: fields.append(field('overrideBoundingBox',133,struct.pack('<BB3f',12,1,*box)))
        if radius is not None: fields.append(field('boundingSphereRadius',133,struct.pack('<BBf',10,1,radius)))
        if scale is not None: fields.append(field('skinScale',10,struct.pack('<f',scale)))
        loaded=n.observe_actor_fields(0x6111d8a4,fields)
        if loaded['originalSkippedFields'] or loaded['pendingReferences']: raise ValueError('Bound-only controls must load all fields without links')
        n.put(shell,'Q',loaded['object'])
        return loaded
    def resource(case, box, radius, skin_scale):
        loaded=load(box,radius,skin_scale)
        n.put(header+0x44,'6f',*case['meshBounds'])
        # Original source bounds selection before CPU processing/allocations.
        n.call(0x184cc22,{r.UC_X86_REG_RDI:shell,r.UC_X86_REG_RBX:shell,r.UC_X86_REG_RBP:frame},0x184ccab)
        # Original publication after the explicitly excluded CPU processing.
        n.call(0x184ccf9,{r.UC_X86_REG_RBX:shell,r.UC_X86_REG_R14:header,r.UC_X86_REG_RBP:frame},0x184cd77)
        n.call(0x1863760,{r.UC_X86_REG_RDI:processed})
        radius_bits=(n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff).to_bytes(4,'little')
        bounds=bytes(n.u.mem_read(processed+0x24,24))
        magnitude=lambda v:-v if v<0 else v
        m=list(map(f,case['meshBounds'])); chosen=list(map(f,box)) if box is not None else [magnitude(f(m[3]-m[0])),f(m[4]-m[1]),magnitude(f(m[5]-m[2]))]
        expected_bounds=struct.pack('<6f',0,m[1],0,f(chosen[0]+0),f(chosen[1]+m[1]),f(chosen[2]+0))
        expected_radius=struct.pack('<f',-f(3.4028234663852886e38) if radius is None or f(radius)==f(3.4028234663852886e38) else radius)
        if bounds!=expected_bounds or radius_bits!=expected_radius: raise ValueError(f'Original resource bounds/radius bytes differ: case={case}, box={box}, actual={bounds.hex()}, expected={expected_bounds.hex()} radius={radius_bits.hex()} expectedR={expected_radius.hex()}')
        return {**case,'suppliedBox':box,'suppliedRadius':radius,'suppliedSkinScale':skin_scale,'typedObjectHex':loaded['objectHex'],'resourceBoundsHex':bounds.hex(),'resourceBounds':floats(bounds),'radiusHex':radius_bits.hex(),'radius':floats(radius_bits)[0],'sphereUsable':floats(radius_bits)[0]>=0}
    controls=[]
    for bounds in [[-2,-3,-4,8,17,26],[-0.0,-11.25,2.5,1/3,7.75,87.125],[0,0,0,-0.0,-0.0,-0.0]]:
        for box in [None,[12.25,23.5,45.75],[-0.0,0,-0.0]]:
            for radius in [None,-1.0,-0.0,0.0,37.25,f(3.4028234663852886e38)]:
                controls.append(resource({'meshBounds':bounds},box,radius,1.3))
    parent,holder,system_definition,component,link,emitter_definition,flex,component_list,birth,particle=[n.allocate(size)for size in [0x2c0,0x40,0x300,0x200,0x40,0x470,48,8,0x40,0x40]]
    flex_type=n.type_catalog['b13097f0']
    n.call(flex_type['constructRva'],{r.UC_X86_REG_RDI:flex});n.put(flex+4,'f',f(.005))
    n.put(parent+0x1d8,'Q',holder);n.put(holder+0x38,'Q',system_definition);n.put(system_definition+0x74,'I',0x7f7fffff)
    n.put(parent+0x40,'QI',component_list,1);n.put(component_list,'Q',component)
    n.put(component,'QQ',parent,link);n.put(link+0x10,'Q',emitter_definition);n.put(emitter_definition+0x258,'Q',flex)
    flex_controls=[]
    for size in [0,100,200,336.0594482421875,400,500,198.40867614746094,0]:
        n.call(0x1763fd0,{r.UC_X86_REG_RDI:parent,r.UC_X86_REG_XMM0:int.from_bytes(struct.pack('<f',size),'little')})
        factor=floats(bytes(n.u.mem_read(component+0xb0,4)))[0]
        normalized=floats(bytes(n.u.mem_read(parent+0x1cc,4)))[0]
        expected_size=f(size) if f(size)<=200 else 250 if f(size)>=500 else f(f(50*f(f(f(size)-200)/300))+200)
        if normalized!=expected_size:raise ValueError('Original parent bound-size default normalization differs')
        expected=f(f(.005)*normalized);expected=expected if expected>0 else 1
        if factor!=expected:raise ValueError(f'Original live component Flex setter differs: size={size}, native={factor}, expected={expected}, count={n.u32(parent+0x48)}')
        for initial,curve in [([10,150],[.7090908885,.2]),([1/3,-0.0],[1/7,2.25]),([12345.75,987.25],[.33333334,.7777778])]:
            n.put(birth+0x10,'2f',*initial);n.put(frame-0x120,'4f',factor,factor,factor,factor)
            n.call(0x175f538,{r.UC_X86_REG_R14:birth,r.UC_X86_REG_RAX:0,r.UC_X86_REG_R13:particle,r.UC_X86_REG_RBX:0,r.UC_X86_REG_RBP:frame,
                            r.UC_X86_REG_XMM0:int.from_bytes(struct.pack('<4f',*curve,0,0),'little')},0x175f54f)
            native=bytes(n.u.mem_read(particle+0x14,8));expected=struct.pack('<2f',*[f(f(f(x)*f(y))*factor)for x,y in zip(initial,curve)])
            if native!=expected:raise ValueError('Original current particle scale Flex order differs')
            flex_controls.append({'boundSize':f(size),'parentBoundSize':normalized,'factor':factor,'birthScale':initial,'sampledScale':curve,'currentScaleHex':native.hex()})
    scene=json.loads(raw(scene_cache/'public/latest-scene/manifest.json'))
    actors=[]
    unit=n.allocate(0x200);wrapper=n.allocate(0x300)
    def projected_bound(bounds,scale,position):
        n.u.mem_write(processed+0x24,bytes.fromhex(bounds))
        n.call(0xc137f,{r.UC_X86_REG_R14:processed+0x24,r.UC_X86_REG_RBP:frame},0xc1421)
        n.put(unit+0x15c,'3f',*position)
        n.call(0xc1471,{r.UC_X86_REG_R14:processed+0x24,r.UC_X86_REG_RBX:unit,r.UC_X86_REG_RBP:frame,
                      r.UC_X86_REG_XMM3:int.from_bytes(struct.pack('<f',scale),'little'),
                      r.UC_X86_REG_XMM0:int.from_bytes(struct.pack('<f',1),'little')},0xc1514)
        native=bytes(n.u.mem_read(frame-0x60,24))
        n.call(0x5492ed,{r.UC_X86_REG_RDI:unit,r.UC_X86_REG_RSI:frame-0x60},0x54933a)
        n.call(0xd1680,{r.UC_X86_REG_RDI:unit})
        bound_ptr=n.u.reg_read(r.UC_X86_REG_RAX)
        if bound_ptr!=unit+0x98 or bytes(n.u.mem_read(bound_ptr,24))!=native:raise ValueError('Original cached AABB publication differs')
        n.call(0x36ada6,{r.UC_X86_REG_R14:bound_ptr,r.UC_X86_REG_RBX:wrapper},0x36ade9)
        result=bytes(n.u.mem_read(wrapper+0x224,4))
        return {'root':position,'modelScale':scale,'cachedAabbHex':native.hex(),'cachedAabb':floats(native),'boundSizeHex':result.hex(),'boundSize':floats(result)[0]}
    for key,asset in scene['champions'].items():
        directory=Path(asset['model']).parent
        skin=json.loads(raw(scene_cache/'public/latest-scene'/asset['skinDefinition']))
        props=skin[f"Characters/{asset['champion']}/Skins/Skin{asset['skinId']}"]['skinMeshProperties']
        if props.get('__type')!='SkinMeshDataProperties': raise ValueError('Exact installed skin class required')
        skn=raw(scene_cache/'public/latest-scene'/directory/'model.skn')
        if struct.unpack_from('<IHH',skn)!=(0x112233,4,1):
            actors.append({'actorKey':key,'sourceSknSha256':sha(skn),'status':'unsupported-skn-version','sourceVersion':list(struct.unpack_from('<IHH',skn))})
            continue
        groups=struct.unpack_from('<I',skn,8)[0]; at=12+groups*80
        if not 0<groups<=4096 or at+60>len(skn): raise ValueError('SKN bounds span invalid')
        # Execute the unchanged reader only through its complete 60-byte header
        # read, before vertex allocation/conversion or graphics/resource setup.
        n.put(STREAM,'Q',VTABLE);n.put(VTABLE+0x10,'Q',CALLBACK)
        n.input,n.cursor=skn,0
        name=n.allocate(len(props['simpleSkin'].encode())+1)
        n.u.mem_write(name,props['simpleSkin'].encode()+b'\0')
        n.call(0x1853e60,{r.UC_X86_REG_RDI:name,r.UC_X86_REG_RSI:STREAM,r.UC_X86_REG_RDX:4},0x1854026)
        native_frame=n.u.reg_read(r.UC_X86_REG_RBP)
        native_header=bytes(n.u.mem_read(native_frame-0x110,60))
        source_end=n.cursor
        if n.cursor!=at+60 or native_header!=skn[at:at+60]:raise ValueError('Original SKN header/group reader differs')
        native_header_ptr=n.allocate(60);n.u.mem_write(native_header_ptr,native_header)
        n.call(0x1853ac5,{r.UC_X86_REG_R14:native_header_ptr,r.UC_X86_REG_RSI:header},0x1853ae8)
        bounds=floats(bytes(n.u.mem_read(header+0x44,24)))
        if struct.pack('<6f',*bounds)!=skn[at+20:at+44]:raise ValueError('Original native mesh constructor header bounds differ')
        row=resource({'actorKey':key,'meshBounds':bounds,'sourceSknSha256':sha(skn),'authoredMeshPath':props['simpleSkin']},props.get('overrideBoundingBox'),props.get('boundingSphereRadius'),props.get('skinScale',1))
        if not all(map(lambda x:abs(x)<f(3.4028234663852886e38),row['resourceBounds'])): raise ValueError('Finite installed resource bound required')
        row['nativeSknHeaderPrefix']={'sourceEndOffset':source_end,'headerHex':native_header.hex(),'stoppedBeforeVertexAllocation':True}
        row['suppliedViewerBounds']=[projected_bound(row['resourceBoundsHex'],asset['scale'],root)for root in [[0,0,0],[123.125,-91.75,8024.5],[12000.0625,41.25,13333.875]]]
        actors.append(row)
    ranges=[(0x54dc10,0x54dd9c),(0x54dda0,0x54de30),(0xd1680,0xd168d),(0x1128d0,0x1129c6),(0x1849fa0,0x1849faa),(0x184cc10,0x184cd84),(0x1863730,0x186376b),(0x1874fa0,0x18750d3),(0x36ad54,0x36ade9),(0xc1320,0xc1519),(0x5492e0,0x549476),(0x1853e60,0x1854030),(0x1853ac5,0x1853ae8)]
    paths={Path(__file__),*[Path(inspect.getfile(c))for c in type(n).__mro__ if c is not object],cache/'public/decoder-16.21-macos/profile.json',cache/'public/decoder-16.21-macos/image.bin'}
    for path in paths: raw(path)
    result={'schema':1,'kind':'original-attached-bound-resource-source-control','artifactVersion':37,'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':inputs,'typedSkinProperties':typ,'controls':controls,'flexControls':flex_controls,'actors':actors,'sourceBlocks':[{'rva':lo,'size':hi-lo,'sha256':sha(n.image[lo:hi])}for lo,hi in ranges],'originalBlocks':list(n.blocks.values()),'scope':{'originalTypedSkinConstructorAndReaders':True,'originalResourceBoundsAndRadiusPublication':True,'originalSknVersionGroupHeaderPrefixAndNativeFieldCopy':True,'originalComponentSetterAndCurrentParticleScaleOrder':True,'completeNativeMeshResourceCreation':False,'actualNativeModelReadiness':False,'originalCachedAabbMathWithSuppliedViewerInputs':True,'nativeExtraDisplayAndGameplayScaleSelection':False,'cachedUnitAabbProducerTranslated':False,'actualReplayBoundSizeIntegrated':False}}
    output=scene_cache/'research/attached-bound-resource-native-v37.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'controls':len(controls),'actors':len(actors),'usableSphereActors':sum(row.get('sphereUsable',False)for row in actors),'sha256':sha(output.read_bytes())}))


if __name__=='__main__':main()

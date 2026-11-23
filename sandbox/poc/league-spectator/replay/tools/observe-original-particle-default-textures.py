"""Original graphics defaults and sampler fallback branches with real GPU bytes.

The controls supply absent texture names and slots. They do not establish live
resource readiness, shared remap selection or a match fog environment.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_graphics_native import NativeCharacterGraphics
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from vfx_graphics_native import NativeVfxGraphicsContext,DEVICE,DEVICE_VTABLE
from vfx_mesh_native import NativeVfxMeshContext
from vfx_spawn_native import ADDRESSES as A,sha

parser=argparse.ArgumentParser(description=__doc__)
for name in ['package','client','angle','output']:parser.add_argument(name,type=Path)
args=parser.parse_args()
inputs={str(path.resolve()):sha(path.read_bytes()) for path in [args.package/'profile.json',args.package/'image.bin',args.client,args.angle/'libEGL.dll',args.angle/'libGLESv2.dll']}
paths={Path(__file__),Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsMeshDevice)),Path(inspect.getfile(NativeVfxGraphicsContext)),Path(inspect.getfile(NativeVfxMeshContext)),Path(__file__).with_name('macho.py'),Path(__file__).with_name('render-particle-shader.py'),Path(__file__).with_name('observe-shader-angle.py'),*[Path(inspect.getfile(base)) for base in NativeCharacterGraphics.__mro__ if base is not object]}
sources={path.name:sha(path.read_bytes()) for path in paths}
n=NativeCharacterGraphics(args.package,args.client)
graphics=None;controls=[];boundary=None;remap=None;remap_boundary=None;color_route=None
try:
    n.call(0x14aa3bf,{},end=0x14aa5f9)
    graphics=n.initialize_character_graphics(args.angle)
    manager=n.q(n.base+0x246fdf0)
    names=[(slot,0,'null-identity-control') for slot in [0,1,2,7,10]]
    for text in ['', '__scout_missing_resource_control__']:
        encoded=text.encode();characters=n.allocate(len(encoded)+1);n.u.mem_write(characters,encoded+b'\0')
        wrapper=n.allocate(16);n.put(wrapper,'QII',characters,len(encoded),len(encoded)+1)
        n.call(0x1499af0,{r.UC_X86_REG_RDI:wrapper})
        identity=n.u.reg_read(r.UC_X86_REG_RAX)
        names.extend((slot,identity,'original-interned-empty-name' if not text else 'original-interned-nonempty-name') for slot in ([0,1,2,7,10] if not text else [1]))
    for slot,identity,kind in names:
        frame=A['stack']-8
        name=n.allocate(8);n.put(name,'Q',identity)
        n.put(frame-0x48,'Q',0)
        n.call(0x16e3aa6,{r.UC_X86_REG_R12:name,r.UC_X86_REG_R15:slot,r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x80},end=0x16e3b41)
        selected_box=n.u.reg_read(r.UC_X86_REG_R12)
        expected=manager+(0xa8 if slot==0 or kind=='original-interned-nonempty-name' else 0xa0)
        if selected_box!=expected:raise ValueError('Original absent-name sampler fallback did not select its measured manager field')
        wrapper=n.q(selected_box);table=n.q(wrapper);getter=n.q(table+8)
        if not n.base<=getter<n.base+0x1fef000:raise ValueError('Original default texture getter required')
        n.call(getter-n.base,{r.UC_X86_REG_RDI:wrapper})
        header=n.u.reg_read(r.UC_X86_REG_RAX)
        resources=[record for record in n.gpu_records if record['pointer']==header]
        if len(resources)!=1 or not resources[0]['gpuBytesVerified']:raise ValueError('Original default sampler lacks verified GPU bytes')
        controls.append({'suppliedSlot':slot,'suppliedNameIdentity':identity,'suppliedNameIdentityDecimal':str(identity),'nameControl':kind,'managerFieldOffset':selected_box-manager,'wrapper':wrapper,'getterRva':getter-n.base,'header':header,'resource':resources[0]})
    # Execute the exact original semantic caller over an explicitly supplied
    # empty color string. Its argument registers and original name table prove
    # slot identity; this does not substitute a default for an authored name.
    emitter=n.allocate(0x200);characters=n.allocate(1);n.put(emitter+0xa8,'QII',characters,0,1)
    link=n.allocate(0x100);frame=A['stack']-8
    n.call(0x16dec64,{r.UC_X86_REG_RDI:emitter,r.UC_X86_REG_RBX:link,r.UC_X86_REG_R15:0,r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x200},end=0x16dec8d)
    native_slot=n.u.reg_read(r.UC_X86_REG_ECX);name_box=n.u.reg_read(r.UC_X86_REG_RDX)
    if native_slot!=1 or n.cstring(n.q(n.base+0x23ef550+native_slot*8))!=b'PARTICLE_COLOR_TEXTURE':raise ValueError('Original particle color semantic slot/name differs')
    identity=n.q(name_box)
    if identity!=next(value for slot,value,kind in names if slot==1 and kind=='original-interned-empty-name'):raise ValueError('Original particle color caller did not intern the supplied empty string')
    n.put(frame-0x48,'Q',0)
    n.call(0x16e3aa6,{r.UC_X86_REG_R12:name_box,r.UC_X86_REG_R15:native_slot,r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x80},end=0x16e3b41)
    selected=n.u.reg_read(r.UC_X86_REG_R12)
    if selected!=manager+0xa0:raise ValueError('Original empty color semantic did not select manager A0')
    wrapper=n.q(selected);getter=n.q(n.q(wrapper)+8);n.call(getter-n.base,{r.UC_X86_REG_RDI:wrapper});header=n.u.reg_read(r.UC_X86_REG_RAX)
    matches=[record for record in n.gpu_records if record['pointer']==header]
    if len(matches)!=1 or not matches[0]['gpuBytesVerified']:raise ValueError('Original empty color route has no exact GPU resource')
    sampler_controls=[];n.put(link+0x10,'Q',emitter)
    for pixelated in [0,1]:
        for authored_address in range(4):
            n.put(emitter+0x12,'B',pixelated);n.put(emitter+0xc9,'B',authored_address)
            n.call(0x16e3910,{r.UC_X86_REG_RDI:link,r.UC_X86_REG_RCX:native_slot},end=0x16e3a53)
            sampler_frame=n.u.reg_read(r.UC_X86_REG_RBP);descriptor=bytes(n.u.mem_read(sampler_frame-0x40,5))
            if descriptor!=bytes([1,1,1,1-pixelated,1-pixelated]):raise ValueError('Original color semantic sampler control differs')
            sampler_controls.append({'authoredAddress':authored_address,'pixelated':bool(pixelated),'descriptorHex':descriptor.hex()})
    color_route={'semantic':'PARTICLE_COLOR_TEXTURE','nativeSlot':native_slot,'authoredPathControl':'','nativeNameIdentityDecimal':str(identity),'originalCallerPrefix':[0x16dec64,0x16dec8d],'originalNameTableRva':0x23ef550,'originalSamplerPrefix':[0x16e3910,0x16e3a53],'samplerControls':sampler_controls,'managerFieldOffset':selected-manager,'wrapper':wrapper,'getterRva':getter-n.base,'header':header,'resource':matches[0],'scope':{'originalEmptyNameCallerExecuted':True,'namedResourceAcquisition':False,'liveScenePredicates':False,'nativeRendererAdmitted':False}}
    # Use the actual original backend method at the observed virtual slot.
    # Unsupported device methods remain poisoned; a new dependency is a bound.
    method=n.q(n.base+0x2408570+0x278)
    if not n.base<=method<n.base+0x1fef000:raise ValueError('Original named Shared texture method not found in original backend vtable')
    n.put(DEVICE_VTABLE+0x278,'Q',method)
    owner=n.allocate(0xc0,0xa5);frame=A['stack']-8
    try:
        n.call(0x7456bd,{r.UC_X86_REG_R14:owner,r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x100},end=0x74571d)
        remap={'originalDeviceMethodRva':method-n.base,'owner':owner,'sharedTextureView':n.q(owner+0xa8),'sourceDefaultWrapper':n.q(manager+0xa8),'originalCallerRange':[0x7456bd,0x74571d]}
    except Exception as error:
        remap_boundary={'kind':type(error).__name__,'message':str(error),'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,'originalDeviceMethodRva':method-n.base,'owner':owner,'sharedTextureView':n.q(owner+0xa8),'registers':{name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name.upper())) for name in ['rax','rbx','rcx','rdx','rdi','rsi','r8','r9','r12','r14','r15','rbp','rsp']}}
except Exception as error:
    boundary={'kind':type(error).__name__,'message':str(error),'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
finally:
    n.close_graphics()
for path,digest in inputs.items():
    if sha(Path(path).read_bytes())!=digest:raise ValueError('Original default texture source input changed')
for path in paths:
    if sha(path.read_bytes())!=sources[path.name]:raise ValueError('Original default texture observer source changed')
sites=[(0x14aa3bf,0x14aa5f9),(0x16dec64,0x16dec92),(0x16e3aa6,0x16e3b41),(0x17e25a0,0x17e2620),(0x23ef550,0x23ef550+11*8),(0x16e3910,0x16e3a53)]
result={'schema':1,'kind':'original-particle-default-texture-controls','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':inputs,'sources':sources,'graphics':graphics,'controls':controls,'boundary':boundary,'sharedRemap':remap,'sharedRemapBoundary':remap_boundary,'originalBlocks':list(n.blocks.values()),'sourceSites':[{'startRva':start,'endRva':end,'sha256':sha(n.image[start:end]),'bytesHex':n.image[start:end].hex()} for start,end in sites],'scope':{'completeOriginalTextureManagerConstructed':graphics is not None,'originalSlotFallbackExecuted':len(controls)==11,'verifiedGpuResources':len(controls)==11,'actualEmitterNameLookup':False,'sharedRemapSelectorExecuted':remap is not None,'liveScenePredicates':False,'matchActivation':False,'nativeRendererAdmitted':False}}
result['emptyParticleColorRoute']=color_route
args.output.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print(json.dumps({'output':str(args.output),'controls':len(controls),'graphics':graphics,'boundary':boundary,'sharedRemap':remap,'sharedRemapBoundary':remap_boundary}),flush=True)
if boundary:raise SystemExit(1)

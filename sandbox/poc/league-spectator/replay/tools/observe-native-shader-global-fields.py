"""Execute original Shared shader metadata constructors and complete field reads.

Only source-proved static descriptor LEA/CALL pairs execute. A missing type,
ignored field or unresolved native service remains an explicit failure boundary.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from character_graphics_native import NativeCharacterGraphics
from shader_global_registry_native import observe_shared_remap_registration,NativeShaderGlobalGraphics
from graphics_float4_texture_device import GraphicsFloat4TextureDevice
from vfx_graphics_native import NativeVfxGraphicsContext
from vfx_mesh_native import NativeVfxMeshContext
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from vfx_asset_native import REGISTRY
from vfx_spawn_native import sha
parser=argparse.ArgumentParser(description=__doc__)
for name in ['package','client','fields','output']:parser.add_argument(name,type=Path)
parser.add_argument('--registration',action='append',type=Path,required=True)
parser.add_argument('--graphics-angle',type=Path)
args=parser.parse_args();request_bytes=args.fields.read_bytes();request=json.loads(request_bytes)
if request['kind']!='original-shared-shader-typed-field-inputs' or request['build']!='16.21.829.8620' or request['protocol']!='20e09df23c66b85e':raise ValueError('Exact original Shared shader field inputs required')
inputs={str(args.fields.resolve()):sha(request_bytes),**request['inputs']}
native_type=NativeShaderGlobalGraphics if args.graphics_angle else NativeCharacterAssets
source_paths={Path(__file__),Path(__file__).with_name('inspect-original-reflection-registration.py'),Path(__file__).with_name('macho.py'),Path(__file__).with_name('shader_global_registry_native.py'),*[Path(inspect.getfile(base)) for base in native_type.__mro__ if base is not object]}
if args.graphics_angle:
  source_paths.update(Path(inspect.getfile(cls)) for cls in [NativeVfxGraphicsContext,NativeVfxMeshContext,GraphicsTextureDevice,GraphicsMeshDevice])
  source_paths.update([Path(__file__).with_name('render-particle-shader.py'),Path(__file__).with_name('observe-shader-angle.py')])
  source_paths.update([Path(__file__).with_name(name) for name in ['native_float4_texture_upload.py','native_pipeline_description.py','graphics_material_bindings.py','original_sampler_gpu.py']]+[Path(inspect.getfile(GraphicsFloat4TextureDevice))])
  for file in [args.graphics_angle/'libEGL.dll',args.graphics_angle/'libGLESv2.dll']:inputs[str(file.resolve())]=sha(file.read_bytes())
sources={file.name:sha(file.read_bytes()) for file in source_paths}
n=native_type(args.package,args.client);n.initialize_character_types();n.call(0x14aa3bf,{},end=0x14aa5f9)
for file in [args.package/'profile.json',args.package/'image.bin',args.client]:inputs[str(file.resolve())]=sha(file.read_bytes())
registrations=[];records=[];boundary=None;fixups=None;shared_registry=None
try:
  for file in args.registration:
    raw=file.read_bytes();proof=json.loads(raw);inputs[str(file.resolve())]=sha(raw)
    if proof['kind']!='original-reflection-registration-source-candidates' or proof['decoderImageSha256']!=sha(n.image) or proof['profileSha256']!=sha((args.package/'profile.json').read_bytes()) or proof['sourceSha256']!=sources['inspect-original-reflection-registration.py']:raise ValueError('Original constructor source inventory differs')
    for record in proof['records']:
      candidates=record['candidates']
      if len(candidates)!=1:raise ValueError('Unique original metadata constructor required')
      candidate=candidates[0];pairs=[caller for caller in candidate['callers'] if caller['staticDescriptorRva'] is not None]
      if len(pairs)>1:raise ValueError('Ambiguous original metadata static caller')
      if not pairs:continue
      caller=pairs[0];start=caller['adjacentLeaRdiRva'];end=caller['callRva']+5;raw=n.image[start:end]
      if raw[:3]!=bytes.fromhex('488d3d') or raw[7]!=0xe8 or len(raw)!=12 or sha(raw)!=caller['pairSha256'] or end+struct.unpack_from('<i',raw,8)[0]!=candidate['candidateFramePrologueRva'] or start+7+struct.unpack_from('<i',raw,3)[0]!=caller['staticDescriptorRva'] or raw!=n.source.image[start:end]:raise ValueError('Exact original descriptor LEA/CALL identity differs')
      identity=int(record['classHash'],16);descriptor=n.base+caller['staticDescriptorRva']
      if identity not in n.types:n.call(start,{},end)
      count,array=n.u32(n.base+REGISTRY+8),n.q(n.base+REGISTRY)
      if not 0<count<=4096:raise ValueError('Original metadata registry exceeded bounds')
      types={}
      for index in range(count):
        pointer=n.q(array+index*8)
        if not n.base+0x1fef000<=pointer<=n.base+len(n.image)-0x88 or n.u32(pointer+8) in types:raise ValueError('Original metadata descriptor duplicate or unowned')
        types[n.u32(pointer+8)]=pointer
      n.types=types
      if n.types.get(identity)!=descriptor:raise ValueError('Original metadata constructor did not publish its source-proved descriptor')
      registrations.append({'classHash':record['classHash'],'callerPrefix':[start,end],'constructorRva':candidate['candidateFramePrologueRva'],'descriptorRva':caller['staticDescriptorRva']})
  n.type_catalog=n.catalog()
  missing=[key for key in request['classHashes'] if int(key,16) not in n.types]
  if missing:raise ValueError('Original Shared shader classes remain unregistered: '+','.join(missing))
  for root in request['roots']:
    source=Path(root['source']['file']);raw=source.read_bytes()
    if len(raw)!=root['source']['bytes'] or sha(raw)!=root['source']['sha256']:raise ValueError('Original shader BIN source differs')
    fields=[]
    for field in root['fields']:
      start,size=field['offset'],field['bytes'];data=raw[start:start+size]
      if start<0 or size<5 or len(data)!=size or sha(data)!=field['sha256'] or int.from_bytes(data[:4],'little')!=int(field['fieldHash'],16):raise ValueError('Original shader metadata field span differs')
      fields.append(data)
    result=n.observe_actor_fields(int(root['classHash'],16),fields)
    records.append({'ownerPathHash':root['ownerPathHash'],'classHash':root['classHash'],'sourceSha256':root['source']['sha256'],'status':'unsupported-original-skipped-fields' if result['originalSkippedFields'] else 'original-typed-root-fields-read','observation':result})
  if args.graphics_angle:
    loaded={int(row['ownerPathHash'],16):row for row in records};unique={}
    for row in records:
      for link in row['observation']['pendingReferences']:
        if link['destination'] in unique and unique[link['destination']]!=link:raise ValueError('Conflicting original queued Shared shader references')
        unique[link['destination']]=link
    links=list(unique.values())
    if len(links)>65536:raise ValueError('Original Shared shader reference queue exceeds bound')
    library,table,context,queue=n.allocate(0x48),n.allocate(max(24,len(loaded)*24)),n.allocate(24),n.allocate(max(16,len(links)*16))
    for index,(identity,row) in enumerate(sorted(loaded.items())):n.put(table+index*24,'QQII',row['observation']['object'],n.types[int(row['classHash'],16)],identity,0)
    n.put(library+0x10,'QII',table,len(loaded),len(loaded))
    for index,link in enumerate(links):
      if n.q(link['destination'])!=link['identity']:raise ValueError('Original Shared shader queued identity changed')
      if link['identity'] and link['identity'] not in loaded:raise ValueError('Original Shared shader dependency absent from complete declared source closure')
      n.put(queue+index*16,'QQ',link['destination'],link['expectedType'])
    n.put(context,'QQII',library,queue,len(links),len(links))
    def reject_global_miss(engine,address,size,user):raise ValueError('Original Shared shader local library reached a global resource miss')
    hook=n.u.hook_add(unicorn.UC_HOOK_CODE,reject_global_miss,begin=n.base+0x14bc000,end=n.base+0x14bc000)
    try:n.call(0x14bbf40,{r.UC_X86_REG_RDI:context})
    finally:n.u.hook_del(hook)
    if n.u32(context+0x10):raise ValueError('Original Shared shader fixup queue not exhausted')
    rejected=[]
    for link in links:
      expected=0
      if link['identity']:
        row=loaded[link['identity']];n.call(0x14b62d0,{r.UC_X86_REG_RDI:n.types[int(row['classHash'],16)],r.UC_X86_REG_RSI:row['observation']['object'],r.UC_X86_REG_RDX:link['expectedType']});expected=n.u.reg_read(r.UC_X86_REG_RAX)
        if not expected:rejected.append(link)
      if n.q(link['destination'])!=expected:raise ValueError('Original Shared shader fixup differs from original typed cast')
    fixups={'library':library,'context':context,'links':len(links),'rejectedNonNullReferences':rejected,'remainingQueue':n.u32(context+0x10),'originalFixupRva':0x14bbf40,'originalTypedCastRva':0x14b62d0}
    if rejected:raise ValueError('Original Shared shader references have incompatible original native types')
    shared_registry=observe_shared_remap_registration(n,records,args.graphics_angle)
except Exception as error:
  sp=n.u.reg_read(r.UC_X86_REG_RSP)
  boundary={'kind':type(error).__name__,'message':str(error),'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,'returnRva':n.q(sp)-n.base if n.library_pointer(sp,8) else None,'registers':{name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name.upper())) for name in ['rax','rbx','rcx','rdx','rdi','rsi','r8','r9','r12','r14','r15','rbp','rsp']}}
finally:
  if args.graphics_angle:n.close_graphics()
for file,digest in inputs.items():
  if sha(Path(file).read_bytes())!=digest:raise ValueError('Original Shared shader input changed')
for file in source_paths:
  if sha(file.read_bytes())!=sources[file.name]:raise ValueError('Original Shared shader observer source changed')
output={'schema':1,'kind':'original-shared-shader-field-reader-observations','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':inputs,'sources':sources,'registrations':registrations,'classes':{key:n.type_catalog.get(key) for key in request['classHashes']},'records':records,'localReferenceFixups':fixups,'sharedTextureRowRegistration':shared_registry,'partialGraphicsUploads':getattr(n,'gpu_records',[]),'partialFloat4Uploads':getattr(getattr(n,'float4_texture_backend',None),'records',[]),'partialGraphicsService':{'published':n.q(n.base+0x256e1b8),'ownedServiceVtable':[n.q(0x100f1100+offset) for offset in [0x30,0x38]],'ownedDeviceVtable':[n.q(0x100f1500+offset) for offset in [0x30,0x38]]} if args.graphics_angle else None,'boundary':boundary,'originalBlocks':list(n.blocks.values()),'scope':{'completeOriginalReaderDispositions':len(records)==len(request['roots']),'completeRootFieldsRead':len(records)==len(request['roots']) and not any(row['observation']['originalSkippedFields'] for row in records),'originalStaticCallerPrefixesExecuted':True,'nativeGlobalResourceRegistryInitialized':False,'resourceAcquisition':False,'gpuSubmission':False,'nativeRendererAdmitted':False}}
output['sharedRegistrationStages']=getattr(n,'shared_registration_stages',[])
output['partialOriginalSamplerDescription']=getattr(n,'shared_sampler_description',None)
output['partialGlesSamplerResources']=getattr(n,'shared_sampler_resources',{})
args.output.write_text(json.dumps(output,separators=(',',':')),encoding='utf-8');print(json.dumps({'output':str(args.output),'registrations':len(registrations),'records':len(records),'boundary':boundary}),flush=True)
if boundary:raise SystemExit(1)

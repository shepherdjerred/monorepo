"""Exercise complete native effect activation with real offscreen GPU resources.

Every selected authored root is attempted unchanged. Reaching an unimplemented
graphics interface is an explicit boundary, never a successful activation.
This is a native component observation, not WASM/browser or match coverage.
"""
import argparse
from collections import Counter
import ctypes as C
import inspect
import json
from pathlib import Path
import time
import unicorn
from PIL import Image
from unicorn import x86_const as r
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_graphics_native import NativeVfxGraphicsContext, MATERIAL_PASS_STARTUP, DEFAULT_TAGS
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:parser.add_argument(name,type=Path)
    parser.add_argument('--effect',action='append',help='Exact effect ID; defaults to the entire prepared catalog')
    parser.add_argument('--output',type=Path)
    parser.add_argument('--pipelines',action='store_true',help='Enable the native GLES pipeline/material bridge')
    parser.add_argument('--meshes',action='store_true',help='Also enable the read-only file mount and native mesh/GLES buffer bridge')
    parser.add_argument('--cubemaps',action='store_true',help='Also supply all prepared original DDS faces/mips through native cube registration')
    parser.add_argument('--seed',type=int,help='Explicit unsigned 64-bit admission seed; required with --pipelines')
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';inputs={}
    if args.cubemaps:args.meshes=True
    if args.meshes:args.pipelines=True
    context_type=NativeVfxGraphicsContext
    if args.pipelines:
        if args.seed is None or not 0<=args.seed<2**64:raise ValueError('Pipeline observation requires an explicit unsigned 64-bit seed')
        from vfx_pipeline_native import NativeVfxPipelineContext
        context_type=NativeVfxPipelineContext
        if args.meshes:
            from vfx_mesh_native import NativeVfxMeshContext
            context_type=NativeVfxMeshContext
    elif args.seed is not None:raise ValueError('Random seed is only supported by the pipeline context')
    def raw(path):
        data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    def read(path):return json.loads(raw(path))
    systems=read(assets/'latest-vfx-system-assets/package.json')
    effects=read(assets/'latest-effects/manifest.json')
    supplement=read(assets/'latest-native-textures/package.json')
    context=read(assets/'latest-vfx-resource-context/package.json')
    cube_package=None
    if args.cubemaps:
        cube_package=read(assets/'latest-dds-cubes/package.json')
        if (cube_package['kind']!='prepared-dds-cubemaps' or cube_package['build']!='16.21.829.8620' or
                cube_package['protocol']!='20e09df23c66b85e' or not cube_package['scope']['allAuthoredFacesAndMips']):
            raise ValueError('Unadmitted prepared DDS cube package')
        for path,expected in cube_package['inputs'].items():
            if sha(raw(Path(path)))!=expected:raise ValueError('Prepared DDS cube input changed')
        for name,expected in cube_package['sources'].items():
            if sha(raw(Path(__file__).with_name(name)))!=expected:raise ValueError('Prepared DDS cube producer changed')
    static_files={}
    if args.meshes:
        for path,ref in effects['assets'].items():
            if ref.get('kind')!='texture' and ref.get('rawFile'):
                data=raw(assets/'latest-effects'/ref['rawFile'])
                if sha(data)!=ref['sourceSha256']:raise ValueError('Prepared native file source changed')
                static_files[path]={'bytes':data,'sha256':ref['sourceSha256']}
    for package in [systems,effects,supplement,context]:
        if package['build']!='16.21.829.8620':raise ValueError('Native graphics input build differs')
    catalog={name:{**ref,'directory':assets/'latest-effects'} for name,ref in effects['assets'].items()}
    for name,ref in supplement['assets'].items():
        if name in catalog:raise ValueError('Supplemental texture collides with frozen effect catalog')
        catalog[name]={**ref,'directory':assets/'latest-native-textures'}
    names=args.effect or list(systems['systems'])
    if len(set(names))!=len(names) or any(name not in systems['systems'] for name in names):
        raise ValueError('Duplicate or unknown requested effect ID')
    clock={'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]}
    cases=[];original_blocks={};began=time.monotonic()
    device=GraphicsTextureDevice(args.angle)
    try:
        n=context_type(assets/'decoder-16.21-macos',args.client,device=device)
        for index,name in enumerate(names):
            ref=systems['systems'][name];graph=read(assets/'latest-vfx-system-assets'/ref['file'])
            if inputs[str((assets/'latest-vfx-system-assets'/ref['file']).resolve())]!=ref['sha256']:
                raise ValueError('Complete native effect graph changed')
            shader_catalog=GraphicsShaderCatalog(assets/'latest-shaders',device)
            texture_start=len(device.textures);device.uploads=[]
            n.shader_catalog=shader_catalog;n.blocks={};n.load_prepared_system(graph)
            for g in context['initializedGlobals']:
                n.u.mem_write(n.base+g['rva'],bytes.fromhex(g['bytesHex']))
            root_before=bytes(n.u.mem_read(A['definition'],0x150))
            heap_before=bytes(n.u.mem_read(graph['heapStart'],len(bytes.fromhex(graph['heapHex']))))
            heap_writes=[]
            def observe_heap_write(uc,access,address,size,value,user):
                before=bytes(uc.mem_read(address,size))
                if size<=8 and before==value.to_bytes(size,'little',signed=False):return
                heap_writes.append({'offset':address-graph['heapStart'],'size':size,'beforeHex':before.hex(),
                    'value':value,'instructionRva':uc.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'owners':[{'type':v['type'],'object':v['object'],'fieldOffset':address-v['object']}
                        for v in graph['visits'] if v['object']<=address<v['object']+v['bytes']]})
            heap_hook=n.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,observe_heap_write,
                begin=graph['heapStart'],end=graph['heapStart']+len(heap_before)-1) if heap_before else None
            case={'effectId':name,'graphSha256':ref['sha256'],'clockInput':clock,
                'stage':'resource-startup','status':'not-activated'}
            try:
                case['initialContext']=n.initialize_graphics_context(0,False)
                if args.meshes:case['staticFileCatalog']=n.install_static_files(static_files)
                case['stage']='texture-discovery';discoveries=n.discover_texture_paths(graph)
                case['textureDependencies']=discoveries
                for discovery in discoveries:
                    path=discovery['path'];asset=catalog.get(path.lower())
                    if not asset or asset.get('kind')!='texture' or asset.get('status')!='prepared':
                        raise ValueError(f'Unprepared typed native texture dependency: {path}')
                    source=raw(asset['directory']/asset['rawFile'])
                    if sha(source)!=asset['sourceSha256']:raise ValueError('Native texture source changed')
                    file=asset['directory']/asset['file'];png=raw(file)
                    if sha(png)!=asset['sha256']:raise ValueError('Prepared native texture bitmap changed')
                    image=Image.open(file).convert('RGBA')
                    if image.size!=(asset['width'],asset['height']):raise ValueError('Native texture dimensions changed')
                    case['stage']='texture-registration'
                    if cube_package is not None and asset['rawFile'].endswith('.dds'):
                        key=cube_package['paths'][path.lower()]
                        if key!=sha(source):raise ValueError('Cube package selects a different DDS source')
                        cube=cube_package['cubes'][key];levels=[]
                        for level in cube['levels']:
                            planes=[]
                            for plane in level:
                                pixels=raw(assets/'latest-dds-cubes'/plane['file'])
                                if sha(pixels)!=plane['sha256'] or len(pixels)!=plane['width']*plane['height']*4:
                                    raise ValueError('Prepared DDS cube face/mip changed')
                                planes.append(pixels)
                            levels.append(planes)
                        n.register_rgba_cube_texture(path,levels,cube['width'])
                    else:n.register_rgba_texture(path,image.tobytes(),*image.size)
                case['stage']='parent-activation'
                n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase'])
                if args.pipelines:case['randomSeed']=n.set_random_seed(args.seed)
                obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000);n.mark_ready(obj)
                case['object']=obj;n.call(0x1765960,{r.UC_X86_REG_RDI:obj})
                parent=n.q(obj+0x28)
                if n.allocations.get(parent)!=0x2c0 or n.u32(A['manager']+0x188)!=1:
                    raise ValueError('Original parent activation did not publish exactly one parent')
                case.update(status='activated',parent=parent,
                    objectHex=bytes(n.u.mem_read(obj,0x238)).hex(),parentHex=bytes(n.u.mem_read(parent,0x2c0)).hex())
                if args.pipelines:
                    actors=[]
                    for offset,kind,size in [(0x40,'complex',0x120),(0x60,'animated',0x280)]:
                        for row in n.vector(parent+offset,8,4096):
                            actor=n.q(row)
                            if n.allocations.get(actor)!=size:raise ValueError('Original parent actor allocation differs')
                            actors.append({'kind':kind,'address':actor,'allocationBytes':size,
                                'bytesHex':bytes(n.u.mem_read(actor,size)).hex()})
                    case['actors']=actors
            except Exception as error:
                rip=n.u.reg_read(r.UC_X86_REG_RIP)
                stack=[];frame=n.u.reg_read(r.UC_X86_REG_RBP)
                for _ in range(16):
                    if not 0x10008000<=frame<=0x10010000:break
                    stack.append(n.q(frame+8)-n.base);next_frame=n.q(frame)
                    if next_frame<=frame:break
                    frame=next_frame
                case.update(status='boundary',error=str(error),instructionAddress=rip,
                    instructionRva=rip-n.base if n.base<=rip<n.base+len(n.image) else None,
                    nativeReturnRva=n.q(n.u.reg_read(r.UC_X86_REG_RSP))-n.base,stackReturns=stack)
            finally:
                if heap_hook is not None:n.u.hook_del(heap_hook)
                case['authoredRootPreserved']=bytes(n.u.mem_read(A['definition'],0x150))==root_before
                heap_after=bytes(n.u.mem_read(graph['heapStart'],len(heap_before)))
                case['authoredHeapDifferences']=[i for i,(a,b) in enumerate(zip(heap_before,heap_after)) if a!=b]
                case['assetHeapWrites']=heap_writes
                case['defaultTextures']=n.gpu_records;case['preloadedTextures']=n.preloaded_textures
                case['shaderRequests']=list(shader_catalog.requests)
                case['programs']=list(shader_catalog.programs.values())
                case['pipelineRequests']=n.pipeline_requests
                case['fileRequests']=n.file_requests
                if args.pipelines:
                    case['pipelines']=list(n.pipeline_backend.records)
                    case['materialBindingRequests']=list(n.material_binding_requests)
                    case['materialBindings']=list(n.material_backend.records)
                    case['sharedParameterQueries']=list(n.shared_parameter_queries)
                    case['threadDestructorRegistrations']=list(n.thread_destructors)
                    n.material_backend.close()
                if args.meshes:
                    case['fileLookups']=list(n.file_lookups);case['fileOpens']=list(n.file_opens)
                    case['fileReads']=list(n.file_reads);case['fileCloses']=list(n.file_closes)
                    case['filesystemMutex']=dict(n.file_mutex)
                    case['meshBuffers']=list(n.mesh_backend.buffer_records)
                    case['meshLayouts']=list(n.mesh_backend.layout_records)
                    case['staticMeshSetups']=list(n.static_mesh_setups)
                    n.mesh_backend.close()
                inputs.update(shader_catalog.inputs);original_blocks.update(n.blocks)
                shader_catalog.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            if (index+1)%32==0 or index+1==len(names):
                print(json.dumps({'completed':index+1,'total':len(names),'elapsedSeconds':round(time.monotonic()-began,1),
                    'statuses':dict(Counter(c['status'] for c in cases))}),flush=True)
        thread_destructor_calls=n.finish_owned_thread() if args.pipelines else []
        original_blocks.update(n.blocks)
        sources={p.name:sha(p.read_bytes()) for p in {Path(__file__),
            *[Path(inspect.getfile(c)) for c in context_type.__mro__ if c is not object],
            *[Path(__file__).with_name(name) for name in ['graphics_texture_device.py',
                'graphics_shader_catalog.py','native_texture_dependencies.py','render-particle-shader.py',
                'observe-shader-angle.py','macho.py']]}}
        if args.pipelines:
            for name in ['graphics_pipeline_device.py','graphics_material_bindings.py']:
                sources[name]=sha(Path(__file__).with_name(name).read_bytes())
        if args.meshes:sources['graphics_mesh_device.py']=sha(Path(__file__).with_name('graphics_mesh_device.py').read_bytes())
        counts={'roots':len(cases),'activated':sum(c['status']=='activated' for c in cases),
            'boundaries':sum(c['status']=='boundary' for c in cases),
            'pipelineBoundaries':sum(any('pipelinePointer' not in p for p in c['pipelineRequests']) for c in cases),
            'fileProviderBoundaries':sum(c['status']=='boundary' and bool(c['fileRequests']) for c in cases),
            'compiledShaders':sum(len(c['shaderRequests']) for c in cases),
            'linkedPrograms':sum(len(c['programs']) for c in cases),
            'defaultTextureUploads':sum(len(c['defaultTextures']) for c in cases),
            'preparedTextureUploads':sum(len(c['preloadedTextures']) for c in cases),
            'gpuSubresourcesVerified':sum(len(t['readbacks']) for c in cases for t in [*c['defaultTextures'],*c['preloadedTextures']]),
            'authoredRootChanges':sum(not c['authoredRootPreserved'] for c in cases),
            'authoredHeapChangedBytes':sum(len(c['authoredHeapDifferences']) for c in cases)}
        if args.pipelines:
            counts.update(createdPipelines=sum(len(c['pipelines']) for c in cases),
                createdMaterialBindings=sum(len(c['materialBindings']) for c in cases),
                uniformBuffersVerified=sum(len(m['uniformBuffers']) for c in cases for m in c['materialBindings']),
                samplerBindingsVerified=sum(len(m['textures']) for c in cases for m in c['materialBindings']),
                sharedParameterQueries=sum(len(c['sharedParameterQueries']) for c in cases))
            counts['createdActors']=sum(len(c.get('actors',[])) for c in cases)
        if args.meshes:
            counts.update(fileLookups=sum(len(c['fileLookups']) for c in cases),
                openedFiles=sum(len(c['fileOpens']) for c in cases),nativeFileReads=sum(len(c['fileReads']) for c in cases),
                closedFiles=sum(len(c['fileCloses']) for c in cases),meshBuffers=sum(len(c['meshBuffers']) for c in cases),
                meshLayouts=sum(len(c['meshLayouts']) for c in cases),
                staticMeshSetups=sum(len(c['staticMeshSetups']) for c in cases))
        mode='cubemaps' if args.cubemaps else 'meshes' if args.meshes else 'pipelines' if args.pipelines else 'graphics'
        output={'schema':1,'kind':f'native-vfx-{mode}-observations' if args.meshes else 'native-vfx-pipeline-observations' if args.pipelines else 'native-vfx-graphics-observations','build':n.profile['clientVersion'],
            'protocol':n.profile['protocolDigest'],'decoderImageSha256':n.profile['decoderImageSha256'],
            'inputs':inputs,'sources':sources,'context':device.info,
            'libraries':{name:sha((args.angle/name).read_bytes()) for name in ['libEGL.dll','libGLESv2.dll']},
            'startupBlocks':{'materialPasses':MATERIAL_PASS_STARTUP,'textureDefaultNames':DEFAULT_TAGS},
            'originalBlocks':list(original_blocks.values()),'counts':counts,
            'boundaryCounts':dict(Counter(c['error'] for c in cases if c['status']=='boundary')),
            'cases':cases,'threadDestructorCalls':thread_destructor_calls,
            'scope':{'completeAuthoredRootsAttempted':True,'originalFactoryExecuted':True,
                'portedGlesTextureAndShaderDevice':True,'originalMetalBackendExecuted':False,
                'fullTextureRegistryConstructorExecuted':True,'originalMaterialPassStartupExecuted':True,
                'originalShaderCacheConstructorExecuted':True,'gpuUploadReadbackVerified':True,
                'preparedTexturesAreDecoded2dBaseLevels':not args.cubemaps,'allOriginalDdsCubeFacesAndMipsPrepared':args.cubemaps,
                'originalTexLoaderOrFullAssetMipsExecuted':False,
                'renderPipelineStateProviderImplemented':args.pipelines,
                'materialConstantsTexturesSamplersImplemented':args.pipelines,
                'readOnlyPreparedFileMountImplemented':args.meshes,'originalMemoryFileAndScbParserExecuted':args.meshes,
                'gpuVertexBuffersImplemented':args.meshes,'shaderVertexLocationsBound':False,
                'sceneGlobalsBound':False,'randomSeedSupplied':args.pipelines,'matchRandomSeedRecovered':False,
                'renderedCoverageEstablished':False,
                'clockInputsSupplied':True,'browserOrLeagueExecuted':False,'mainViewerIntegrated':False}}
        destination=args.output or cache/f"research/vfx-{mode}-native.json"
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_text(json.dumps(output,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(destination),'counts':counts,'boundaryCounts':output['boundaryCounts']}))
    finally:device.close()


if __name__=='__main__':main()

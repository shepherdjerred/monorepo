"""Execute original named particle preloads with real installed files and GLES.

This isolates shared resource loading from replay-world admission. It does not
spawn particles, bind scene inputs, or count normal returns as A/V fidelity.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from shared_particle_resources_native import NativeSharedParticleResources
from asset_work_queue_native import NativeAssetWorkQueue
from shared_graphics_registries_native import initialize_shared_graphics_registries
from installed_resource_archive_native import register_resource_archive
from effect_preload_trace import observe_effect_preloads
from vfx_spawn_native import ADDRESSES,sha
from vfx_object_native import MANAGER,NativeVfxObjects
from vfx_resource_native import NativeVfxResourceContext
from vfx_graphics_native import NativeVfxGraphicsContext
from vfx_pipeline_native import NativeVfxPipelineContext
from vfx_mesh_native import NativeVfxMeshContext
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings
from PIL import Image


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation','graphics','shaders']:p.add_argument(name,type=Path)
    p.add_argument('--path',action='append',required=True)
    p.add_argument('--quality',type=int,choices=range(4),required=True)
    p.add_argument('--graphics34b',type=int,choices=[0,1],required=True)
    p.add_argument('--asset-work-queue',action='store_true')
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeAssetWorkQueue if args.asset_work_queue else NativeSharedParticleResources)
    n = fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    for name in ['libEGL.dll','libGLESv2.dll']:fixture.raw(args.graphics/name)
    if args.asset_work_queue:
        for path in [Image.__file__,Image.core.__file__]:fixture.raw(Path(path))
    vm = n.initialize_character_script_vm()
    archive = register_resource_archive(fixture,args.installation,'DATA.wad.client')
    graphics = n.initialize_character_graphics(args.graphics)
    registries = initialize_shared_graphics_registries(n,args.shaders)
    components = n.initialize_effect_preload_components(args.quality,bool(args.graphics34b))
    requests = observe_effect_preloads(n)
    queue = n.initialize_asset_work_queue() if args.asset_work_queue else None
    completion_dispatcher = n.initialize_asset_completion_dispatcher(1) if args.asset_work_queue else None
    cases,boundary = [],None
    try:
        for path in args.path:
            name = n.allocate(16)
            n.call(0x14c2d60,{r.UC_X86_REG_RDI:name,r.UC_X86_REG_RSI:n.allocate_text(path)})
            case = {'path':path,'completed':False,'progress':[]}
            cases.append(case)
            n.u.context_restore(n.initial)
            n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
            for reg,value in {r.UC_X86_REG_RSP:ADDRESSES['stack'],r.UC_X86_REG_RDI:MANAGER,
                              r.UC_X86_REG_RSI:name,r.UC_X86_REG_RDX:0}.items():n.u.reg_write(reg,value)
            start = n.base+0x174b190
            def measure():return [len(n.file_calls),len(n.character_format_calls),len(n.legacy_platform_calls),
                                  len(n.shader_catalog.requests),len(n.pipeline_backend.records),len(n.native_mesh_layouts)]
            for _ in range(16):
                before = measure()
                n.u.emu_start(start,ADDRESSES['stop'],count=5000000)
                start = n.u.reg_read(r.UC_X86_REG_RIP)
                after = measure()
                case['progress'].append([a-b for a,b in zip(after,before)])
                if start == ADDRESSES['stop']:
                    case.update(completed=True,resource=n.u.reg_read(r.UC_X86_REG_RAX))
                    break
                if before == after:raise ValueError('Shared preloader exhausted a slice without observed resource/parser progress')
            if not case['completed']:raise ValueError('Shared preloader exceeded sixteen bounded instruction slices')
            if args.asset_work_queue:
                case['queueBeforeDrain'] = n.asset_queue_state()
                n.drain_asset_read_jobs()
                case['queueAfterDrain'] = n.asset_queue_state()
                case['queuedJobsRetired'] = True
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionAddress':n.u.reg_read(r.UC_X86_REG_RIP),
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rdi','rsi','rdx','rcx','r8','r9','rbp','rsp']}}
        stack = n.u.reg_read(r.UC_X86_REG_RSP)
        if n.library_pointer(stack,128):
            boundary.update(returnRva=n.q(stack)-n.base,stackHex=bytes(n.u.mem_read(stack,128)).hex())
    finally:
        n.close_files()
        for path,digest in n.shader_catalog.inputs.items():
            if sha(fixture.raw(Path(path))) != digest:raise ValueError('Shared preload shader input changed')
        n.close_graphics()
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_shared_graphics_registries)),Path(inspect.getfile(register_resource_archive)),
             Path(inspect.getfile(observe_effect_preloads)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],
             *[Path(inspect.getfile(c)) for c in [NativeVfxObjects,NativeVfxResourceContext,NativeVfxGraphicsContext,
               NativeVfxPipelineContext,NativeVfxMeshContext,GraphicsTextureDevice,GraphicsMeshDevice,
               GraphicsShaderCatalog,GraphicsPipelineDevice,GraphicsMaterialBindings]]}
    paths.update({Path(__file__).with_name(name) for name in ['render-particle-shader.py','observe-shader-angle.py','libcpp_string_native.py']})
    if args.asset_work_queue:
        paths.update({Path(__file__).with_name(name) for name in ['graphics_block_texture_device.py','native_block_texture_upload.py']})
    result = {'schema':1,'kind':'original-shared-particle-preload-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},'originalBlocks':list(n.blocks.values()),
              'scriptVm':vm,'installedArchive':archive,'graphics':graphics,'registries':registries,'effectComponents':components,
              'cases':cases,'effectRequests':requests,'fileRequests':n.file_requests,'fileCalls':n.file_calls,
              'textures':n.gpu_records,'buffers':list(n.native_mesh_buffers.values()),'layouts':list(n.native_mesh_layouts.values()),
              'shaders':n.shader_catalog.requests,'programs':list(n.native_programs.values()),
              'pipelines':list(n.native_pipelines.values()),'bindings':list(n.native_bindings.values()),'boundary':boundary,
              'assetQueue':queue,'assetQueueState':n.asset_queue_state() if args.asset_work_queue else None,
              'assetCompletionDispatcher':completion_dispatcher,
              'assetCompletionRuns':n.asset_completion_runs if args.asset_work_queue else [],
              'assetCallbackRuns':n.asset_callback_runs if args.asset_work_queue else [],
              'assetQueueJobs':n.asset_queue_jobs if args.asset_work_queue else [],
              'assetQueuePlatformCalls':n.asset_queue_platform_calls if args.asset_work_queue else [],
              'scope':{'allNamedPreloadsCompleted':boundary is None and all(c['completed'] for c in cases),
                       'resourceReadinessVerified':False,'emitterSemanticsVerified':False,'particlesSpawned':False,
                       'sceneInputsBound':False,'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research'/('shared-particle-preload'+('-queue' if args.asset_work_queue else '')+'-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':[{key:case.get(key) for key in ['path','completed','queuedJobsRetired']} for case in cases],
                      'boundary':boundary,
                      'gpuCounts':{key:len(result[key]) for key in ['shaders','programs','pipelines','bindings','buffers','layouts']}}),flush=True)


if __name__ == '__main__':
    main()

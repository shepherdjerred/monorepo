"""Observe complete original resource registry constructors beside real GLES defaults."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from shared_particle_resources_native import NativeSharedParticleResources
from shared_graphics_registries_native import initialize_shared_graphics_registries
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from vfx_graphics_native import NativeVfxGraphicsContext
from vfx_mesh_native import NativeVfxMeshContext
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings
from vfx_pipeline_native import NativeVfxPipelineContext
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','graphics']:p.add_argument(name,type=Path)
    p.add_argument('--shaders',type=Path,required=True)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeSharedParticleResources)
    n = fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    for name in ['libEGL.dll','libGLESv2.dll']:fixture.raw(args.graphics/name)
    graphics,registries,boundary = None,None,None
    try:
        graphics = n.initialize_character_graphics(args.graphics)
        registries = initialize_shared_graphics_registries(n,args.shaders)
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rdi','rsi','rdx','rcx','rbp','rsp']}}
        stack = n.u.reg_read(r.UC_X86_REG_RSP)
        if n.library_pointer(stack,128):
            boundary['returnRva'] = n.q(stack)-n.base
            boundary['stackHex'] = bytes(n.u.mem_read(stack,128)).hex()
    finally:
        if n.shader_catalog is not None:
            for name,digest in n.shader_catalog.inputs.items():
                if sha(fixture.raw(Path(name))) != digest:raise ValueError('Shared shader input changed')
        n.close_graphics()
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(initialize_shared_graphics_registries)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],
             *[Path(inspect.getfile(c)) for c in [GraphicsTextureDevice,GraphicsMeshDevice,NativeVfxGraphicsContext,NativeVfxMeshContext,
                GraphicsShaderCatalog,GraphicsPipelineDevice,GraphicsMaterialBindings,NativeVfxPipelineContext]]}
    paths.update({Path(__file__).with_name(name) for name in
                  ['render-particle-shader.py','observe-shader-angle.py','libcpp_string_native.py']})
    result = {'schema':1,'kind':'original-shared-graphics-registry-constructor-observations',
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'graphics':graphics,'registries':registries,
              'partialRegistries':getattr(n,'shared_graphics_registries',[]),
              'textures':n.gpu_records,'buffers':list(n.native_mesh_buffers.values()),'boundary':boundary,
              'shaderRequests':n.shader_catalog.requests if n.shader_catalog else [],'pipelineRequests':n.pipeline_requests,
              'programs':list(n.native_programs.values()),
              'pipelines':list(n.native_pipelines.values()),'materialBindingRequests':n.material_binding_requests,
              'bindings':list(n.native_bindings.values()),'sharedParameterQueries':n.shared_parameter_queries,
              'scope':{'allSelectedConstructorsCompleted':registries is not None,'allAssetsLoaded':False,
                       'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research/shared-graphics-registries-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'completed':registries is not None,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()

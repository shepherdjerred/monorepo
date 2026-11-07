"""Observe installed shared shader constants using original readers/layouts."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from aligned_asset_memory_native import AlignedAssetMemory
from libcpp_concat_native import LibcppConcat
from libc_width_format_native import LibcWidthFormatting
from champion_catalog_native import initialize_binary_resource_cache,initialize_binary_postload_tls
from installed_resource_archive_native import register_resource_archive
from shared_graphics_registries_native import initialize_shared_graphics_registries
from shared_constant_inputs_native import initialize_shared_constant_types,initialize_shared_constant_inputs
from vfx_spawn_native import sha
from vfx_object_native import NativeVfxObjects
from probe_shared_constant_sources import borrowed_sources


class NativeConstants(LibcWidthFormatting,LibcppConcat,AlignedAssetMemory,NativeAssetWorkQueue):pass


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation','graphics','shaders']:p.add_argument(name,type=Path)
    args=p.parse_args();fixture=NativeAIUnitFixture(args.cache,args.client,NativeConstants);n=fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    constants,boundary=None,None
    setup={}
    try:
        setup['types']=n.initialize_character_types()
        setup['constantTypes']=initialize_shared_constant_types(n)
        setup['vm']=n.initialize_character_script_vm()
        setup['archives']=[register_resource_archive(fixture,args.installation,name)
                           for name in ['Global.wad.client','Bootstrap.windows.wad.client']]
        for name in ['libEGL.dll','libGLESv2.dll']:fixture.raw(args.graphics/name)
        setup['graphics']=n.initialize_character_graphics(args.graphics)
        setup['registries']=initialize_shared_graphics_registries(n,args.shaders)
        setup['binaryCache']=initialize_binary_resource_cache(n)
        setup['postloadTls']=initialize_binary_postload_tls(n)
        constants=initialize_shared_constant_inputs(n)
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                  'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper())) for key in ['rax','rbx','rdi','rsi','rdx','rcx','r8','r9','rbp','rsp']}}
        stack=n.u.reg_read(r.UC_X86_REG_RSP)
        if n.library_pointer(stack,128):boundary.update(stackHex=bytes(n.u.mem_read(stack,128)).hex(),returnRva=n.q(stack)-n.base)
    finally:
        n.close_files()
        if n.shader_catalog:
            for file,expected in n.shader_catalog.inputs.items():
                if sha(fixture.raw(Path(file)))!=expected:raise ValueError('Shared-constant shader input changed')
        n.close_graphics()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(NativeVfxObjects)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],
           *[Path(inspect.getfile(f)) for f in [initialize_binary_resource_cache,initialize_shared_constant_inputs,
              register_resource_archive,initialize_shared_graphics_registries]],*borrowed_sources()}
    result={'schema':1,'kind':'original-installed-shared-constant-observations','build':n.profile['clientVersion'],
            'inputs':fixture.inputs,'sources':{file.name:sha(file.read_bytes()) for file in sorted(paths)},
            'decoderImageSha256':sha(n.image),'originalBlocks':list(n.blocks.values()),'setup':setup,'constants':constants,
            'libraryLoads':getattr(n,'shared_constant_loads',[]),'bufferLayouts':getattr(n,'shared_constant_buffers',[]),
            'boundary':boundary,'sharedParameterQueries':n.shared_parameter_queries,
            'nativeFieldSkips':n.ignored,'nativeTypeMismatches':n.mismatched,
            'scope':{'originalSharedConstantsInitialized':constants is not None,'gpuUniformsBound':False,'mainViewerExpanded':False}}
    output=fixture.cache/'research/shared-constant-inputs-native.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'bones':constants['bones'] if constants else None,'boundary':boundary}))


if __name__=='__main__':main()

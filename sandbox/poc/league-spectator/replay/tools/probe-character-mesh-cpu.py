"""Isolate original installed SKN reading and CPU triangle processing."""
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
from installed_resource_archive_native import register_resource_archive
from appearance_projection_native import observe_mesh_progress
from champion_catalog_native import initialize_binary_resource_cache,initialize_binary_postload_tls
from shared_constant_inputs_native import initialize_shared_constant_types,initialize_shared_constant_inputs
from shared_graphics_registries_native import initialize_shared_graphics_registries
from probe_shared_constant_sources import borrowed_sources
from index_buffer_native import NativeIndexBuffers
from vfx_graphics_native import DEVICE
from vfx_spawn_native import ADDRESSES,sha


class NativeMeshCpu(NativeIndexBuffers,LibcWidthFormatting,LibcppConcat,AlignedAssetMemory,NativeAssetWorkQueue):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation']:parser.add_argument(name,type=Path)
    parser.add_argument('--archive',required=True)
    parser.add_argument('--mesh',required=True)
    parser.add_argument('--skeleton',required=True)
    parser.add_argument('--graphics',required=True,type=Path)
    parser.add_argument('--shaders',required=True,type=Path)
    parser.add_argument('--index-buffer',action='store_true')
    parser.add_argument('--gpu-layout',action='store_true')
    args=parser.parse_args()
    if not args.mesh.lower().endswith('.skn') or not args.skeleton.lower().endswith('.skl'):
        raise ValueError('Explicit installed SKN and SKL paths required')
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeMeshCpu);n=fixture.native
    setup={};runs=[];boundary=None;mesh=None;processed=None;records=[];hooks=[]
    skeleton=None;remapped=False;index_buffer=None;gpu_mesh=None
    def execute(entry,registers):
        n.u.context_restore(n.initial);n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        for register,value in registers.items():n.u.reg_write(register,value)
        run={'entryRva':entry,'instructionBoundPerSlice':5000000,'sliceBound':16,'stops':[],'completed':False}
        runs.append(run);start=n.base+entry
        for _ in range(16):
            n.u.emu_start(start,ADDRESSES['stop'],count=5000000);start=n.u.reg_read(r.UC_X86_REG_RIP)
            run['stops'].append(start)
            if start==ADDRESSES['stop']:
                run['completed']=True
                return n.u.reg_read(r.UC_X86_REG_RAX)
        raise ValueError('Original mesh control exceeded sixteen bounded CPU slices')
    try:
        setup['types']=n.initialize_character_types()
        setup['constantTypes']=initialize_shared_constant_types(n)
        setup['vm']=n.initialize_character_script_vm()
        setup['archives']=[register_resource_archive(fixture,args.installation,name)
                           for name in ['Global.wad.client','Bootstrap.windows.wad.client',args.archive]]
        for name in ['libEGL.dll','libGLESv2.dll']:fixture.raw(args.graphics/name)
        setup['graphics']=n.initialize_character_graphics(args.graphics)
        setup['registries']=initialize_shared_graphics_registries(n,args.shaders)
        setup['binaryCache']=initialize_binary_resource_cache(n)
        setup['postloadTls']=initialize_binary_postload_tls(n)
        setup['constants']=initialize_shared_constant_inputs(n)
        pointer=execute(0x184a050,{r.UC_X86_REG_RDI:n.allocate_text(args.mesh),r.UC_X86_REG_RSI:4})
        if not pointer or not n.library_pointer(pointer,0xb0):raise ValueError('Original SKN read returned no bounded mesh')
        mesh={'pointer':pointer,'headerHex':bytes(n.u.mem_read(pointer,0xb0)).hex(),
              'materials':n.u32(pointer+0x28),'vertexFormat':n.u32(pointer+0x40)}
        handle=n.allocate(8)
        execute(0x15b3c20,{r.UC_X86_REG_RDI:handle,r.UC_X86_REG_RSI:n.allocate_text(args.skeleton)})
        skeleton=n.q(handle)
        if not skeleton or not n.library_pointer(skeleton,0x48):
            raise ValueError('Original skeleton reader returned no bounded resource')
        bones=n.u32(skeleton+0x40)
        if not 0<bones<=65535:raise ValueError('Original skeleton bone count escaped bounds')
        execute(0x184a0f0,{r.UC_X86_REG_RDI:pointer,r.UC_X86_REG_RSI:bones})
        remapped=True
        records,hooks=observe_mesh_progress(n)
        output=n.allocate(0x1a0);n.u.mem_write(output+0xa0,b'\xa5'*0x100)
        execute(0x1846110,{r.UC_X86_REG_RDI:output,r.UC_X86_REG_RSI:pointer,r.UC_X86_REG_RDX:0})
        if (bytes(n.u.mem_read(output+0xa0,0x100))!=b'\xa5'*0x100 or not records or
                any(not row['completed'] for row in records)):
            raise ValueError('Original CPU mesh output guard or triangle completion differs')
        processed={'pointer':output,'headerHex':bytes(n.u.mem_read(output,0xa0)).hex(),
                   'groups':n.u32(output+0x10),'guardIntact':True}
        if args.index_buffer:
            # Same byte count, format, flags and original SKN index source as
            # the observed graphics request at 184cbc4. This explicitly calls
            # the owned backend boundary, not the complete appearance factory.
            header=execute(n.index_callbacks['create']-n.base,{r.UC_X86_REG_RDI:DEVICE,
                r.UC_X86_REG_RSI:n.u32(pointer+0x34)*2,r.UC_X86_REG_RDX:0,
                r.UC_X86_REG_RCX:0,r.UC_X86_REG_R8:n.q(pointer+0x18)})
            if header not in n.native_index_buffers:raise ValueError('Index provider returned an unowned resource')
            index_buffer=n.native_index_buffers[header]
        if args.gpu_layout:
            execute(0x185acc0,{r.UC_X86_REG_RDI:pointer})
            buffer,layout=n.q(pointer+0xd0),n.q(pointer+0xc8)
            if buffer not in n.native_mesh_buffers or layout not in n.native_mesh_layouts:
                raise ValueError('Original SKN GPU setup did not retain owned buffer/layout objects')
            gpu_mesh={'buffer':n.native_mesh_buffers[buffer],'layout':n.native_mesh_layouts[layout]}
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),
                  'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:
        for hook in hooks:n.u.hook_del(hook)
        n.close_files()
        if n.shader_catalog:
            for file,expected in n.shader_catalog.inputs.items():
                if sha(fixture.raw(Path(file)))!=expected:raise ValueError('Mesh shader input changed')
        n.close_graphics()
    sources={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(register_resource_archive)),Path(inspect.getfile(observe_mesh_progress)),
             Path(inspect.getfile(initialize_binary_resource_cache)),Path(inspect.getfile(initialize_shared_constant_inputs)),
             Path(inspect.getfile(initialize_shared_graphics_registries)),*borrowed_sources(),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result={'schema':1,'kind':'original-installed-character-mesh-cpu-control','build':n.profile['clientVersion'],
            'meshPath':args.mesh,'skeletonPath':args.skeleton,'skeleton':skeleton,
            'inputs':fixture.inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
            'decoderImageSha256':sha(n.image),'originalBlocks':list(n.blocks.values()),'setup':setup,
            'runs':runs,'mesh':mesh,'processed':processed,'meshProgress':records,'boundary':boundary,
            'fileRequests':n.file_requests,'indexBuffer':index_buffer,'gpuMesh':gpu_mesh,
            'scope':{'originalCpuMeshConstructed':processed is not None,'skeletonRemappingExecuted':remapped,
                     'gpuIndexBytesVerified':index_buffer is not None,'gpuMeshUploaded':gpu_mesh is not None,
                     'completeAppearanceVerified':False,'mainViewerExpanded':False}}
    output=fixture.cache/('research/character-mesh-cpu-index-native.json' if args.index_buffer else 'research/character-mesh-cpu-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'processed':processed,'meshProgress':records,'boundary':boundary}))


if __name__=='__main__':main()

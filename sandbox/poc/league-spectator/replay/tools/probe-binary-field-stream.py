"""Observe the original memory-stream ABI at the first field of an installed BIN."""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from libc_ascii_compare_native import NativeAsciiCaseCompare
from aligned_asset_memory_native import AlignedAssetMemory
from installed_resource_archive_native import register_resource_archive
from champion_catalog_native import initialize_binary_resource_cache,initialize_binary_postload_tls
from serialized_asset_progress_native import observe_serialized_asset_progress
from probe_shared_constant_sources import borrowed_sources
from vfx_spawn_native import ADDRESSES,sha


class NativeStreamInputs(NativeAsciiCaseCompare,AlignedAssetMemory,NativeAssetWorkQueue):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation']:parser.add_argument(name,type=Path)
    parser.add_argument('--archive',required=True);parser.add_argument('--path',required=True)
    parser.add_argument('--to-source-end',action='store_true',help='Observe bounded original read progress until the first source reaches its end')
    args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeStreamInputs);n=fixture.native
    result={'schema':1,'kind':'original-binary-field-stream-observation','build':n.profile['clientVersion'],
            'path':args.path,'stream':None,'boundary':None,'setup':{},'serializedProgress':None,'slices':[]};hook=None;progress_hooks=[]
    try:
        result['setup']['vm']=n.initialize_character_script_vm()
        result['setup']['archive']=register_resource_archive(fixture,args.installation,args.archive)
        result['setup']['cache']=initialize_binary_resource_cache(n)
        result['setup']['tls']=initialize_binary_postload_tls(n)
        handle=n.allocate(16);n.call(0x14b7670,{r.UC_X86_REG_RDI:handle})
        text=n.allocate_text(args.path)
        def first_field(engine,address,size,user):
            if result['stream'] is not None:return
            context=engine.reg_read(r.UC_X86_REG_RCX);stream=n.q(context);vtable=n.q(stream)
            if not n.library_pointer(stream,0x40) or not n.base<=vtable<=n.base+len(n.image)-0x30:
                raise ValueError('Original BIN field stream exceeds owned bounds')
            result['stream']={'context':context,'object':stream,'headerHex':bytes(n.u.mem_read(stream,0x40)).hex(),
                              'vtableRva':vtable-n.base,'readRva':n.q(vtable+0x10)-n.base,
                              'fieldOwnerDescriptor':engine.reg_read(r.UC_X86_REG_RDX)}
            chain=[];current=stream
            for _ in range(4):
                if not n.library_pointer(current,0x30):raise ValueError('Original stream delegate exceeds owned storage')
                vt=n.q(current);read=n.q(vt+0x10)-n.base
                chain.append({'object':current,'allocationBytes':n.allocations.get(current),'vtableRva':vt-n.base,
                              'readRva':read,'headerHex':bytes(n.u.mem_read(current,0x30)).hex()})
                if read!=0x147a150:break
                current=n.q(current+8)
            result['stream']['delegates']=chain
            if not args.to_source_end:engine.emu_stop()
        hook=n.u.hook_add(unicorn.UC_HOOK_CODE,first_field,begin=n.base+0x14bc830,end=n.base+0x14bc830)
        reached=False
        if args.to_source_end:
            def source_end(record):
                nonlocal reached
                if record is result['serializedProgress']['sources'][0] and record['sourceBytes']:
                    reached=True;n.u.emu_stop()
            result['serializedProgress'],progress_hooks=observe_serialized_asset_progress(n,source_end)
        n.u.context_restore(n.initial);n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        for register,value in {r.UC_X86_REG_RSP:ADDRESSES['stack'],r.UC_X86_REG_RDI:handle,r.UC_X86_REG_RSI:text}.items():n.u.reg_write(register,value)
        start=n.base+0x14ba7d0
        for _ in range(16 if args.to_source_end else 1):
            before=result['serializedProgress']['totals']['coveredBytes'] if args.to_source_end else 0
            n.u.emu_start(start,ADDRESSES['stop'],count=5000000);start=n.u.reg_read(r.UC_X86_REG_RIP)
            after=result['serializedProgress']['totals']['coveredBytes'] if args.to_source_end else 0
            result['slices'].append({'newlyCoveredBytes':after-before,'stopRva':start-n.base})
            if not args.to_source_end or reached:break
            if start==ADDRESSES['stop'] or after<=before:
                raise ValueError('Original BIN operation returned or exhausted a CPU slice before advancing to source end')
        if args.to_source_end and not reached:raise ValueError('Original BIN source read exceeds sixteen bounded CPU slices')
        if result['stream'] is None or not args.to_source_end and start!=n.base+0x14bc830:
            raise ValueError('Original BIN read did not reach the requested first-field observation')
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:
        if hook:n.u.hook_del(hook)
        for item in progress_hooks:n.u.hook_del(item)
        n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(register_resource_archive)),
           Path(inspect.getfile(initialize_binary_resource_cache)),
           Path(inspect.getfile(observe_serialized_asset_progress)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],*borrowed_sources()}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  decoderImageSha256=sha(n.image),originalBlocks=list(n.blocks.values()),
                  scope={'firstFieldBoundaryOnly':not args.to_source_end,'stoppedAtOriginalSourceEnd':args.to_source_end and result['boundary'] is None,
                         'completeBinRead':False,'mainViewerExpanded':False})
    output=fixture.cache/'research'/('binary-field-stream-progress-native.json' if args.to_source_end else 'binary-field-stream-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'stream':result['stream'],'slices':result['slices'],
                      'progress':result['serializedProgress']['totals'] if result['serializedProgress'] else None,'boundary':result['boundary']}))


if __name__=='__main__':main()

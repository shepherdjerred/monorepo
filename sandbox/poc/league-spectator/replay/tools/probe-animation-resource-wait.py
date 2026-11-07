"""Resolve a pending original ANM binding with guarded cooperative dispatch."""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from asset_callback_slices_native import NativeAssetCallbackSlices
from asset_wait_dispatch_native import NativeAssetWaitDispatch
from character_graph_snapshot import restore
from animation_graph_preparation_native import initialize_animation_repository,prepare_animation_graph
from animation_repository_inspection_native import inspect_animation_repository
from installed_resource_archive_native import register_resource_archive
from probe_shared_constant_sources import borrowed_sources
from vfx_spawn_native import sha,name_hash


class NativeAnimationWait(NativeAssetCallbackSlices,NativeAssetWorkQueue):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation']:parser.add_argument(name,type=Path)
    parser.add_argument('--actor',required=True);parser.add_argument('--archive',required=True)
    parser.add_argument('--skeleton',required=True);args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeAnimationWait);n=fixture.native
    stem=args.actor.replace('/','-');suffix='-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7'
    graph=fixture.read(fixture.cache/'research'/('character-asset-links-'+stem+'-native.json'))
    post=fixture.read(fixture.cache/'research'/('character-asset-postload-'+stem+suffix+'-native.json'))
    if graph['boundaries'] or not graph['scope']['referenceLinksFixed'] or not post['scope']['completeSuppliedStage']:
        raise ValueError('Complete exact supplied animation graph control required')
    for report in [graph,post]:
        if report['actorKey']!=args.actor:raise ValueError('Exact actor graph required')
        for path,h in report['inputs'].items():
            if sha(fixture.raw(Path(path)))!=h:raise ValueError('Actor input changed: '+path)
        for source,h in report['sources'].items():
            if sha(fixture.raw(fixture.root/'tools'/source))!=h:raise ValueError('Actor producer changed: '+source)
    restore(fixture,post['snapshot']);scheduler=None;phase='setup'
    result={'schema':1,'kind':'original-animation-resource-wait-control','build':n.profile['clientVersion'],
            'actor':args.actor,'boundary':None,'setup':{}}
    try:
        result['setup']['vm']=n.initialize_character_script_vm()
        result['setup']['archive']=register_resource_archive(fixture,args.installation,args.archive)
        result['setup']['queue']=n.initialize_asset_work_queue()
        result['setup']['completions']=n.initialize_asset_completion_dispatcher(1)
        result['setup']['repository']=initialize_animation_repository(n);n.animation_graph_preparations=[]
        roots=[c for c in graph['cases'] if c['typeHash']==name_hash('AnimationGraphData')]
        if len(roots)!=1:raise ValueError('One explicit animation graph required')
        result['preparation']=prepare_animation_graph(n,roots[0]['loaded']['object'])
        handle=n.allocate(8);n.call(0x15b3c20,{r.UC_X86_REG_RDI:handle,r.UC_X86_REG_RSI:n.allocate_text(args.skeleton)})
        rig=n.q(handle);count=n.u32(rig+0x30)
        if not 0<count<=4096:raise ValueError('Bounded original installed rig required')
        repository=result['setup']['repository']['object'];node=n.q(repository+0x18);resource=n.q(node+0x30)
        if n.q(resource)!=n.base+0x23e39a8:raise ValueError('Control requires an actual pending original resource class')
        key=n.q(node+0x20);mapping=n.allocate(16);indices=n.allocate(count*4);n.put(mapping,'QII',indices,count,count)
        scheduler=NativeAssetWaitDispatch(n);phase='original-pending-resource-bind'
        scheduler.call(0x15b3520,{r.UC_X86_REG_RDI:resource,r.UC_X86_REG_RSI:rig,r.UC_X86_REG_RDX:mapping})
        observed=bytes(n.u.mem_read(indices,count*4))
        scheduler.close()
        phase='remaining-resource-dispatch';n.drain_asset_read_jobs()
        phase='loaded-resource-comparison';loaded=inspect_animation_repository(n)
        final=next(x for x in loaded['resources'] if x['key']==key)
        entry=0x15b3120 if final['kind']=='compressed' else 0x15b61a0
        expected_header=n.allocate(16);expected_indices=n.allocate(count*4);n.put(expected_header,'QII',expected_indices,count,count)
        n.call(entry,{r.UC_X86_REG_RDI:final['resource'],r.UC_X86_REG_RSI:rig,r.UC_X86_REG_RDX:expected_header})
        expected=bytes(n.u.mem_read(expected_indices,count*4))
        values=list(struct.unpack('<'+'i'*count,observed))
        if observed!=expected or not any(v>=0 for v in values) or not scheduler.waits or any(not w['completed'] for w in scheduler.waits):
            raise ValueError('Original waited binding differs from the loaded resource binding')
        result.update(resourceKey=key,loadedResources=loaded,trackIndices=values,waitedBindingMatchesLoadedBinding=True)
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),'phase':phase,
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:
        if scheduler:scheduler.close()
        n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(restore)),
           Path(inspect.getfile(NativeAssetWaitDispatch)),Path(inspect.getfile(prepare_animation_graph)),
           Path(inspect.getfile(inspect_animation_repository)),Path(inspect.getfile(register_resource_archive)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],*borrowed_sources()}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  decoderImageSha256=sha(n.image),originalBlocks=list(n.blocks.values()),
                  waitDispatches=scheduler.waits if scheduler else [],cpuRuns=scheduler.runs if scheduler else [],
                  scope={'originalPendingBindCompleted':result['boundary'] is None,'osWorkersCreated':False,
                         'concurrentExecutionModeled':False,'readinessFieldsSupplied':False,'mainViewerExpanded':False})
    output=fixture.cache/'research/animation-resource-wait-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'waits':len(result['waitDispatches']),'boundary':result['boundary']}))


if __name__=='__main__':main()

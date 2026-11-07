"""Observe original animation graph preparation on supplied typed actor graphs."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from asset_callback_slices_native import NativeAssetCallbackSlices
from character_graph_snapshot import restore
from animation_graph_preparation_native import initialize_animation_repository,prepare_animation_graph
from animation_repository_inspection_native import inspect_animation_repository
from animation_resource_pose_native import sample_animation_resources
from installed_resource_archive_native import register_resource_archive
from probe_shared_constant_sources import borrowed_sources
from vfx_spawn_native import sha,name_hash


TYPES='-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7'


class NativeAnimationGraphInputs(NativeAssetCallbackSlices,NativeAssetWorkQueue):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    parser.add_argument('--actor',required=True,action='append')
    parser.add_argument('--installation',type=Path)
    parser.add_argument('--archive',action='append',default=[])
    parser.add_argument('--drain',action='store_true')
    parser.add_argument('--pose-skeleton',help='Sample loaded resources with this exact installed rig')
    args=parser.parse_args()
    if (args.archive or args.drain) and not args.installation:
        parser.error('Installed archives and read dispatch require --installation')
    if args.drain and not args.archive:parser.error('--drain requires explicit matching champion archives')
    if args.pose_skeleton and (not args.drain or len(args.actor)!=1):
        parser.error('--pose-skeleton requires --drain and one explicit actor')
    if len(set(args.actor))!=len(args.actor):parser.error('Actor controls must be unique')
    cases=[]
    for actor in args.actor:
        fixture=NativeAIUnitFixture(args.cache,args.client,NativeAnimationGraphInputs);n=fixture.native
        stem=actor.replace('/','-')
        postload=fixture.read(fixture.cache/'research'/('character-asset-postload-'+stem+TYPES+'-native.json'))
        graph=fixture.read(fixture.cache/'research'/('character-asset-links-'+stem+'-native.json'))
        if (postload['actorKey']!=actor or not postload['scope']['completeSuppliedStage'] or
                not graph['scope']['referenceLinksFixed'] or graph['boundaries']):
            raise ValueError('Complete matching scoped actor graph/post-load observations required')
        for report in [postload,graph]:
            for file,expected in report['inputs'].items():
                if sha(fixture.raw(Path(file)))!=expected:raise ValueError('Actor graph input changed: '+file)
            for file,expected in report['sources'].items():
                if sha(fixture.raw(fixture.root/'tools'/file))!=expected:raise ValueError('Actor graph producer changed: '+file)
        restore(fixture,postload['snapshot'])
        roots=[case for case in graph['cases'] if case['typeHash']==name_hash('AnimationGraphData')]
        if not 0<len(roots)<=256:raise ValueError('Explicit bounded actor animation graph roots required')
        result={'actor':actor,'setup':{},'graphs':[],'boundary':None}
        n.animation_graph_preparations=[];phase='setup'
        try:
            if args.installation:
                result['setup']['vm']=n.initialize_character_script_vm()
                result['setup']['archives']=[register_resource_archive(fixture,args.installation,a) for a in args.archive]
            else:result['setup']['fileManager']=n.file_manager()
            result['setup']['queue']=n.initialize_asset_work_queue()
            result['setup']['completionDispatcher']=n.initialize_asset_completion_dispatcher(1)
            result['setup']['animationRepository']=initialize_animation_repository(n)
            phase='graph-preparation'
            for case in roots:
                prepared=prepare_animation_graph(n,case['loaded']['object'])
                result['graphs'].append({'identity':case['identity'],'source':case['source'],'preparation':prepared})
            if args.drain:
                phase='animation-read-dispatch';n.drain_asset_read_jobs()
                phase='animation-resource-inspection';result['animationResources']=inspect_animation_repository(n)
                if args.pose_skeleton:
                    phase='animation-pose-sampling'
                    result['animationPoses']=sample_animation_resources(n,result['animationResources'],args.pose_skeleton)
        except Exception as error:
            result['boundary']={'kind':type(error).__name__,'message':str(error),'phase':phase,
                'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                             for key in ['rax','rbx','rdi','rsi','rdx','rcx','rbp','rsp']}}
        finally:n.close_files()
        paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(restore)),
               Path(inspect.getfile(prepare_animation_graph)),Path(inspect.getfile(register_resource_archive)),
               Path(inspect.getfile(inspect_animation_repository)),
               Path(inspect.getfile(sample_animation_resources)),
               *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],*borrowed_sources()}
        result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
            originalBlocks=list(n.blocks.values()),preparations=n.animation_graph_preparations,
            assetQueueState=n.asset_queue_state() if n.asset_work_queue else None,
            assetQueueJobs=n.asset_queue_jobs,assetCompletionRuns=n.asset_completion_runs,
            assetCallbackRuns=n.asset_callback_runs,
            scope={'allSuppliedGraphsPrepared':len(result['graphs'])==len(roots),
                   'queuedReadsDispatched':args.drain and result['boundary'] is None,
                   'animatedPoseVerified':False,'completeAppearanceVerified':False,'mainViewerExpanded':False})
        cases.append(result)
        print(json.dumps({'actor':actor,'graphs':len(result['graphs']),'boundary':result['boundary']}),flush=True)
    output=Path(args.cache)/('research/animation-graph-preparation-dispatch-native.json' if args.drain
                            else 'research/animation-graph-preparation-native.json')
    report={'schema':1,'kind':'original-animation-graph-preparation-observations','build':n.profile['clientVersion'],
            'decoderImageSha256':sha(n.image),'cases':cases,
            'scope':{'suppliedTypedGraphs':True,'readinessBitsSupplied':False,'mainViewerExpanded':False}}
    output.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'output':str(output)}))


if __name__=='__main__':main()

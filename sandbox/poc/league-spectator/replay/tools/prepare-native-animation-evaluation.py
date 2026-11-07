"""Export function-scoped static ANM inputs, not a process or replay snapshot."""
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


class NativeAnimationInputs(NativeAssetCallbackSlices,NativeAssetWorkQueue):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation']:parser.add_argument(name,type=Path)
    parser.add_argument('--actor',required=True);parser.add_argument('--archive',required=True);args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeAnimationInputs);n=fixture.native
    source=fixture.read(fixture.cache/'research/animation-graph-preparation-dispatch-native.json')
    if source['build']!=n.profile['clientVersion'] or source['decoderImageSha256']!=sha(n.image) or len(source['cases'])!=1:
        raise ValueError('Exact single original ANM observation required')
    reference=source['cases'][0]
    if reference['actor']!=args.actor or reference['boundary'] or not reference['animationPoses']:
        raise ValueError('Complete original animation observation for this actor required')
    stem=args.actor.replace('/','-');suffix='-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7'
    post=fixture.read(fixture.cache/'research'/('character-asset-postload-'+stem+suffix+'-native.json'))
    graph=fixture.read(fixture.cache/'research'/('character-asset-links-'+stem+'-native.json'))
    if not post['scope']['completeSuppliedStage'] or graph['boundaries'] or not graph['scope']['referenceLinksFixed']:
        raise ValueError('Complete supplied static graph/post-load required')
    for report in [reference,post,graph]:
        for path,expected in report['inputs'].items():
            if sha(fixture.raw(Path(path)))!=expected:raise ValueError('Native animation input changed: '+path)
        for name,expected in report['sources'].items():
            if sha(fixture.raw(fixture.root/'tools'/name))!=expected:raise ValueError('Native animation producer changed: '+name)
    restore(fixture,post['snapshot'])
    output=fixture.cache/'research/static-native-animation-evaluation.json'
    result={'schema':1,'kind':'function-scoped-native-animation-inputs','build':n.profile['clientVersion'],
            'protocol':n.profile['protocolDigest'],'actor':args.actor,'boundary':None,'segments':[],
            'resources':[],'rig':None,'poseTemplate':None,'binarySha256':None};phase='static-asset-load'
    blob=bytearray();ranges=[]
    def segment(address,size,label):
        if (not 0<size<=0x400000 or not 0x10400000<=address<address+size<=0x12000000 or
                not n.library_pointer(address,size)):
            raise ValueError('Static animation segment exceeds explicit owned asset bounds: '+label)
        for left,right in ranges:
            if address<right and left<address+size:raise ValueError('Overlapping static animation segments: '+label)
        data=bytes(n.u.mem_read(address,size));offset=len(blob);blob.extend(data);ranges.append((address,address+size))
        result['segments'].append({'address':address,'size':size,'offset':offset,'sha256':sha(data),'label':label})
    try:
        n.initialize_character_script_vm();register_resource_archive(fixture,args.installation,args.archive)
        n.initialize_asset_work_queue();n.initialize_asset_completion_dispatcher(1)
        initialize_animation_repository(n);n.animation_graph_preparations=[]
        roots=[c for c in graph['cases'] if c['typeHash']==name_hash('AnimationGraphData')]
        if len(roots)!=1:raise ValueError('One static animation graph required')
        prepare_animation_graph(n,roots[0]['loaded']['object']);n.drain_asset_read_jobs()
        loaded=inspect_animation_repository(n);phase='native-sample-comparison'
        poses=sample_animation_resources(n,loaded,reference['animationPoses']['skeletonPath'])
        if poses['joints']!=reference['animationPoses']['joints']:
            raise ValueError('Fresh native skeleton differs from the verified source')
        if len(poses['resources'])!=len(reference['animationPoses']['resources']):
            raise ValueError('Fresh native ANM resource count differs')
        for actual,expected in zip(poses['resources'],reference['animationPoses']['resources']):
            if (actual['key']!=expected['key'] or actual['trackIndices']!=expected['trackIndices'] or
                    [(s['time'],s['localPosesHex'],s['worldPosesHex']) for s in actual['samples']]!=
                    [(s['time'],s['localPosesHex'],s['worldPosesHex']) for s in expected['samples']]):
                raise ValueError('Fresh original ANM samples differ from the verified source')
        phase='static-input-export';rig=poses['rig'];count=len(poses['joints'])
        segment(rig,0x90,'original-rig-header');segment(n.q(rig+0x28),count*0x70,'original-rig-joints')
        result['rig']={'address':rig,'jointCount':count,'joints':[j['name'] for j in poses['joints']]}
        for index,(resource,sampled) in enumerate(zip(loaded['resources'],poses['resources'])):
            at=resource['resource'];size=n.allocations.get(at);data=n.q(at+8);length=n.u32(at+0x10)
            if resource['key']!=sampled['key'] or size is None or not 0x38<=size<=0x70:
                raise ValueError('Original loaded ANM class allocation differs')
            segment(at,size,'resource-'+str(index));segment(data,length,'resource-data-'+str(index))
            result['resources'].append({'keyHex':f"{resource['key']:016x}",'sourceIndex':index,
                'address':at,'kind':resource['kind'],'frames':resource['frames'],'fps':resource['fps'],
                'trackIndices':sampled['trackIndices'],'evaluatorRva':sampled['originalEvaluationRva']})
        previous=set(n.allocations);pose=n.allocate(0x210);n.u.mem_write(pose+0x110,b'\xa5'*0x100)
        n.call(0x15bc970,{r.UC_X86_REG_RDI:pose,r.UC_X86_REG_RSI:rig})
        if bytes(n.u.mem_read(pose+0x110,0x100))!=b'\xa5'*0x100:raise ValueError('Original pose template escaped its guard')
        template=[]
        for address in sorted(set(n.allocations)-previous):
            segment(address,n.allocations[address],'pose-template');template.append(address)
        result['poseTemplate']={'address':pose,'segments':template,'originalConstructorRva':0x15bc970,
                                'guardAddress':pose+0x110,'guardBytes':0x100}
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),'phase':phase,
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(restore)),
           Path(inspect.getfile(prepare_animation_graph)),Path(inspect.getfile(inspect_animation_repository)),
           Path(inspect.getfile(sample_animation_resources)),Path(inspect.getfile(register_resource_archive)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],*borrowed_sources()}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  decoderImageSha256=sha(n.image),originalBlocks=list(n.blocks.values()),
                  scope={'staticAssetInputsOnly':True,'containsReplayEvents':False,'containsSampledAnimations':False,
                         'containsStaticBindPose':True,'nativeConstructedPoseTemplate':True,
                         'processSnapshot':False,'browserEvaluationVerified':False,'mainViewerExpanded':False})
    if result['boundary'] is None:
        output.with_suffix('.bin').write_bytes(blob);result['binarySha256']=sha(blob)
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'resources':len(result['resources']),'binaryBytes':len(blob),
                      'boundary':result['boundary']}))


if __name__=='__main__':main()

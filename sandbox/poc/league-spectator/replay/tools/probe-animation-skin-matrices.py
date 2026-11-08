"""Prepare original skin matrices for the existing verified native ANM samples."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from aligned_asset_memory_native import AlignedAssetMemory
from installed_resource_archive_native import register_resource_archive
from animation_skin_matrices_native import prepare_skin_matrices
from probe_shared_constant_sources import borrowed_sources
from vfx_spawn_native import sha


class NativeSkinMatrices(AlignedAssetMemory,NativeAssetWorkQueue):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation']:parser.add_argument(name,type=Path)
    parser.add_argument('--archive',required=True);parser.add_argument('--actor',required=True)
    args=parser.parse_args();fixture=NativeAIUnitFixture(args.cache,args.client,NativeSkinMatrices);n=fixture.native
    source=fixture.read(fixture.cache/'research/animation-graph-preparation-dispatch-native.json')
    if (source['build']!=n.profile['clientVersion'] or source['decoderImageSha256']!=sha(n.image) or
            len(source['cases'])!=1):raise ValueError('Exact-build single native animation observation required')
    case=source['cases'][0]
    if (case['actor']!=args.actor or case['boundary'] or not case['animationPoses'] or
            not case['animationPoses']['scope']['originalWorldPosePassExecuted']):
        raise ValueError('Complete original animation/world samples for this actor required')
    for path,expected in case['inputs'].items():
        if sha(fixture.raw(Path(path)))!=expected:raise ValueError('Native animation input changed: '+path)
    for name,expected in case['sources'].items():
        if sha(fixture.raw(fixture.root/'tools'/name))!=expected:raise ValueError('Native animation producer changed: '+name)
    result={'schema':1,'kind':'original-animation-skin-matrices','build':n.profile['clientVersion'],
            'actor':args.actor,'setup':{},'skinMatrices':None,'boundary':None};phase='setup'
    try:
        result['setup']['vm']=n.initialize_character_script_vm()
        result['setup']['archive']=register_resource_archive(fixture,args.installation,args.archive)
        phase='original-skin-matrices';result['skinMatrices']=prepare_skin_matrices(n,case['animationPoses'])
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),'phase':phase,
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(prepare_skin_matrices)),
           Path(inspect.getfile(register_resource_archive)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],*borrowed_sources()}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  decoderImageSha256=sha(n.image),originalBlocks=list(n.blocks.values()),
                  scope={'mainViewerExpanded':False,'gpuSkinningExecuted':False})
    output=fixture.cache/'research/animation-skin-matrices-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    skin=result['skinMatrices']
    print(json.dumps({'output':str(output),'resources':len(skin['resources']) if skin else 0,
                      'samples':sum(len(x['samples']) for x in skin['resources']) if skin else 0,
                      'boundary':result['boundary']}))


if __name__=='__main__':main()

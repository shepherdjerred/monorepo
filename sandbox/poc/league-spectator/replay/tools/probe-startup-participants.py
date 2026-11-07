"""Observe recorded participant initialization and original visibility-mask lookup."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from startup_map_skin_native import recover_startup_map_skin
from startup_participants_native import initialize_recorded_participants
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path);args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeAssetWorkQueue);n=fixture.native
    result={'schema':1,'kind':'original-recorded-startup-participants','build':n.profile['clientVersion'],
            'startup':None,'participants':None,'boundary':None};phase='recorded-startup-input'
    try:
        result['startup']=recover_startup_map_skin(n,fixture.cache,fixture.root,fixture.read,fixture.raw)
        phase='original-participant-consumer';result['participants']=initialize_recorded_participants(fixture,result['startup'])
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),'phase':phase,
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                            'registers':{name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name)) for name in
                                         ['RAX','RBX','RCX','RDX','RDI','RSI','RSP','RBP','R12','R13','R14','R15']}}
    finally:n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(recover_startup_map_skin)),
           Path(inspect.getfile(initialize_recorded_participants)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  decoderImageSha256=sha(n.image),originalBlocks=list(n.blocks.values()),
                  scope={'recordedConsumerCompleted':result['boundary'] is None,'mainViewerExpanded':False})
    output=fixture.cache/'research/startup-participants-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    p=result['participants']
    print(json.dumps({'output':str(output),'counts':p['counterFields'] if p else None,
                      'slots':[s['index'] for s in p['slots']] if p else None,
                      'mask':p['allParticipantMaskHex'] if p else None,'boundary':result['boundary']}))


if __name__=='__main__':main()

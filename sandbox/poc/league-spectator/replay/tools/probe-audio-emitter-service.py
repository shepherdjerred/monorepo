"""Exercise original audio-emitter allocation through the real facade request."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from audio_emitter_service_native import initialize_audio_emitter_service,inspect_audio_emitter_registry
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path);args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeAssetWorkQueue);n=fixture.native
    result={'schema':1,'kind':'original-cpu-audio-emitter-service-control','build':n.profile['clientVersion'],
            'setup':{},'requests':[],'registry':None,'releases':[],'boundary':None};phase='facade-construction'
    try:
        result['setup']['facade']=n.initialize_audio_facade()
        phase='cpu-service-construction';result['setup']['emitterService']=initialize_audio_emitter_service(n)
        service=result['setup']['emitterService']['service'];facade=result['setup']['facade']['object']
        phase='original-facade-emitter-request'
        for _ in range(2):
            n.call(0x248410,{r.UC_X86_REG_RDI:facade})
            interface=n.u.reg_read(r.UC_X86_REG_RAX)
            result['requests'].append({'originalRequestRva':0x248410,'interface':interface})
        phase='registry-inspection';result['registry']=inspect_audio_emitter_registry(n,service)
        if ({e['interface'] for e in result['registry']['entries']}!={v['interface'] for v in result['requests']} or
                result['registry']['count']!=2 or bytes(n.u.mem_read(service+0x200,0x100))!=b'\xa5'*0x100):
            raise ValueError('Original audio requests, registry entries or service guard differ')
        phase='original-facade-emitter-release'
        for i,request in enumerate(result['requests']):
            n.call(0x248430,{r.UC_X86_REG_RDI:facade,r.UC_X86_REG_RSI:request['interface']})
            remaining=inspect_audio_emitter_registry(n,service)
            if (remaining['count']!=1-i or
                    request['interface'] in {e['interface'] for e in remaining['entries']}):
                raise ValueError('Original audio release did not remove its exact emitter registry entry')
            result['releases'].append({'originalReleaseRva':0x248430,'interface':request['interface'],
                                       'remainingRegistry':remaining})
        n.call(0x248430,{r.UC_X86_REG_RDI:facade,r.UC_X86_REG_RSI:0})
        result['nullReleaseRegistry']=inspect_audio_emitter_registry(n,service)
        if result['nullReleaseRegistry']['count'] or bytes(n.u.mem_read(service+0x200,0x100))!=b'\xa5'*0x100:
            raise ValueError('Original null audio release changed the empty registry or service guard')
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),'phase':phase,
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(initialize_audio_emitter_service)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  originalBlocks=list(n.blocks.values()),decoderImageSha256=sha(n.image),
                  scope={'originalFacadeRequestsCompleted':result['boundary'] is None,
                         'originalFacadeReleasesCompleted':result['boundary'] is None,
                         'deviceActivated':False,'soundPlaybackImplemented':False,'mainViewerExpanded':False})
    output=fixture.cache/'research/audio-emitter-service-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'requests':result['requests'],'registry':result['registry'],'boundary':result['boundary']}))


if __name__=='__main__':main()

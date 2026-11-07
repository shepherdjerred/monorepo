"""Observe the original runtime class registration requested by AI appearance."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from appearance_factory_native import initialize_appearance_factory
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    parser.add_argument('--world-runtime',action='store_true',help='Execute the original world registry, full static module and visibility constructors')
    args=parser.parse_args();fixture=NativeAIUnitFixture(args.cache,args.client,NativeAssetWorkQueue);n=fixture.native
    result={'schema':1,'kind':'original-appearance-runtime-class-registration','build':n.profile['clientVersion'],
            'originalRegistrationBlock':[0x374ef9,0x374f67],'descriptorRva':0x24a82f8,
            'registryRva':0x247b7c0,'registrationCompleted':False,'allocationConstructorCompleted':False,
            'boundary':None}
    phase='registration'
    try:
        descriptor=n.base+result['descriptorRva'];registry=n.base+result['registryRva']
        result['registration']=initialize_appearance_factory(n,world_runtime=args.world_runtime)
        result.update(registrationCompleted=True,descriptorHex=bytes(n.u.mem_read(descriptor,0x40)).hex(),
                      registryHeaderHex=bytes(n.u.mem_read(registry,0x18)).hex(),typeHash=0xdd4de76f)
        phase='original-allocation-constructor'
        n.call(0x549c50,{r.UC_X86_REG_RDI:descriptor+8})
        pointer=n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(pointer)!=0x268:
            raise ValueError('Original runtime allocation did not retain its authored object size')
        result.update(allocationConstructorCompleted=True,object=pointer,
                      objectHex=bytes(n.u.mem_read(pointer,0x268)).hex())
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),'phase':phase,
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(initialize_appearance_factory)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  originalBlocks=list(n.blocks.values()),decoderImageSha256=sha(n.image),
                  scope={'originalRegistrationExecuted':result['registrationCompleted'],
                         'initializedWorldObject':False,'completeAppearanceVerified':False,'mainViewerExpanded':False})
    output=fixture.cache/('research/appearance-world-runtime-native.json' if args.world_runtime else
                         'research/appearance-factory-registration-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'registrationCompleted':result['registrationCompleted'],
                      'allocationConstructorCompleted':result['allocationConstructorCompleted'],'boundary':result['boundary']}))


if __name__=='__main__':main()

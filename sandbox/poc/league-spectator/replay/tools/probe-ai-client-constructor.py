"""Observe complete original client AI construction over scoped asset inputs."""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from ai_client_native import NativeAIClientInputs
from native_ai_unit_fixture import NativeAIUnitFixture
from character_graph_snapshot import restore
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--actor',required=True)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeAIClientInputs)
    n,cache = fixture.native,fixture.cache
    stem = args.actor.replace('/','-')
    reference = fixture.read(cache/'research'/('character-asset-postload-'+stem+'-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7-native.json'))
    if not reference['scope']['completeSuppliedStage'] or not reference['snapshot'] or reference['scope']['assetReadinessVerified']:
        raise ValueError('Completed scoped original post-load input required')
    for path,digest in reference['inputs'].items():
        if sha(fixture.raw(Path(path))) != digest:
            raise ValueError('Client AI constructor input changed')
    for path,digest in reference['sources'].items():
        if sha(fixture.raw(fixture.root/'tools'/path)) != digest:
            raise ValueError('Client AI constructor producer changed: '+path)
    restore(fixture,reference['snapshot'])
    audio_facade = n.initialize_audio_facade()
    unit = n.allocate(0x4100)
    n.u.mem_write(unit+0x4000,bytes([0xa5])*0x100)
    last_blocks = []
    def remember(engine,address,size,user):
        last_blocks.append({'rva':address-n.base,'size':size})
        if len(last_blocks) > 64:del last_blocks[0]
    n.u.hook_add(unicorn.UC_HOOK_BLOCK,remember,begin=n.base,end=n.base+len(n.image)-1)
    boundary = None
    try:
        n.call(0xea3c0,{r.UC_X86_REG_RDI:unit})
    except Exception as exception:
        registers = {name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name.upper()))
                     for name in ['rax','rbx','rcx','rdx','rdi','rsi','r8','r9','rbp','rsp']}
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionAddress':n.u.reg_read(r.UC_X86_REG_RIP),'registers':registers,
                    'lastBlocks':last_blocks,'stackHex':bytes(n.u.mem_read(registers['rsp'],256)).hex()}
    fixture.check_guard(unit)
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(__file__).with_name('character_graph_snapshot.py'),
             *[Path(inspect.getfile(c)) for c in NativeAIClientInputs.__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-ai-client-constructor-observation','actorKey':args.actor,
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'unit':unit,'unitHex':bytes(n.u.mem_read(unit,0x4000)).hex(),
              'boundary':boundary,'completed':boundary is None,'stackProbes':n.client_stack_probes,'audioFacade':audio_facade,
              'interfaces':{str(offset):n.q(unit+offset)-n.base for offset in [0,0xb20,0xb28]},
              'scope':{'originalClientConstructorExecuted':True,'guardIntact':True,'assetReadinessVerified':False,
                       'derivedHeroConstructed':False,'worldRoutingVerified':False,'mainViewerExpanded':False}}
    output = cache/'research'/('ai-client-constructor-'+stem+'-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'completed':result['completed'],'interfaces':result['interfaces'],
                      'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()

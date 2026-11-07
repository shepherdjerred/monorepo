"""Observe the complete original spell-preload manager constructor."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from spell_preload_native import NativeSpellPreload
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeSpellPreload)
    n = fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    manager,boundary = None,None
    try:
        manager = n.initialize_spell_preload_manager()
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rcx','rdx','rdi','rsi','r12','r13','r14','r15','rbp','rsp']}}
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-spell-preload-manager-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'manager':manager,'boundary':boundary,
              'scope':{'originalConstructorCompleted':manager is not None,'resourceRegistryReady':False,
                       'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research/spell-preload-manager-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'manager':manager,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()

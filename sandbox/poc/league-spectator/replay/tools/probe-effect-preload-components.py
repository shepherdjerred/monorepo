"""Observe original VFX manager data initialization without worker startup."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from effect_preload_native import NativeEffectPreload
from vfx_object_native import NativeVfxObjects
from vfx_resource_native import NativeVfxResourceContext
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    p.add_argument('--quality',type=int,choices=range(4),required=True)
    p.add_argument('--graphics34b',type=int,choices=[0,1],required=True)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeEffectPreload)
    n = fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    components,boundary = None,None
    try:
        components = n.initialize_effect_preload_components(args.quality,bool(args.graphics34b))
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rcx','rdx','rdi','rsi','r12','r13','r14','r15','rbp','rsp']}}
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(NativeVfxObjects)),
             Path(inspect.getfile(NativeVfxResourceContext)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-effect-preload-component-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'components':components,'boundary':boundary,
              'scope':{'originalComponentsCompleted':components is not None,'completeManagerConstructorExecuted':False,
                       'workerPoolExecuted':False,'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research/effect-preload-components-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'completed':components is not None,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()

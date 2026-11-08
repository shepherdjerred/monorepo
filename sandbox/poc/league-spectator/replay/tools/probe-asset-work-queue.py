"""Observe original owned queue data initialization without thread startup."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from vfx_object_native import NativeVfxObjects
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeAssetWorkQueue)
    n = fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    queue,boundary = None,None
    try:
        queue = n.initialize_asset_work_queue()
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rdi','rsi','rdx','rcx','r8','r9','rbp','rsp']}}
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(NativeVfxObjects)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'owned-original-asset-work-queue-data-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},'originalBlocks':list(n.blocks.values()),
              'queue':queue,'platformCalls':n.asset_queue_platform_calls,'boundary':boundary,
              'scope':{'originalDataPrefixCompleted':queue is not None,'fullConstructorExecuted':False,
                       'osWorkerThreadCreated':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research/asset-work-queue-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'queue':queue,'boundary':boundary}),flush=True)


if __name__ == '__main__':main()

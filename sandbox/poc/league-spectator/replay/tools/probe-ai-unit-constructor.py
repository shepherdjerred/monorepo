"""Locate the first dependency of the original full AI-base constructor.

No game callbacks are substituted. A stopped or failed constructor is not a
usable live unit and must not be passed to replay/effect playback.
"""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from appearance_resource_native import NativeAppearanceResources
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    n = NativeAppearanceResources(cache/'public/decoder-16.21-macos',args.client)
    unit = n.allocate(0x4000)
    faults = []

    def fault(engine,access,address,size,value,user):
        faults.append({'access':access,'address':address,'size':size,
                       'instructionRva':engine.reg_read(r.UC_X86_REG_RIP)-n.base})
        return False

    n.u.hook_add(unicorn.UC_HOOK_MEM_INVALID,fault)
    completed, error = False, None
    try:
        n.call(0xbc980,{r.UC_X86_REG_RDI:unit})
        completed = True
    except Exception as exception:
        error = {'kind':type(exception).__name__,'message':str(exception),
                 'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    paths = {Path(__file__),*[Path(inspect.getfile(c)) for c in NativeAppearanceResources.__mro__ if c is not object]}
    report = {'schema':1,'kind':'original-ai-base-constructor-probe','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'unit':unit,'allocationSize':0x4000,'constructorRva':0xbc980,'completed':completed,
              'error':error,'faults':faults,'originalBlocks':list(n.blocks.values()),
              'scope':{'originalConstructorAttempted':True,'gameCallbacksSubstituted':False,
                       'liveMatchInitializationExecuted':False,'usableLiveUnitEstablished':False,
                       'mainViewerExpanded':False}}
    (cache/'research/ai-base-constructor-probe.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({key:report[key] for key in ['completed','error','faults']}))


if __name__ == '__main__':
    main()

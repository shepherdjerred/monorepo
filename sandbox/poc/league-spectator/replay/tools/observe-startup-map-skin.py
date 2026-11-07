"""Observe the recorded map-skin input reaching the original map bootstrap."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from startup_map_skin_native import recover_startup_map_skin
from unit_base_context_native import NativeUnitBaseContexts
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    args = p.parse_args()
    cache,root = args.cache.resolve(),Path(__file__).resolve().parents[1]
    inputs = {}
    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return data
    def read(path):return json.loads(raw(path))
    n = NativeUnitBaseContexts(cache/'public/decoder-16.21-macos',args.client)
    recovered,boundary = None,None
    try:
        recovered = recover_startup_map_skin(n,cache,root,read,raw)
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    paths = {Path(__file__),Path(inspect.getfile(recover_startup_map_skin)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-recorded-startup-map-skin-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},'originalBlocks':list(n.blocks.values()),
              'recovered':recovered,'boundary':boundary,
              'scope':{'recordedMapBootstrapArgumentsRecovered':recovered is not None,
                       'fullStartupHandlerExecuted':False,'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
    output = cache/'research/startup-map-skin-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'recovered':recovered,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()

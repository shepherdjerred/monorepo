"""Original Map11 Level context identity in a cold owned registry.

This identifies the Level constructor and its null resolver getter. It does not
recover recorded registry history or turn unknown identities into Shared.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    package = args.cache/'public/decoder-16.21-macos'
    sources = {Path(__file__), *[Path(inspect.getfile(klass)) for klass in NativeEffectContexts.__mro__ if klass is not object]}
    paths = sources | {args.client, package/'profile.json', package/'image.bin'}
    inputs = {str(file.resolve()): sha(file.read_bytes()) for file in paths}
    n = NativeEffectContexts(package, args.client)
    u32 = lambda at: struct.unpack('<I', n.u.mem_read(at, 4))[0]
    if (n.profile['clientVersion'] != '16.21.829.8620' or n.profile['protocolDigest'] != '20e09df23c66b85e' or
            sha(n.image) != '3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7' or
            n.q(n.base+0x24728d0) or u32(n.base+0x255d0f0)):
        raise ValueError('Exact cold16.21 resource context image required')
    n.call(0x35dd5c, {}, 0x35dd6e)
    registry = n.registry()
    rows = []
    for map_id in [11, 12]:
        n.call(0x354230, {r.UC_X86_REG_RDI: registry, r.UC_X86_REG_RSI: map_id})
        pointer = n.u.reg_read(r.UC_X86_REG_RAX)
        identity = u32(pointer+0x28)
        if u32(pointer+0x2c) != map_id or n.lookup_context(registry, identity) != pointer:
            raise ValueError('Original Level constructor/registry identity differs')
        getter = n.q(n.q(pointer)+0x30)-n.base
        if getter != 0x35a270:
            raise ValueError('Original Level resource getter differs')
        heap, memory = n.next_heap, bytes(n.u.mem_read(registry, 0xc0))
        n.call(getter, {r.UC_X86_REG_RDI: pointer})
        if n.u.reg_read(r.UC_X86_REG_RAX) or heap != n.next_heap or memory != bytes(n.u.mem_read(registry, 0xc0)):
            raise ValueError('Original Level getter was not a read-only null return')
        rows.append({'mapId': map_id, 'contextId': identity, 'originalGetterRva': getter,
                     'resourceResolver': None, 'objectHex': bytes(n.u.mem_read(pointer, 0x38)).hex()})
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Map context source changed: '+file)
    result = {'schema': 1, 'kind': 'original-map11-level-resource-context-observation',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputs': inputs, 'levels': rows,
              'sharedIdentity': u32(n.base+0x255d0f0), 'originalBlocks': list(n.blocks.values()),
              'scope': {'originalConstructorsAndRegistryExecuted': True, 'originalNullGetterExecuted': True,
                        'recordedRegistryHistoryEstablished': False, 'globalResourceMapsRecovered': False,
                        'unknownContextAccepted': False, 'liveBuffProviderAdmitted': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'levels': rows}))


if __name__ == '__main__':
    main()

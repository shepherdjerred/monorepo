"""Initialized original type descriptors required by typed VFX link casts."""
import argparse
import inspect
import json
from pathlib import Path
from effect_link_native import NativeEffectLinks
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    n = NativeEffectLinks(cache/'public/decoder-16.21-macos', args.client)
    types, pointer = [], n.system_type
    while pointer:
        if len(types) >= 32 or any(t['rva'] == pointer-n.base for t in types):
            raise ValueError('Original resource type hierarchy is cyclic or unbounded')
        identity = n.u32(pointer+8)
        if n.types.get(identity) != pointer or n.u.mem_read(pointer+0x51, 1)[0] or n.u32(pointer+0x70):
            raise ValueError('Resource hierarchy requires a different virtual/interface cast contract')
        types.append({'identity': identity, 'rva': pointer-n.base,
            'bytesHex': bytes(n.u.mem_read(pointer, 0x88)).hex()})
        pointer = n.q(pointer+0x38)
    if len(types) != 2 or types[0]['identity'] != 0x45cd899f:
        raise ValueError('Original VFX resource inheritance changed')
    paths = {Path(__file__)}
    paths.update(Path(inspect.getfile(c)) for c in NativeEffectLinks.__mro__ if c is not object)
    output = cache/'research/effect-link-types-native.json'
    result = {'schema': 1, 'kind': 'native-vfx-resource-type-observation',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'types': types,
        'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'originalBlocks': list(n.blocks.values()),
        'scope': {'originalReflectionInitializer': True, 'initializedDataOnly': True,
            'containsReplayEvents': False, 'virtualOrInterfaceCastsAdmitted': False}}
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'types': [(hex(t['identity']), hex(t['rva'])) for t in types]}))


if __name__ == '__main__':
    main()

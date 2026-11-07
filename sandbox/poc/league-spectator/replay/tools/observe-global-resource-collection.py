"""Original global0 startup and complete publication with null-valued controls."""
import argparse
import inspect
import json
from pathlib import Path
import sys

from unicorn import x86_const as r
from global_resource_collection_native import initialize_global_resource_collection
from map_effect_resource_native import NativeMapEffectResources
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache, client = args.cache.resolve(), args.client.resolve()
    tools = Path(__file__).resolve().parent
    paths = {Path(__file__).resolve(), client,
             cache / 'public/decoder-16.21-macos/profile.json',
             cache / 'public/decoder-16.21-macos/image.bin'}
    paths.update(Path(module.__file__).resolve() for module in tuple(sys.modules.values())
                 if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
                 and Path(module.__file__).resolve().is_relative_to(tools))
    inputs = {str(path): sha(path.read_bytes()) for path in sorted(paths)}
    n = NativeMapEffectResources(cache / 'public/decoder-16.21-macos', client)
    setup = initialize_global_resource_collection(n)
    obj = setup['object']
    try:
        initialize_global_resource_collection(n)
        raise AssertionError('Duplicate startup was accepted')
    except ValueError:
        pass
    n.call(0x89dbd0, {r.UC_X86_REG_RDI: obj})
    component = n.q(n.base + 0x24a8560)
    if (n.allocations.get(component) != 0x30 or n.q(component + 0x10) != obj + 0x28 or
            n.q(component + 0x18) != n.q(component + 0x20)):
        raise ValueError('Original empty global0 publication differs')
    snapshots = []

    def null_map(keys):
        resolver = n.allocate(24)
        n.call(0x16659b0, {r.UC_X86_REG_RDI: resolver})
        rows = n.allocate(len(keys) * 16)
        for i, key in enumerate(keys):
            n.put(rows + i * 16, 'IIQ', key, 0, 0)
        n.put(resolver + 8, 'QII', rows, len(keys), len(keys))
        return resolver

    first = null_map([0xffffffe1, 0xffffffe2])
    second = null_map([0xffffffe1, 0xffffffe3])
    for supplied in [first, second]:
        n.call(0x8988d0, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: supplied})
        if n.q(n.base + 0x24a8560) != component:
            raise ValueError('Original resource append replaced its existing component')
        snapshots.append({'source': supplied, 'rows': n.map_rows(obj + 0x28)})
    if [row['key'] for row in snapshots[-1]['rows']] != [0xffffffe1, 0xffffffe1, 0xffffffe2, 0xffffffe3]:
        raise ValueError('Original global0 merge did not preserve stable duplicate keys')
    queries = [{'key': key, **n.resolve_globals(key),
                'independentBaseLookup': n.lookup_resource(obj + 0x28, key)}
               for key in [0xffffffe1, 0xffffffe2, 0xffffffe3, 0xffffffff]]
    for query in queries:
        if (query['value'] or query['selectedResolver'] != obj + 0x28 or
                query['independentBaseLookup']['found'] != (query['key'] != 0xffffffff)):
            raise ValueError('Original global0 null-match ownership differs')
    overlay = null_map([0xffffffe1])
    n.call(0x377390, {r.UC_X86_REG_RDI: component, r.UC_X86_REG_RSI: overlay})
    overlay_query = n.resolve_globals(0xffffffe1)
    if overlay_query != {'value': 0, 'selectedResolver': overlay}:
        raise ValueError('Global0 overlay no longer precedes its base')
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original global0 observer input changed: ' + path)
    result = {'schema': 1, 'kind': 'original-global-resource-collection-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'setup': setup,
              'component': component, 'publishRva': 0x89dbd0, 'appendRva': 0x8988d0,
              'snapshots': snapshots, 'queries': queries, 'overlayQuery': overlay_query,
              'inputs': inputs, 'originalBlocks': list(n.blocks.values()),
              'scope': {'originalStartupAndPublicationExecuted': True,
                        'originalAppendAndLinkedValueVisitsExecuted': True,
                        'suppliedNullValuedControlMaps': True,
                        'selectedResolverPointerAloneIsNotSuccessEvidence': True,
                        'actualReplayCollectionContentsRecovered': False,
                        'actualReplayGlobal0AbsenceEstablished': False,
                        'acceptedReplayEntities': False, 'actualEffectsActivated': False}}
    output = cache / 'research/global-resource-collection-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'originalStartupCompleted': True,
                      'appendControls': len(snapshots), 'queries': len(queries) + 1,
                      'duplicateStartupRejected': True, 'blocks': len(n.blocks)}))


if __name__ == '__main__':
    main()

"""Original unit resource precedence over explicitly supplied authored maps."""
import argparse
import inspect
import json
from pathlib import Path
from unit_resource_native import NativeUnitResources
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    path = cache/'research/effect-resolvers-native.json'
    reference_bytes = path.read_bytes()
    reference = json.loads(reference_bytes)
    inputs = {str(path): sha(reference_bytes)}
    for name, digest in reference['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError('Original authored map producer changed')
    for path, digest in reference['inputs'].items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original authored map input changed')
    n = NativeUnitResources(cache/'public/decoder-16.21-macos', args.client)
    if reference['decoderImageSha256'] != sha(n.image):
        raise ValueError('Authored maps belong to another decoder image')
    heap_start = n.next_heap
    map_handles, units, cases = [], [], []
    for c in reference['cases']:
        if c['status'] != 'native-resource-map-loaded':
            continue
        a, b = n.load_prepared_map(c), n.load_prepared_map(c)
        map_handles.extend({'actorKey': c['actorKey'], 'handle': handle,
            'object': obj, 'rows': c['loaded']['rows']}
            for handle, obj in [('A', a), ('B', b)])
        plain_a = n.create_unit(a)
        plain_b = n.create_unit(b)
        overlay = n.create_unit(a, [b, None, a, b])
        empty = n.create_unit()
        null_overlay = n.create_unit(a, [None])
        if overlay['overlays'] != [0, a, b] or null_overlay['overlays'] != [0]:
            raise ValueError('Original overlay push did not remove and reappend an existing entry')
        for label, u in [('plain-a', plain_a), ('plain-b', plain_b), ('overlay', overlay),
                          ('empty', empty), ('null-overlay', null_overlay)]:
            units.append({'actorKey': c['actorKey'], 'label': label, **u})
        modes = [('first-unit-base', [plain_a['object'], plain_b['object']], [b], a),
            ('newest-overlay', [overlay['object']], [a], b),
            ('unit-before-auxiliary', [empty['object'], plain_b['object']], [a], b),
            ('auxiliary-after-unit-miss', [empty['object']], [a,b], a),
            ('skip-null-overlay', [null_overlay['object']], [b], a)]
        for row in c['loaded']['rows']:
            for label, unit_objects, auxiliary_objects, expected_owner in modes:
                result = n.resolve(row['key'], unit_objects, auxiliary_objects)
                if result['owner'] != expected_owner or result['value'] != row['value']:
                    raise ValueError('Original unit resolver changed explicit precedence')
                cases.append({'actorKey': c['actorKey'], 'label': label, 'key': row['key'],
                    'units': unit_objects, 'auxiliaries': auxiliary_objects, **result})
        for unit_objects, auxiliary_objects in [([plain_a['object']], [b]), ([empty['object']], [])]:
            result = n.resolve(0xffffffff, unit_objects, auxiliary_objects)
            if result['status'] != 'continue-global-resolution':
                raise ValueError('Original missing key did not continue to globals')
            cases.append({'actorKey': c['actorKey'], 'label': 'missing-key', 'key': 0xffffffff,
                'units': unit_objects, 'auxiliaries': auxiliary_objects, **result})
        print(json.dumps({'actor': c['actorKey'], 'rows': len(c['loaded']['rows']),
            'unitObjects': 5}), flush=True)
    paths = {Path(__file__)}
    paths.update(Path(inspect.getfile(c)) for c in NativeUnitResources.__mro__ if c is not object)
    result = {'schema': 1, 'kind': 'native-unit-resource-precedence-observation',
        'build': reference['build'], 'protocol': reference['protocol'], 'decoderImageSha256': sha(n.image),
        'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'originalBlocks': list(n.blocks.values()),
        'heapStart': heap_start, 'heapHex': bytes(n.u.mem_read(heap_start, n.next_heap-heap_start)).hex(),
        'maps': map_handles, 'units': units, 'cases': cases,
        'counts': {'maps': len(map_handles), 'units': len(units), 'lookups': len(cases),
            'nullReferenceMatches': sum(c['status'] == 'matched-authored-reference' and c['value'] == 0 for c in cases),
            'globalBoundaryStops': sum(c['status'] == 'continue-global-resolution' for c in cases)},
        'scope': {'originalEntityAndComponentConstructors': True, 'originalComponentGetter': True,
            'originalBaseAndOverlaySetters': True, 'originalUnitThenAuxiliaryResolver': True,
            'suppliedStacksNotObservedMatchState': True, 'mapValuesAreReferenceTokens': True,
            'globalResolutionExecuted': False, 'worldEffectFactoryExecuted': False,
            'browserExecuted': False, 'referenceCompared': False}}
    output = cache/'research/unit-resources-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'counts': result['counts']}))


if __name__ == '__main__':
    main()

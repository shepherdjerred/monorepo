"""Read authored ResourceResolver maps with the original typed reader/lookup."""
import argparse
import importlib.metadata
import io
import inspect
import json
from pathlib import Path
import runpy
from effect_resolver_native import NativeEffectResolverAssets
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    p.add_argument('--actor')
    args = p.parse_args()
    cache = args.cache.resolve()
    effects_dir = cache/'public/latest-effects'
    inputs = {}
    def raw(path):
        b = path.read_bytes()
        inputs[str(path)] = sha(b)
        return b
    def read(path):
        return json.loads(raw(path))
    effects = read(effects_dir/'manifest.json')
    package = read(effects_dir/'package.json')
    distribution = importlib.metadata.distribution('cdtb')
    if json.loads(distribution.read_text('direct_url.json'))['vcs_info']['commit_id'] != '3367589fdd3ee3d0d01383d2f98dba12b04d1371':
        raise ValueError('Typed BIN reader revision differs')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary, name in [(binfile.hashfile_binfields, 'binfields'), (binfile.hashfile_bintypes, 'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(raw(path)) != effects['toolchain']['dictionaries'][name]:
            raise ValueError('Typed BIN dictionary differs')
        dictionary.hashes = names(path)
    for dictionary in [binfile.hashfile_binentries, binfile.hashfile_binhashes, binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}
    class Reader(binfile.BinReader):
        def __init__(self, *a):
            super().__init__(*a)
            self.spans = {}
        def read_field(self, htype):
            start = self.f.tell()
            field = super().read_field(htype)
            self.spans[id(field)] = (start, self.f.tell())
            return field
    n = NativeEffectResolverAssets(cache/'public/decoder-16.21-macos', args.client)
    cases = []
    for actor, ref in effects['actors'].items():
        if args.actor and actor != args.actor:
            continue
        source = next(p for p in package['actors'][actor]['sourceBins'] if p['path'] == ref['skinPath'])
        path = cache/'research/latest-effects/bins'/(source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]+'.bin')
        data = raw(path)
        if sha(data) != source['sourceSha256'] or data[:4] != b'PROP':
            raise ValueError('Original skin BIN source differs')
        if ref['resourceResolverId'] is None:
            cases.append({'actorKey': actor, 'status': 'no-authored-resource-resolver',
                'sourceSha256': sha(data), 'probes': []})
            print(json.dumps({'actor': actor, 'status': 'no-authored-resource-resolver'}), flush=True)
            continue
        stream = io.BytesIO(data)
        stream.read(4)
        reader = Reader(stream)
        _, _, types = reader.read_binfile_header()
        entries = {e.path.h: e for e in [reader.read_binfile_entry(t) for t in types]}
        identity = int(ref['resourceResolverId'].strip('{}'), 16)
        entry = entries[identity]
        if entry.type.h != 0xef3a0f33:
            raise ValueError('Authored resolver type differs')
        fields = [data[a:b] for a, b in [reader.spans[id(f)] for f in entry.fields]]
        loaded = n.read_resolver_fields(fields)
        expected = {int(key, 16): int(value['reference'].strip('{}'), 16)
                    for key, value in ref['resources'].items()}
        if {v['key']: v['value'] for v in loaded['rows']} != expected:
            raise ValueError('Native resource map differs from the complete authored resolver')
        probes = []
        for row in loaded['rows']:
            result = n.lookup_resource(loaded['object'], row['key'])
            if not result['found'] or result['value'] != row['value']:
                raise ValueError('Original resolver lookup differs from its loaded map')
            probes.append({'key': row['key'], **result})
        for key in [0, 1, 0xffffffff]:
            if key in {v['key'] for v in loaded['rows']}:
                continue
            result = n.lookup_resource(loaded['object'], key)
            if result['found'] or result['value']:
                raise ValueError('Original resolver returned a missing key')
            probes.append({'key': key, **result})
        cases.append({'actorKey': actor, 'status': 'native-resource-map-loaded', 'resourceResolverId': identity, 'sourceSha256': sha(data),
            'fields': [{'bytes': len(f), 'sha256': sha(f)} for f in fields],
            'loaded': loaded, 'probes': probes})
        print(json.dumps({'actor': actor, 'resources': len(loaded['rows']), 'pendingLinks': loaded['pendingLinkCount']}), flush=True)
    if not cases:
        raise ValueError('No resolver actor selected')
    context_package = read(cache/'public/latest-effect-contexts/package.json')
    replay = read(cache/'research/latest-semantics-effects.json')
    if context_package['effectsManifestSha256'] != inputs[str(effects_dir/'manifest.json')] or replay['build'] != effects['build'] or replay['protocol'] != effects['protocol']:
        raise ValueError('Resolver/context/replay builds differ')
    by_actor = {c['actorKey']: c for c in cases if c['status'] == 'native-resource-map-loaded'}
    by_id = {c['identity']: c['actorKey'] for c in context_package['contexts']}
    chains = []
    for descriptor in replay['effectDescriptors']:
        ids = descriptor['unresolvedAuxiliaryContextIds']
        if not ids or descriptor['resourceKey'] == 0 or any(by_id.get(i) not in by_actor for i in ids):
            continue
        objects = [by_actor[by_id[i]]['loaded']['object'] for i in ids]
        chains.append({'creationSequence': descriptor['creationSequence'], 'resourceKey': descriptor['resourceKey'],
            'contextIds': ids, **n.resolve_auxiliary_chain(descriptor['resourceKey'], objects)})
    paths = {Path(__file__), Path(__file__).with_name('parse-latest-assets.py')}
    paths.update(Path(inspect.getfile(c)) for c in NativeEffectResolverAssets.__mro__ if c is not object)
    result = {'schema': 1, 'kind': 'native-authored-resource-resolver-observations',
        'build': effects['build'], 'protocol': effects['protocol'], 'decoderImageSha256': sha(n.image),
        'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'originalBlocks': list(n.blocks.values()), 'reflectionTypeCount': len(n.types),
        'initializerGlobalZeroes': n.resource_global_zeroes, 'initializerStackProbes': n.resource_stack_probes,
        'boundedAllocatorCalls': n.resolver_allocator_calls,
        'resolverType': n.type_catalog['ef3a0f33'], 'baseResolverType': n.type_catalog['72a165de'],
        'cases': cases, 'chains': chains, 'counts': {'actors': len(cases), 'loadedResolvers': sum(c['status'] == 'native-resource-map-loaded' for c in cases),
            'mapEntries': sum(len(c['loaded']['rows']) for c in cases if 'loaded' in c),
            'lookups': sum(len(c['probes']) for c in cases), 'replayAuxiliaryChains': len(chains),
            'matchedAuxiliaryChains': sum(c['status'] == 'matched-authored-reference' for c in chains)},
        'scope': {'partialSelection': bool(args.actor), 'originalReflectionInitializer': True,
            'originalSerializedFieldReader': True, 'originalKeyLookup': True,
            'postloadExecuted': False, 'externalLinksResolved': False,
            'completeFactoryPrecedenceExecuted': False, 'browserExecuted': False, 'referenceCompared': False}}
    result['scope'].update(originalAuxiliaryChainExecuted=True, unitResourceContextsSuppliedEmpty=True,
        globalResolutionStagesExecuted=False, returnedValuesAreUnresolvedAssetReferences=True)
    output = cache/'research'/('effect-resolvers-native-partial.json' if args.actor else 'effect-resolvers-native.json')
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'counts': result['counts']}))


if __name__ == '__main__':
    main()

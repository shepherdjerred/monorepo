"""Original typed asset fixups from authored resource maps to live VFX roots."""
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
    p.add_argument('--actor', required=True)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}
    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    assets = cache/'public'
    manifest = read(assets/'latest-effects/manifest.json')
    systems = read(assets/'latest-vfx-system-assets/package.json')
    resolver_observation = read(cache/'research/effect-resolvers-native.json')
    actor = manifest['actors'][args.actor]
    case = next(c for c in resolver_observation['cases'] if c['actorKey'] == args.actor)
    if case['status'] != 'native-resource-map-loaded':
        raise ValueError('Actor has no authored resource resolver')
    if (systems['effectsManifestSha256'] != sha(raw(assets/'latest-effects/manifest.json')) or
        resolver_observation['build'] != systems['build'] or resolver_observation['protocol'] != systems['protocol']):
        raise ValueError('Typed asset/resolver builds differ')
    for name, digest in systems['compilerSources'].items():
        if sha(raw(Path(__file__).with_name(name))) != digest:
            raise ValueError('Original system loader source changed')
    for name, digest in resolver_observation['sources'].items():
        if sha(raw(Path(__file__).with_name(name))) != digest:
            raise ValueError('Original resolver loader source changed')
    parsed = {}
    def fields(ref):
        digest = ref['rawSourceSha256']
        if digest not in parsed:
            path = cache/'research/latest-effects/bins'/(digest+'-'+manifest['toolchain']['parserIdentity'][:16]+'.bin')
            parsed[digest] = raw(path)
            if sha(parsed[digest]) != digest or parsed[digest][:4] != b'PROP':
                raise ValueError('Typed asset source bytes changed')
        data = parsed[digest]
        result = []
        for field in ref['fields']:
            value = data[field['offset']:field['offset']+field['bytes']]
            if len(value) != field['bytes'] or sha(value) != field['sha256']:
                raise ValueError('Original serialized field slice differs')
            result.append(value)
        return result
    n = NativeEffectLinks(assets/'decoder-16.21-macos', args.client)
    entries, live = [], []
    ids = sorted(set(v['effectId'] for v in actor['resources'].values() if v['status'] == 'prepared-definition'))
    for effect_id in ids:
        ref = systems['systems'][effect_id]
        root = n.load_live_system(fields(ref))
        identity = int(effect_id.rsplit('/', 1)[1], 16)
        entries.append({'identity': identity, 'effectId': effect_id,
            'object': root['object'], 'typeRva': root['typeRva']})
        live.append({'effectId': effect_id, **root})
        if len(live) % 50 == 0:
            print(json.dumps({'actor': args.actor, 'loadedRoots': len(live), 'totalRoots': len(ids)}), flush=True)
    # The native resolver observation recorded exact raw field digests. Its
    # skin source and field offsets are recovered from the same pinned BIN
    # parser as the original resolver producer, without reserializing values.
    import importlib.metadata
    import io
    import runpy
    import cdtb.binfile as binfile
    distribution = importlib.metadata.distribution('cdtb')
    if json.loads(distribution.read_text('direct_url.json'))['vcs_info']['commit_id'] != '3367589fdd3ee3d0d01383d2f98dba12b04d1371':
        raise ValueError('Typed BIN parser revision differs')
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary, name in [(binfile.hashfile_binfields, 'binfields'), (binfile.hashfile_bintypes, 'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(raw(path)) != manifest['toolchain']['dictionaries'][name]:
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
            self.spans[id(field)] = start, self.f.tell()
            return field
    # This source hash is the actual skin BIN used by the native map reader.
    path = cache/'research/latest-effects/bins'/(case['sourceSha256']+'-'+manifest['toolchain']['parserIdentity'][:16]+'.bin')
    data = raw(path)
    if sha(data) != case['sourceSha256'] or data[:4] != b'PROP':
        raise ValueError('Resolver source changed')
    stream = io.BytesIO(data)
    stream.read(4)
    reader = Reader(stream)
    _, _, types = reader.read_binfile_header()
    source_entries = {e.path.h: e for e in [reader.read_binfile_entry(t) for t in types]}
    entry = source_entries[case['resourceResolverId']]
    serialized = [data[a:b] for a,b in [reader.spans[id(f)] for f in entry.fields]]
    if [{'bytes': len(f), 'sha256': sha(f)} for f in serialized] != case['fields']:
        raise ValueError('Original resolver field spans changed')
    loaded = n.read_resolver_fields(serialized)
    if loaded['rows'] != case['loaded']['rows']:
        raise ValueError('Live arena resolver differs from original authored map')
    fixed = n.fix_resolver_links(loaded, sorted(entries, key=lambda v: v['identity']))
    sources = {Path(__file__), Path(__file__).with_name('parse-latest-assets.py')}
    sources.update(Path(inspect.getfile(c)) for c in NativeEffectLinks.__mro__ if c is not object)
    result = {'schema': 1, 'kind': 'native-typed-effect-link-observation', 'actorKey': args.actor,
        'build': systems['build'], 'protocol': systems['protocol'], 'decoderImageSha256': sha(n.image),
        'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
        'originalBlocks': list(n.blocks.values()), 'loadedRoots': live, 'resolverRows': loaded['rows'],
        'fixups': fixed, 'counts': {'loadedRoots': len(live), 'resourceRows': len(loaded['rows']),
            'pendingAfter': fixed['pendingAfter'], 'missingReferenceTokens': len(fixed['missingReferenceTokens'])},
        'scope': {'originalSystemFieldReaderAndPostload': True, 'originalResolverFieldReader': True,
            'originalTypedLinkFixup': True, 'callerSuppliedLocalLibrary': True,
            'globalAssetRegistryExecuted': False, 'unitResourcePrecedenceVerified': False,
            'worldFactoryExecuted': False, 'browserExecuted': False, 'referenceCompared': False}}
    output = cache/'research/effect-links-native'/('actor-'+args.actor.replace('/', '-')+'.json')
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'actor': args.actor, 'status': fixed['status'], 'counts': result['counts']}), flush=True)


if __name__ == '__main__':
    main()

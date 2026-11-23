"""Original scene context/typed-resolver controls; no asset or replay factory."""
import argparse
import inspect
import json
from pathlib import Path

from effect_context_native import NativeEffectContexts
from effect_resolver_native import NativeEffectResolverAssets
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['contexts', 'resolvers'])
    for name in ['native_root', 'client', 'input_root', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Original native evidence output already exists')
    root = args.input_root.resolve()
    manifest_bytes = (root/'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    files = {entry['file']: entry for entry in manifest['files']}
    inputs = {str(root/'manifest.json'): sha(manifest_bytes)}

    def read(file):
        entry = files[file]
        path = (root/file).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Native resource input escaped its owned root')
        data = path.read_bytes()
        if len(data) != entry['bytes'] or sha(data) != entry['sha256']:
            raise ValueError('Original native resource input changed')
        inputs[str(path)] = sha(data)
        return data

    request = json.loads(read(manifest['input']))
    if request['schema'] != 2 or request['kind'] != 'original-scene-effect-resource-inputs' or request['nativeSpectatorAdmitted']:
        raise ValueError('Exact scene resource inputs required')
    producer_sources = {str((Path(__file__).parent/file).resolve()): digest for file, digest in request['compilerSources'].items()}
    for path, digest in producer_sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original resource input producer source changed')
    native_type = NativeEffectContexts if args.mode == 'contexts' else NativeEffectResolverAssets
    n = native_type(args.native_root, args.client)
    if n.profile['clientVersion'] != request['build'] or n.profile['protocolDigest'] != request['protocol']:
        raise ValueError('Original native resource image build differs')
    for path in [args.native_root/'profile.json', args.native_root/'image.bin', args.client]:
        inputs[str(path.resolve())] = sha(path.read_bytes())
    sources = {Path(__file__)}
    sources.update(Path(inspect.getfile(base)) for base in native_type.__mro__ if base is not object)
    source_hashes = {path.name: sha(path.read_bytes()) for path in sorted(sources)}
    observed = []
    alias_count = sum(len(row['actorAliases'])-1 for row in request['contexts'])
    scope = {'staticBuildDataOnly': True, 'containsReplayEvents': False,
        'appearanceAliasesBoundToCompleteOriginalSources': True,
        'assetLoadingExecuted': False, 'effectFactoryExecuted': False,
        'fullResourcePrecedenceVerified': False, 'fullMatchRegistryReconstructed': False,
        'browserExecuted': False, 'referenceCompared': False}
    controls = {}
    if args.mode == 'contexts':
        registry = n.registry()
        identities = set()
        for row in request['contexts']:
            result = n.character_context(row['name'], row['skinId'], row['namespace'])
            if result['identity'] in identities:
                raise ValueError('Distinct original appearance groups collide')
            identities.add(result['identity'])
            n.register_context(registry, result['object'])
            if n.lookup_context(registry, result['identity']) != result['object']:
                raise ValueError('Original registry failed insertion/lookup')
            observed.append({**result, 'actorKey': row['actorKey'], 'actorAliases': row['actorAliases'], 'aliasSources': row['aliasSources'], 'sourceIdentity': row['sourceIdentity']})
        duplicates = []
        for row, alias in [(row, alias) for row in observed for alias in row['aliasSources'][1:]]:
            control_registry = n.registry()
            duplicate = n.character_context(alias['name'], row['skinId'], row['namespace'])
            n.register_context(control_registry, row['object'])
            first_lookup = n.lookup_context(control_registry, row['identity'])
            n.register_context(control_registry, duplicate['object'])
            second_lookup = n.lookup_context(control_registry, row['identity'])
            if first_lookup != row['object'] or second_lookup not in [row['object'], duplicate['object']] or duplicate['identity'] != row['identity']:
                raise ValueError('Original duplicate registry control is unresolved')
            duplicates.append({'actorKey': row['actorKey'], 'actorAliases': row['actorAliases'],
                'aliasActorKey': alias['actorKey'], 'firstName': row['name'], 'secondName': alias['name'],
                'identity': row['identity'], 'firstObject': row['object'], 'secondObject': duplicate['object'],
                'firstLookup': first_lookup, 'secondLookup': second_lookup,
                'observedPointerSelection': 'first' if second_lookup == row['object'] else 'last'})
        for row in reversed(observed):
            if n.lookup_context(registry, row['identity']) != row['object']:
                raise ValueError('Independent original registry control changed')
        boundaries = [n.character_context('Ornn', value) for value in [0, 1, 9, 10, 99, 100, 65535, 0x7fffffff, 0xffffffff]]
        missing = []
        for identity in [0, 1, 0xffffffff, 3579051965]:
            if identity in identities:
                continue
            result = n.lookup_context(registry, identity)
            if result != registry+0x68:
                raise ValueError('Original missing registry lookup differs')
            missing.append({'identity': identity, 'result': result})
        controls = {'duplicateRegistry': duplicates, 'boundaries': boundaries, 'missing': missing}
        scope.update(originalConstructorPrefix=True, originalIdentityFragment=True,
            decimalSkinTextSuppliedAndCFormatterCompared=True,
            originalRegistryInsertionAndLookup=True, duplicateRegistryInsertionAndLookupObserved=True,
            originalAliasSpellingsConstructed=True)
    else:
        loaded = []
        for row in request['contexts']:
            original = row['sourceIdentity']
            if original['resolverId'] is None:
                if original['rows'] or row['resolverFields']:
                    raise ValueError('Absent original resolver has rows/fields')
                observed.append({'actorKey': row['actorKey'], 'actorAliases': row['actorAliases'], 'aliasSources': row['aliasSources'],
                    'sourceIdentity': original, 'status': 'no-authored-resource-resolver', 'probes': []})
                continue
            fields = []
            for field in row['resolverFields']:
                raw = read(field['sourceBin'])
                data = read(field['file'])
                if sha(raw) != field['sourceBinSha256'] or not 0 <= field['start'] < field['end'] <= len(raw) or raw[field['start']:field['end']] != data or len(data) < 5 or int.from_bytes(data[:4], 'little') != int(field['fieldHash'], 16):
                    raise ValueError('Original resolver field span differs')
                fields.append(data)
            result = n.read_resolver_fields(fields)
            actual = [{'key': entry['key'], 'referenceToken': entry['value']} for entry in result['rows']]
            if actual != original['rows']:
                raise ValueError('Original typed resolver rows differ from complete source map')
            probes = []
            for entry in actual:
                found = n.lookup_resource(result['object'], entry['key'])
                if not found['found'] or found['value'] != entry['referenceToken']:
                    raise ValueError('Original resource lookup changed a serialized row')
                probes.append({'key': entry['key'], **found})
            for key in [0, 1, 0xffffffff]:
                if key in {entry['key'] for entry in actual}:
                    continue
                found = n.lookup_resource(result['object'], key)
                if found['found'] or found['value']:
                    raise ValueError('Original resolver returned a missing resource key')
                probes.append({'key': key, **found})
            observed.append({'actorKey': row['actorKey'], 'actorAliases': row['actorAliases'], 'aliasSources': row['aliasSources'],
                'sourceIdentity': original, 'status': 'native-resource-map-loaded', 'loaded': result,
                'fields': row['resolverFields'], 'probes': probes})
            loaded.append({'actorKey': row['actorKey'], 'object': result['object'], 'rows': actual})
            print(json.dumps({'actor': row['actorKey'], 'resources': len(actual)}), flush=True)
        chains = []
        for row in loaded:
            for entry in row['rows'][:1]:
                result = n.resolve_auxiliary_chain(entry['key'], [row['object']])
                if result['status'] != 'matched-authored-reference' or result['value'] != entry['referenceToken']:
                    raise ValueError('Original single-context auxiliary chain differs')
                chains.append({'actors': [row['actorKey']], 'resourceKey': entry['key'], **result})
        pair = next(((left, right, entry) for left in loaded for right in loaded if left is not right for entry in left['rows'] if any(other['key'] == entry['key'] and other['referenceToken'] != entry['referenceToken'] for other in right['rows'])), None)
        if pair:
            left, right, entry = pair
            for first, second in [(left, right), (right, left)]:
                expected = next(value for value in first['rows'] if value['key'] == entry['key'])
                result = n.resolve_auxiliary_chain(entry['key'], [first['object'], second['object']])
                if result['status'] != 'matched-authored-reference' or result['value'] != expected['referenceToken']:
                    raise ValueError('Original auxiliary chain order control differs')
                chains.append({'actors': [first['actorKey'], second['actorKey']], 'resourceKey': entry['key'], **result})
        if not chains:
            raise ValueError('Original auxiliary chain controls did not execute')
        controls = {'auxiliaryChains': chains}
        scope.update(originalReflectionInitializer=True, originalSerializedFieldReader=True,
            originalKeyLookup=True, originalAuxiliaryChainExecuted=True,
            unitResourceContextsSuppliedEmpty=True, returnedValuesAreUnresolvedAssetReferences=True,
            postloadExecuted=False, externalLinksResolved=False, globalResolutionStagesExecuted=False)
    for file, digest in {**inputs, **producer_sources}.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original native resource input/source changed during execution')
    for source in sources:
        if sha(source.read_bytes()) != source_hashes[source.name]:
            raise ValueError('Original native resource evaluator source changed')
    report = {'schema': 2, 'kind': 'native-scene-'+('character-effect-context-observations' if args.mode == 'contexts' else 'authored-resource-resolver-observations'),
        'build': request['build'], 'protocol': request['protocol'], 'decoderImageSha256': sha(n.image),
        'effectsManifestSha256': request['effectsManifestSha256'], 'sceneManifestSha256': request['sceneManifestSha256'],
        'inputManifestSha256': sha(manifest_bytes), 'inputs': inputs, 'inputProducerSources': producer_sources,
        'sources': source_hashes, 'originalBlocks': list(n.blocks.values()), 'cases': observed,
        'controls': controls, 'scope': scope, 'counts': {'canonicalContexts': len(observed),
            'appearances': request['appearances'], 'aliases': alias_count}, 'nativeSpectatorAdmitted': False}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps({'output': str(args.output), 'counts': report['counts']}), flush=True)


if __name__ == '__main__':
    main()

"""Observe build-specific static character identities and real registry lookup."""
import argparse
import inspect
import json
from pathlib import Path
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    manifest_path = cache/'public/latest-effects/manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    n = NativeEffectContexts(cache/'public/decoder-16.21-macos', args.client)
    registry = n.registry()
    contexts = []
    for actor, ref in manifest['actors'].items():
        result = n.character_context(ref['character'], ref['skinId'])
        result['actorKey'] = actor
        n.register_context(registry, result['object'])
        if n.lookup_context(registry, result['identity']) != result['object']:
            raise ValueError('Native registry did not retain the constructed context')
        contexts.append(result)
    for context in reversed(contexts):
        if n.lookup_context(registry, context['identity']) != context['object']:
            raise ValueError('Native registry changed after later insertions')
    boundaries = []
    for skin in [0, 1, 9, 10, 99, 100, 65535, 0x7fffffff, 0xffffffff]:
        boundaries.append(n.character_context('Ornn', skin))
    missing = []
    known = {v['identity'] for v in contexts}
    for identity in [0, 1, 0xffffffff, 3579051965]:
        if identity in known:
            continue
        result = n.lookup_context(registry, identity)
        if result != registry+0x68:
            raise ValueError('Unknown context did not use the native default entry')
        missing.append({'identity': identity, 'result': result})
    nodes = []
    pending = [n.q(registry+0x58)]
    seen = set()
    while pending:
        at = pending.pop()
        if not at:
            continue
        if at in seen or n.allocations.get(at) != 0x30:
            raise ValueError('Native context registry tree has an invalid node')
        seen.add(at)
        nodes.append({'address': at, 'bytesHex': bytes(n.u.mem_read(at, 0x30)).hex()})
        pending.extend([n.q(at), n.q(at+8)])
    registry_observation = {'address': registry,
        'bytesHex': bytes(n.u.mem_read(registry, 0xc0)).hex(), 'nodes': nodes,
        'lookups': [{'identity': c['identity'], 'result': c['object']} for c in contexts]+missing}
    paths = {Path(__file__)}
    paths.update(Path(inspect.getfile(c)) for c in NativeEffectContexts.__mro__ if c is not object)
    result = {'schema': 1, 'kind': 'native-character-effect-context-observations',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'effectsManifestSha256': sha(manifest_bytes),
        'inputs': {str(manifest_path): sha(manifest_bytes)},
        'sources': {v.name: sha(v.read_bytes()) for v in sorted(paths)},
        'originalBlocks': list(n.blocks.values()), 'registry': registry,
        'contexts': contexts, 'boundaries': boundaries, 'missing': missing,
        'registryObservation': registry_observation,
        'counts': {'contexts': len(contexts), 'boundaryCases': len(boundaries),
                   'defaultLookups': len(missing)},
        'scope': {'originalConstructorPrefix': True, 'originalIdentityFragment': True,
            'decimalSkinTextSuppliedAndCFormatterCompared': True,
            'originalRegistryInsertionAndLookup': True, 'assetLoadingExecuted': False,
            'resourcePrecedenceExecuted': False, 'matchCreationExecuted': False,
            'browserExecuted': False, 'referenceCompared': False}}
    output = cache/'research/effect-contexts-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'counts': result['counts']}))


if __name__ == '__main__':
    main()

"""Original HealthRelic character-context identity and supplied publication.

This establishes the name behind one recorded auxiliary ID. It does not
establish that the actual replay registry contains this context or its assets.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    paths = {Path(__file__).resolve(), args.client.resolve(),
             cache / 'public/decoder-16.21-macos/profile.json',
             cache / 'public/decoder-16.21-macos/image.bin',
             *[Path(inspect.getfile(c)).resolve() for c in NativeEffectContexts.__mro__ if c is not object]}
    inputs = {str(path): sha(path.read_bytes()) for path in paths}
    n = NativeEffectContexts(cache / 'public/decoder-16.21-macos', args.client)
    n.call(0x35dd5c, {}, 0x35dd6e)
    registry = n.registry()
    before = n.lookup_context(registry, 3143740604)
    context = n.character_context('HA_AP_HealthRelic', 0)
    if context['identity'] != 3143740604 or before != registry + 0x68:
        raise ValueError('Original HealthRelic identity or cold lookup differs')
    n.register_context(registry, context['object'])
    after = n.lookup_context(registry, context['identity'])
    if after != context['object']:
        raise ValueError('Original registry did not publish supplied context')
    getter = n.q(n.q(after) + 0x30) - n.base
    if getter != 0x353f70 or n.q(after + 0x60):
        raise ValueError('Original character resource getter or constructor default differs')
    prefix_bytes = bytes(n.u.mem_read(after, 0x90))
    n.call(getter, {r.UC_X86_REG_RDI: after})
    if n.u.reg_read(r.UC_X86_REG_RAX) or bytes(n.u.mem_read(after, 0x90)) != prefix_bytes:
        raise ValueError('Original getter mutated its constructor-only context')
    static_path = cache / 'research/health-relic-context-inputs/manifest.json'
    static_bytes = static_path.read_bytes()
    inputs[str(static_path)] = sha(static_bytes)
    static = json.loads(static_bytes)
    if (static['kind'] != 'installed-health-relic-context-inputs' or
            static['characterName'] != context['name'] or
            static['build'] != n.profile['clientVersion']):
        raise ValueError('Matching installed HealthRelic context inputs required')
    for path, expected in static['inputs'].items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError('Installed HealthRelic input changed: ' + path)
        inputs[path] = expected
    boundaries = [n.character_context('HA_AP_HealthRelic', skin) for skin in [1, 2, 12]]
    if any(row['identity'] == context['identity'] for row in boundaries):
        raise ValueError('Skin identity controls unexpectedly collide')
    reconstruction_path = cache / 'research/viewer-root-reconstruction.json'
    encoded = reconstruction_path.read_bytes()
    inputs[str(reconstruction_path)] = sha(encoded)
    reconstruction = json.loads(encoded)
    if reconstruction['runtimePlaybackInput'] is not False:
        raise ValueError('Expected diagnostic reconstruction only')
    requests = [d for d in reconstruction['report']['effectDescriptors']
                if context['identity'] in d['unresolvedAuxiliaryContextIds']]
    main = [d for d in requests if 69 <= d['time'] <= 99]
    free = [d for d in main if all(d[key] == 0 for key in
            ['resourceContextEntityId', 'attachmentEntityId', 'lookup14EntityId', 'lookupA8EntityId'])]
    for path, expected in inputs.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError('Input changed: ' + path)
    result = {'schema': 1, 'kind': 'original-health-relic-context-identity-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputs': inputs,
              'context': context, 'skinBoundaryControls': boundaries,
              'registry': {'object': registry, 'coldLookup': before, 'publishedLookup': after,
                           'resourceGetterRva': getter,
                           'constructorPrefixNullGetterControl': True},
              'installedInputs': {'resourceResolverId': static['resourceResolverId'],
                                  'authoredResourceKeys': static['authoredResourceKeys'],
                                  'absentRequestedKeys': static['absentRequestedKeys'],
                                  'mapCharacterPreloadLinks': static['mapCharacterPreloadLinks']},
              'recordedRequests': {'throughPrefix': len(requests), 'comparisonWindow': len(main),
                                   'providerFreeComparisonWindow': len(free),
                                   'providerFreeKeys': sorted(set(d['resourceKey'] for d in free))},
              'sourceBlocks': list(n.blocks.values()),
              'scope': {'originalConstructorPrefix': True, 'originalIdentityFragment': True,
                        'originalRegistryInsertionAndLookup': True, 'suppliedPublication': True,
                        'actualReplayRegistryPublicationRecovered': False,
                        'assetLoadingExecuted': False, 'constructorOnlyGetterExecuted': True,
                        'loadedResourceGetterEstablished': False,
                        'resourcePrecedenceExecuted': False, 'browserExecuted': False,
                        'renderedCoverage': False}}
    output = cache / 'research/health-relic-effect-context-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'identity': context['identity'],
                      'resourceGetterRva': getter, 'recordedRequests': result['recordedRequests']}))


if __name__ == '__main__':
    main()

"""Original initial default/base callback prefix with explicit prepared resources.

This isolates ordering and constructor state. The recorded identity candidates
and authored resolver maps are supplied inputs, not accepted appearance state.
The original visual callback, asset readiness, and network admission are excluded.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    semantics = fixture.read(fixture.cache / 'research/latest-semantics-effects.json')
    maps = fixture.read(fixture.cache / 'research/effect-resolvers-native.json')
    effects = fixture.read(fixture.cache / 'public/latest-effects/manifest.json')
    if (semantics['build'] != n.profile['clientVersion'] or maps['decoderImageSha256'] != sha(n.image)
            or effects['build'] != semantics['build']):
        raise ValueError('Exact-build decoded identities and original authored maps required')
    entries, supplied = [], []
    for hero in semantics['heroes']:
        key = 'champions/%s/%u' % (hero['champion'].lower(), hero['skinId'])
        candidates = [case for case in maps['cases'] if case['actorKey'] == key]
        if len(candidates) != 1 or effects['actors'][key]['skinId'] != hero['skinId']:
            raise ValueError('One exact supplied authored resolver identity required')
        resolver = n.load_prepared_map(candidates[0])
        context = n.character_context(hero['champion'], hero['skinId'])
        # Explicit typed resolver input. This does not execute or replace the
        # original context asset loader, and does not assert live readiness.
        n.put(context['object'] + 0x60, 'Q', resolver)
        entries.append({'name': hero['champion'], 'namespace': '', 'skinId': hero['skinId'],
                        'keyFlags': 0, 'context': context['object']})
        supplied.append({'hero': hero, 'actorKey': key, 'context': context, 'resolver': resolver,
                         'resolverDefinitionId': candidates[0]['resourceResolverId']})
    prepared = n.prepare_cache(entries)
    cases = []
    for row, wrapper in zip(supplied, prepared):
        hero = row['hero']
        unit = fixture.construct_ai()
        n.call(0x377260, {r.UC_X86_REG_RDI: unit + 0x10})
        group = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(group) != 0x30:
            raise ValueError('Original AI resource component missing')

        def resource_state():
            begin, end = n.q(group + 0x18), n.q(group + 0x20)
            if end < begin or (end - begin) % 8 or end - begin > 32768:
                raise ValueError('Original resource overlay vector escaped bounds')
            return {'context': n.q(unit + 0x110), 'baseResolver': n.q(group + 0x10),
                    'overlays': [n.q(at) for at in range(begin, end, 8)]}

        initial = resource_state()
        if initial != {'context': 0, 'baseResolver': 0, 'overlays': []}:
            raise ValueError('Original constructor does not establish an empty initial resource state')
        name = n.allocate(24)
        n.call(0x11fe0, {r.UC_X86_REG_RDI: name,
                        r.UC_X86_REG_RSI: n.allocate_text(hero['champion']),
                        r.UC_X86_REG_RDX: len(hero['champion'])})
        namespace = n.allocate_text('')
        fixture.run_to(0xbfc30, 0x67c57, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: name,
                        r.UC_X86_REG_RDX: hero['skinId'], r.UC_X86_REG_RCX: 0,
                        r.UC_X86_REG_R8: namespace})
        stored = n.stack_input(unit + 0x35e0)
        expected_key = {key: wrapper[key] for key in ['name', 'namespace', 'skinId', 'keyFlags']}
        if (stored['defaultEntry']['key'] != expected_key or stored['entries'] != []
                or stored['defaultEntry']['flags'] != [True, False, True, True, True]):
            raise ValueError('Original initial default key/flags/vector differs')
        if resource_state() != initial:
            raise ValueError('Storage prefix unexpectedly installed resources')
        fixture.run_to(0x668c0, 0x66989, {r.UC_X86_REG_RDI: unit + 0x35e0,
                                       r.UC_X86_REG_RSI: 1})
        installed = resource_state()
        if installed != {'context': row['context']['object'], 'baseResolver': row['resolver'], 'overlays': []}:
            raise ValueError('Original pre-visual base callback differs')
        if n.q(unit + 0x35e0 + 0xd8) != wrapper['object'] or n.q(unit + 0x35e0 + 0xb8) != 0:
            raise ValueError('Base callback boundary did not precede visual callback')
        fixture.check_guard(unit)
        cases.append({'entityId': hero['entityId'], 'champion': hero['champion'], 'skinId': hero['skinId'],
                      'source': hero['provenance'], 'unit': unit, 'component': group,
                      'initial': initial, 'stored': stored, 'installed': installed,
                      'resolverDefinitionId': row['resolverDefinitionId'],
                      'baseCallbackWrapper': wrapper['object'], 'visualCallbackWrapper': 0,
                      'stoppedRva': 0x66989})
    ranges = [(0x66230, 0x66303), (0xbfc30, 0xbfca9), (0x67c20, 0x67c5c),
              (0x668c0, 0x669c0), (0x67330, 0x67ac0), (0xc4f10, 0xc4f30),
              (0x548bf0, 0x548c30), (0x377260, 0x377390)]
    for begin, end in ranges:
        if n.image[begin:end] != n.source.image[begin:end]:
            raise ValueError('Initial prefix source differs from original client')
    sources = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
               *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    fingerprints = {**fixture.inputs, **{str(path.resolve()): sha(path.read_bytes()) for path in sources}}
    for path, digest in fingerprints.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Initial prefix control source changed during execution: ' + path)
    result = {'schema': 1, 'kind': 'original-initial-default-resource-prefix-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'cases': cases,
              'sourceBlocks': [{'startRva': a, 'endRva': z, 'sha256': sha(n.image[a:z])} for a, z in ranges],
              'originalBlocks': list(n.blocks.values()), 'inputs': fingerprints,
              'counts': {'originalAiConstructors': len(cases), 'defaultStoragePrefixes': len(cases),
                         'baseCallbacksBeforeVisualCallbacks': len(cases), 'emptyOverlayStates': len(cases)},
              'scope': {'originalAiConstructorsExecuted': True, 'originalDefaultSetterExecuted': True,
                        'originalPreVisualBaseCallbackExecuted': True, 'suppliedRecordedIdentityCandidates': True,
                        'suppliedPreparedCache': True, 'suppliedTypedAuthoredResolvers': True,
                        'fullCharacterAssetLoaderExecuted': False, 'appearanceReadinessEstablished': False,
                        'actual1049HandlerExecuted': False, 'acceptedReplayState': False,
                        'networkAdmissionEstablished': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/initial-resource-prefix-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'counts': result['counts'], 'inputs': len(fingerprints)}))


if __name__ == '__main__':
    main()

"""Observe additional original type definitions required by mode dependencies."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from mode_dependency_types_native import initialize_mode_dependency_types
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, NativeCharacterScripts)
    n = fixture.native
    character_types = n.initialize_character_types()
    result, boundary, repeated, schemas = None, None, None, []
    try:
        result = initialize_mode_dependency_types(n)
        before_repeat = dict(n.types)
        repeated = initialize_mode_dependency_types(n)
        if repeated['operations'] or n.types != before_repeat:
            raise ValueError('Repeated mode metadata preparation replaced or re-registered a descriptor')
        identities = [identity for operation in result['operations'] for identity in operation['typeHashes']]
        for identity in identities:
            descriptor = n.types[identity]
            schemas.append({'typeHash': identity, 'descriptorRva': descriptor - n.base,
                            'objectBytes': n.q(descriptor + 0x40),
                            'properties': n.type_catalog[f'{identity:08x}']['properties']})
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {key: n.u.reg_read(getattr(r, 'UC_X86_REG_' + key.upper()))
                                  for key in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_mode_dependency_types)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'characterTypes': character_types,
              'modeTypes': result, 'boundary': boundary,
              'preparation': n.mode_type_preparation,
              'repeat': repeated, 'requestedSchemas': schemas,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'completeRequestedMetadata': boundary is None, 'assetGraphLoaded': False,
                        'acceptedReplayEntities': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/mode-dependency-types-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'typeCount': result and result['typeCountAfter'],
                      'addedTypes': result and len(result['addedTypeHashes']),
                      'requestedSchemas': len(schemas), 'repeatedWithoutRegistration': repeated is not None and not repeated['operations'],
                      'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

"""Check original locale defaults, resource aliases and bounded uppercase ABI."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from locale_configuration_native import NativeLocaleCaseConversion, initialize_locale_configuration
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


class Control(NativeLocaleCaseConversion, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cases, inputs, blocks = [], {}, {}
    for supplied, primary, archive in [('', 'en_US', 'en_US'), ('en_US', 'en_US', 'en_US'),
                                        ('en_GB', 'en_GB', 'en_US'), ('zh_CN', 'zh_CN', 'zh_CN')]:
        fixture = NativeAIUnitFixture(args.cache, args.client, Control)
        n = fixture.native
        result = initialize_locale_configuration(n, supplied)
        if result['primaryLocale'] != primary or result['archiveLocale'] != archive:
            raise ValueError('Original locale output differs from its observed archive convention')
        try:
            initialize_locale_configuration(n, supplied)
        except ValueError as error:
            if 'must be cold' not in str(error): raise
        else: raise ValueError('Duplicate locale construction was accepted')
        cases.append(result)
        inputs.update(fixture.inputs)
        blocks.update(n.blocks)
    probes = []
    for value in [*range(128), 0xffffffff]:
        n.call(0x1fee690, {r.UC_X86_REG_RDI: value})
        actual = n.u.reg_read(r.UC_X86_REG_EAX)
        expected = value - 32 if 97 <= value <= 122 else value
        if actual != expected: raise ValueError('Locale ASCII uppercase result differs')
        probes.append({'input': value, 'result': actual})
    rejected = []
    for value in [128, 255, 256, 0xfffffffe]:
        try: n.call(0x1fee690, {r.UC_X86_REG_RDI: value})
        except ValueError: rejected.append(value)
        else: raise ValueError('Unobserved locale uppercase input was accepted')
    paths = {Path(__file__), Path(inspect.getfile(initialize_locale_configuration)),
             Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in Control.__mro__ if c not in [Control, object]]}
    report = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'cases': cases, 'asciiProbes': probes, 'rejectedUppercaseInputs': rejected,
              'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(blocks.values()),
              'scope': {'actualOriginalConstructorAndGetters': True,
                        'replayLocaleRecovered': False, 'installedArchiveReadiness': False}}
    output = args.cache / 'research/locale-configuration-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'asciiProbes': len(probes),
                      'rejectedUppercaseInputs': rejected}))


if __name__ == '__main__':
    main()

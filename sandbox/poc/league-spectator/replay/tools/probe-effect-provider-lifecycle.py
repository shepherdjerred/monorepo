"""Execute original entity provider getters with original AI ownership.

The sign bit is a supplied component input. Only the original negative-state
generation-reset prefix runs; no match death/revive transition is claimed.
Root boolean controls use an explicitly bounded empty-callback parent view.
"""
import argparse
import inspect
import json
from pathlib import Path

from unicorn import x86_const as r
from game_mode_data_native import NativeGameModeData
from libcpp_shared_native import NativeLibcppSharedOwnership
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


class NativeProviderLifecycle(NativeLibcppSharedOwnership, NativeGameModeData):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, native_class=NativeProviderLifecycle)
    n = fixture.native
    unit = fixture.construct_ai()
    control = n.q(unit + 0x108)
    if n.allocations.get(control) != 32 or n.q(n.q(unit + 0x100)) != unit:
        raise ValueError('Original AI constructor does not own the expected weak entity wrapper')
    root = n.allocate(0x160)
    n.call(0x1786e80, {r.UC_X86_REG_RDI: root})
    if int.from_bytes(n.u.mem_read(root + 0xc2, 2), 'little') != 212:
        raise ValueError('Original root constructor flags differ')
    # This is a bounded field view for 1762d90, not a constructed effect parent.
    parent, link = n.allocate(0x2c0), n.allocate(0x40)
    n.put(parent + 0x1d8, 'Q', link)
    n.put(link + 0x38, 'Q', root)
    providers = []

    def construct_provider(entity):
        provider = n.allocate(0x30)
        n.call(0x54ced0, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: entity})
        if n.q(provider) - n.base != 0x2336698:
            raise ValueError('Original entity provider class differs')
        if entity and (n.q(provider + 8) != n.q(unit + 0x100) or n.q(provider + 0x10) != control):
            raise ValueError('Original provider did not inherit original entity ownership')
        providers.append(provider)
        return provider

    original = construct_provider(unit)
    null_provider = construct_provider(0)
    rows = []

    def sample(label):
        outputs = []
        for provider in providers:
            before = bytes(n.u.mem_read(control, 32))
            values = []
            for getter in [0x54d410, 0x54d4c0]:
                n.call(getter, {r.UC_X86_REG_RDI: provider})
                value = n.u.reg_read(r.UC_X86_REG_RAX) & 255
                if value not in [0, 1]:
                    raise ValueError('Original provider getter is not a boolean')
                values.append(value)
                if bytes(n.u.mem_read(control, 32)) != before:
                    raise ValueError('Original provider getter leaked an entity shared reference')
            root_controls = []
            for flags in [208, 210, 212, 214]:
                n.put(root + 0xc2, 'H', flags)
                # Exercise native clear/set idempotence and preserve other bits.
                n.put(parent + 0xf8, 'I', 0x120)
                before_parent = bytes(n.u.mem_read(parent, 0x2c0))
                n.call(0x1762d90, {r.UC_X86_REG_RDI: parent,
                                   r.UC_X86_REG_RSI: values[0], r.UC_X86_REG_RDX: values[1]})
                after_parent = bytes(n.u.mem_read(parent, 0x2c0))
                expected = bool(values[0] and not flags & 2 or values[1] and not flags & 4)
                if n.u32(parent + 0xf8) != (0x120 | (8 if expected else 0)):
                    raise ValueError('Original provider-to-root boolean mask differs')
                changed = [i for i, (a, b) in enumerate(zip(before_parent, after_parent)) if a != b]
                if any(i not in range(0xf8, 0xfc) for i in changed):
                    raise ValueError('Empty-callback root control changed another parent field')
                root_controls.append({'flags': flags, 'parentFlag8': expected,
                                      'parentFlags': n.u32(parent + 0xf8), 'changedOffsets': changed})
            outputs.append({'provider': provider, 'isNullEntityProvider': provider == null_provider,
                            'snapshot': n.u32(provider + 0x18), 'getter88': values[0],
                            'getter90': values[1], 'rootControls': root_controls})
        rows.append({'label': label, 'entitySignField': n.u32(unit + 0x154),
                     'encodedGenerationField': n.u32(unit + 0x14c), 'outputs': outputs})

    sample('original-ai-constructor-and-provider-snapshot')
    n.put(unit + 0x154, 'I', n.u32(unit + 0x154) | 0x80000000)
    sample('supplied-negative-sign-input')
    fixture.run_to(0xbfa60, 0xbfae8, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RDX: 0})
    sample('original-negative-state-reset-prefix')
    construct_provider(unit)
    sample('new-provider-original-generation-snapshot')
    n.put(unit + 0x154, 'I', n.u32(unit + 0x154) | 0x80000000)
    sample('second-supplied-negative-sign-input')
    fixture.run_to(0xbfa60, 0xbfae8, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RDX: 0})
    sample('second-original-negative-state-reset-prefix')
    fixture.check_guard(unit)
    original_outputs = [next(p for p in row['outputs'] if p['provider'] == original) for row in rows]
    if [(p['getter88'], p['getter90']) for p in original_outputs] != [(0, 0), (1, 0), (0, 1), (0, 1), (1, 1), (0, 1)]:
        raise ValueError('Original provider sign/generation sequence differs')
    if any(p['getter88'] or p['getter90'] for row in rows for p in row['outputs'] if p['isNullEntityProvider']):
        raise ValueError('Original null-entity provider unexpectedly reports a transition')
    sources = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
               *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'original-entity-provider-root-lifecycle-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'unit': unit, 'control': control,
              'cases': rows, 'libcppCalls': n.shared_calls, 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'scope': {'originalAiConstructorAndOwnership': True,
                        'fullOriginalProviderConstructorAndGetters': True,
                        'originalNegativeStateResetPrefixOnly': True,
                        'originalRoot1762d90': True, 'boundedEmptyCallbackParentFieldView': True,
                        'fullEffectParentConstructed': False, 'expiredEntityControl': False,
                        'emissionStoppingEstablished': False, 'matchLifecycleRecovered': False,
                        'compilerAdmissionChanged': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/effect-provider-lifecycle-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'phases': len(rows),
                      'getterPairs': sum(len(row['outputs']) for row in rows),
                      'rootControls': sum(len(p['rootControls']) for row in rows for p in row['outputs'])}))


if __name__ == '__main__':
    main()

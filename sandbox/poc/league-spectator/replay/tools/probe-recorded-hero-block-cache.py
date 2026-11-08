"""Verify the block-cache mixin beneath the actual hero probe's full MRO.

Only definitions, the existing cold AI fixture, an original type getter and the
complete AI-base constructor run. This does not execute the hero entrypoint,
mount installed resources, prepare graphics or restore a full process snapshot.
"""
import argparse
import inspect
import json
from pathlib import Path
import runpy

from native_ai_unit_fixture import NativeAIUnitFixture
from pristine_block_cache_native import NativePristineBlockCache
from vfx_spawn_native import NativeSpawn, sha
from unicorn import x86_const as r


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    cache = args.cache.resolve()
    module_path = root / 'probe-recorded-hero-creation.py'
    module = runpy.run_path(str(module_path))
    current = module['NativeRecordedHeroInputs']
    CachedControl = module['Control']

    baseline_overrides = [cls for cls in current.__mro__ if 'check_block' in cls.__dict__]
    cached_overrides = [cls for cls in CachedControl.__mro__ if 'check_block' in cls.__dict__]
    if ([cls for cls in cached_overrides if cls is not NativePristineBlockCache] != baseline_overrides or
            cached_overrides[-2:] != [NativePristineBlockCache, NativeSpawn]):
        raise AssertionError('Cached full observer changed the existing override order')
    inputs = {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Full-MRO smoke input changed: ' + str(path))
        inputs[str(path)] = digest
        return data

    paths = {Path(__file__), module_path, Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(cls)) for cls in CachedControl.__mro__ if cls not in [object, current, CachedControl]]}
    for path in paths:
        raw(path)
    raw(args.client)
    for filename in ['profile.json', 'image.bin']:
        raw(cache / 'public/decoder-16.21-macos' / filename)
    rows = []
    for label, cls in [('baseline', current), ('cached', CachedControl)]:
        fixture = NativeAIUnitFixture(cache, args.client, cls)
        native = fixture.native
        for path, digest in fixture.inputs.items():
            if sha(raw(path)) != digest:
                raise ValueError('AI fixture input changed during smoke initialization')
        native.call(0xea3b0, {})
        getter = native.u.reg_read(r.UC_X86_REG_RAX)
        if getter != native.base + 0x248e608:
            raise AssertionError('Original AIClient type getter differs')
        unit = fixture.construct_ai()
        body = bytes(native.u.mem_read(unit, 0x4000))
        blocks = sorted(native.blocks.values(), key=lambda row: row['rva'])
        proof = {'aiClientDescriptorRva': getter - native.base,
                 'unit': unit, 'unitBytes': len(body), 'unitBytesSha256': sha(body),
                 'unitVtableRva': native.q(unit) - native.base, 'nextHeap': native.next_heap,
                 'originalBlockCount': len(blocks),
                 'originalBlocksSha256': sha(json.dumps(blocks, sort_keys=True, separators=(',', ':')).encode())}
        row = {'label': label, 'proof': proof}
        if label == 'cached':
            if type(native.image) is not bytes or type(native.source.image) is not bytes:
                raise AssertionError('Cached source images are not immutable bytes')
            row['cache'] = native.pristine_block_cache_statistics()
        rows.append(row)
    if rows[0]['proof'] != rows[1]['proof']:
        raise AssertionError('Full-MRO cache changed original constructor output, heap or block evidence')
    for path in list(inputs):
        raw(path)
    result = {'schema': 1, 'kind': 'full-hero-observer-mro-block-cache-smoke',
              'build': native.profile['clientVersion'], 'protocol': native.profile['protocolDigest'],
              'decoderImageSha256': native.profile['decoderImageSha256'],
              'inputs': inputs, 'fullMainOverrideOrder': [cls.__name__ for cls in cached_overrides],
              'sameOriginalConstructorBytesHeapAndExecutedBlockEvidence': True, 'runs': rows,
              'scope': {'fullHeroBootstrapExecuted': False, 'recordedHeroPacketConsumed': False,
                        'originalInstructionsReplaced': False, 'readinessFieldsSupplied': False,
                        'graphicsInitialized': False, 'wholeProcessSnapshotRestored': False,
                        'existingColdAiFixtureRestored': True}}
    output = cache / 'research/recorded-hero-block-cache-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key != 'inputs'}, indent=2))
    print(json.dumps({'output': str(output)}))


if __name__ == '__main__':
    main()

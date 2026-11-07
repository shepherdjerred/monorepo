"""Original Hero-path collection startup and identity-only insertion controls."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from aligned_asset_memory_native import AlignedAssetMemory
from game_mode_data_native import NativeGameModeData
from native_ai_unit_fixture import NativeAIUnitFixture
from hero_client_collection_native import initialize_hero_client_collection
from vfx_spawn_native import ADDRESSES, sha


class Control(AlignedAssetMemory, NativeGameModeData):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    paths = {Path(__file__), Path(inspect.getfile(initialize_hero_client_collection)),
             Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    setup = initialize_hero_client_collection(n)
    try:
        initialize_hero_client_collection(n)
    except ValueError:
        pass
    else:
        raise ValueError('Duplicate original collection startup admitted')
    collection = setup['object']
    if n.q(n.q(collection) + 0x10) != n.base + 0x177b00 or n.image[0x177b00:0x177b06] != bytes.fromhex('554889e55dc3'):
        raise ValueError('Identity-only notification is not the original no-op')
    pointers = [n.allocate(8) for _ in range(12)]
    expected, controls = [], []
    for pointer in [*pointers, pointers[0], pointers[6], pointers[-1]]:
        # Begin after the original unit-specific c00d0 prelude; this scoped
        # collection fragment consumes only the supplied pointer identity.
        n.call(0x13e2c9, {r.UC_X86_REG_RBX: pointer, r.UC_X86_REG_R14: 1,
                        r.UC_X86_REG_RBP: 0x100f5000,
                        r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, 0x13e418)
        if pointer not in expected:
            expected.append(pointer)
        count = n.u32(collection + 0x10)
        actual = [n.q(n.q(collection + 8) + i * 8) for i in range(count)]
        if actual != expected:
            raise ValueError('Original Hero-path collection insertion/deduplication differs')
        controls.append({'pointer': pointer, 'items': actual, 'count': count,
                         'capacity': n.u32(collection + 0x14)})
    blocks = [(0x66a244, 0x66a260), (0x149df0, 0x149e67),
              (0x13e2c9, 0x13e418), (0x177b00, 0x177b06)]
    for begin, end in blocks:
        if n.image[begin:end] != n.source.image[begin:end]:
            raise ValueError('Hero-path collection source differs from original client')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Collection source changed during native control: ' + path)
    result = {'schema': 1, 'kind': 'original-hero-path-collection-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'setup': setup, 'controls': controls,
              'duplicateStartupRejected': True, 'inputs': fixture.inputs, 'sources': sources,
              'sourceFingerprintsCheckedBeforeAndAfterExecution': True,
              'sourceBlocks': [{'rva': a, 'size': z - a, 'sha256': sha(n.image[a:z])} for a, z in blocks],
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalStartupCompleted': True, 'originalInsertionAndDeduplication': True,
                        'originalNoOpNotificationExecuted': True, 'suppliedOpaquePointerIdentities': True,
                        'unitPreludeExecuted': False, 'fullHeroHandlerCompleted': False,
                        'acceptedReplayEntities': False, 'resourceContextAccepted': False}}
    output = fixture.cache / 'research/hero-client-collection-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'finalCount': len(expected)}))


if __name__ == '__main__':
    main()

"""Execute the neutral factory's original world-registration/position prefix.

The replay's decoded factory inputs are applied to original cold AI clients.
Character appearance and the complete neutral factory remain outside this
observation; successful registration here does not accept replay entities.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from ai_client_native import NativeAIClientInputs
from libcpp_shared_native import NativeLibcppSharedOwnership
from minion_factory_native import initialize_minion_factory, allocate_minion
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha
from neutral_argument_corpus import load_neutral_argument_proof, SCHEMA_PATH


class NativeNeutralPlacementInputs(NativeLibcppSharedOwnership, NativeAIClientInputs):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'arguments', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--client-kind', choices=['ai', 'minion', 'factory-minion'], default='ai')
    args = parser.parse_args()
    source_bytes = args.arguments.read_bytes()
    source = load_neutral_argument_proof(args.arguments)
    fixture = NativeAIUnitFixture(args.cache, args.client, NativeNeutralPlacementInputs)
    n = fixture.native
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_minion_factory)),
             Path(inspect.getfile(load_neutral_argument_proof)), SCHEMA_PATH,
             *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)}
    if sha(n.image) != source['decoderImageSha256']:
        raise ValueError('Original neutral decoder identity differs')
    cases, boundary, active, factory = [], None, None, None
    batches, blocks, inputs, shared_calls = [], {}, {}, []
    ranges = [(0x186b26, 0x186b69), (0xc10bf, 0xc10d9), (0x549cd0, 0x549dd2),
              (0xc31a0, 0xc31aa), (0x548870, 0x54888f)]

    def capture_batch():
        for start, end in ranges:
            if n.image[start:end] != n.source.image[start:end]:
                raise ValueError('Original neutral position dataflow changed')
        blocks.update(n.blocks)
        for file, expected in fixture.inputs.items():
            if file in inputs and inputs[file] != expected:
                raise ValueError('Native placement input changed between independent controls')
            inputs[file] = expected
        shared_calls.extend(n.shared_calls)
        if hasattr(n, 'close_files'):
            n.close_files()
    try:
        n.initialize_audio_facade()
        n.initialize_ui_data_prefix()
        if args.client_kind == 'factory-minion':
            factory = initialize_minion_factory(n)
        world = n.allocate(0x268)
        n.u.mem_write(world+0x168, b'\xa5'*0x100)
        n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
        if n.q(n.base+0x24722c0) != world:
            raise ValueError('Original constructor did not publish its control world')
        for proof_source, record_index, record in [(proof_source, index, record) for proof_source in source['proofs']
                                                  for index, record in enumerate(proof_source['proof']['records'])]:
            # Each prefix check is a cold supplied-world control, not a live
            # replay simulation. Keep independent contexts below the unchanged
            # native allocation bound and never mix matches in one control.
            if record_index % 256 == 0:
                if cases:
                    capture_batch()
                    fixture = NativeAIUnitFixture(args.cache, args.client, NativeNeutralPlacementInputs)
                    n = fixture.native
                    if sha(n.image) != source['decoderImageSha256']:
                        raise ValueError('Original neutral decoder identity differs')
                    n.initialize_audio_facade()
                    n.initialize_ui_data_prefix()
                    factory = initialize_minion_factory(n) if args.client_kind == 'factory-minion' else None
                    world = n.allocate(0x268)
                    n.u.mem_write(world+0x168, b'\xa5'*0x100)
                    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
                    if n.q(n.base+0x24722c0) != world:
                        raise ValueError('Original constructor did not publish its control world')
                batches.append({'argumentSourceSha256': proof_source['sha256'], 'firstRecord': record_index,
                                'count': 0, 'controlWorld': world, 'originalMinionFactory': factory})
            active = {key: record[key] for key in ['time', 'param', 'transportSequence']}
            active.update({'argumentSourceSha256': proof_source['sha256'],
                           'replaySha256': proof_source['proof']['replaySha256'],
                           'sourceRecordIndex': record_index, 'controlBatch': len(batches)-1})
            # 186b45..186b4d copies the seventh integer stack argument into
            # c0e80's flags; c0e80 forwards that value to 549cd0 unchanged.
            flags = record['stackArguments'][6]
            if flags != 0:
                raise ValueError('Only the observed zero-flag neutral placement branch is admitted')
            minion = args.client_kind != 'ai'
            constructor = 0x18bb30 if minion else 0xea3c0
            if factory is not None:
                unit = allocate_minion(n, factory)
            else:
                unit = n.allocate(0x4100)
                n.u.mem_write(unit+0x4000, b'\xa5'*0x100)
                n.call(constructor, {r.UC_X86_REG_RDI: unit})
                fixture.check_guard(unit)
            expected_table = 0x23013b8 if minion else 0x22ef3d0
            if n.q(unit) != n.base+expected_table:
                raise ValueError('Original cold client constructor selected a different native class')
            if n.u32(unit+0x20) or n.q(unit+0xe8):
                raise ValueError('Original AI client is not cold and unregistered')
            point = n.allocate(12)
            point_bytes = struct.pack('<fff', *record['firstVectorArgument'])
            n.u.mem_write(point, point_bytes)
            count_before = n.u32(world+0x14)
            fixture.run_to(0x549cd0, 0x549dbf, {
                r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: 0,
                r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: point,
                r.UC_X86_REG_R8: flags, r.UC_X86_REG_R9: 0,
            })
            if n.q(unit+0xe8) != world or n.u32(world+0x14) != count_before+1:
                raise ValueError('Original placement prefix did not register its cold AI client')
            native_point = bytes(n.u.mem_read(unit+0x15c, 12))
            if native_point != point_bytes:
                raise ValueError('Original virtual placement setter changed the recorded factory point')
            if factory is None:
                fixture.check_guard(unit)
            if bytes(n.u.mem_read(world+0x168, 0x100)) != b'\xa5'*0x100:
                raise ValueError('Original registration escaped the owned world')
            cases.append(active | {
                'character': record['character'], 'unit': unit,
                'constructorRva': constructor, 'vtableRva': expected_table,
                'localGenerationHandle': n.u32(unit+0x20),
                'networkId': n.u32(unit+0x78),
                'recordedFactoryPoint': record['firstVectorArgument'],
                'nativePosition': list(struct.unpack('<fff', native_point)),
                'nativePositionBits': list(struct.unpack('<III', native_point)),
                'nativeHeightBits': n.u32(unit+0x160),
                'nativePositionPrefixHex': bytes(n.u.mem_read(unit+0x100, 0x80)).hex(),
                'positionSetterRva': n.q(n.q(unit)+0xa0)-n.base,
            })
            batches[-1]['count'] += 1
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'active': active,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:
        capture_batch()
    if sources != {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)}:
        raise ValueError('Native placement source changed during controls')
    if load_neutral_argument_proof(args.arguments)['inputs'] != source['inputs']:
        raise ValueError('Original argument inputs changed during native controls')
    output = {
        'schema': 1, 'kind': 'original-neutral-cold-world-placement',
        'build': source['build'], 'protocol': source['protocol'],
        'decoderImageSha256': sha(n.image), 'argumentProofSha256': sha(source_bytes),
        'argumentSources': [{'sha256': item['sha256'], 'replaySha256': item['proof']['replaySha256']}
                            for item in source['proofs']], 'cases': cases, 'boundary': boundary,
        'clientKind': args.client_kind,
        'controlBatches': batches,
        'inputs': inputs,
        'libcppSharedOwnershipCalls': shared_calls,
        'sourceBlocks': [{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])}
                         for start, end in ranges],
        'originalBlocks': list(blocks.values()),
        'sources': sources,
        'scope': {'originalColdClientConstructorExecuted': bool(cases),
                  'originalColdMinionClientConstructorExecuted': bool(cases) and args.client_kind != 'ai',
                  'originalMinionTypeRegistrationPoolAndAllocationExecuted': bool(cases) and factory is not None,
                  'originalRegistrationAndPositionPrefixExecuted': boundary is None,
                  'nativePositionExactlyMatchesRecordedFactoryPoint': boundary is None,
                  'recordedFactoryArgumentsUsed': True, 'controlWorldSupplied': True,
                  'independentColdControlBatches': True, 'crossMatchTransportOrderInvented': False,
                  'appearanceExecuted': False, 'fullFactoryExecuted': False,
                  'acceptedReplayEntities': False, 'nativeSpectatorEquivalent': False},
    }
    args.output.write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases), 'boundary': boundary}), flush=True)
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

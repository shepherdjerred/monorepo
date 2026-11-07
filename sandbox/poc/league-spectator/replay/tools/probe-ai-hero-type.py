"""Verify original hero allocation and its original client callback type route."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from character_script_native import NativeCharacterScripts
from libcpp_shared_native import NativeLibcppSharedOwnership
from native_ai_unit_fixture import NativeAIUnitFixture
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


class Control(NativeHeroStackProbe, NativeLibcppSharedOwnership, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    setup = {'audio': n.initialize_audio_facade(), 'ui': n.initialize_ui_data_prefix(),
             'product': initialize_product_configuration(n, 'LoL'),
             'types': initialize_hero_client_types(n)}
    world = n.allocate(0x268)
    n.u.mem_write(world + 0x168, b'\xa5' * 0x100)
    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
    if n.q(n.base + 0x24722c0) != world:
        raise ValueError('Original world registry did not publish its object')
    setup['world'] = {'object': world, 'constructorRva': 0x54a4d0}
    cases = []
    # Two independent factory allocations must retain the same class and each
    # cast must return its own object, not a cached pointer from the first case.
    for _ in range(2):
        n.call(0x17e080, {})
        unit = n.u.reg_read(r.UC_X86_REG_RAX)
        if (n.allocations.get(unit) != 0x49a0 or n.q(unit) != n.base + 0x22f9ac8 or
                any(case['unit'] == unit for case in cases)):
            raise ValueError('Original concrete hero factory allocation/class differs')
        cast = verify_hero_client_cast(n, unit)
        n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: unit})
        local_id = n.u32(unit + 0x20)
        if (not local_id or n.q(unit + 0xe8) != world or n.u32(unit + 0x78) or
                any(case['localId'] == local_id for case in cases)):
            raise ValueError('Original hero admission ownership/local identity differs')
        cases.append({'unit': unit, 'allocationBytes': n.allocations[unit], 'factoryRva': 0x17e080,
                      'constructorRva': 0x154c10, 'callbackTypeRoute': cast, 'localId': local_id,
                      'networkId': n.u32(unit + 0x78), 'worldAdmissionRva': 0x549f30})
    lookups = 0
    for case in cases + list(reversed(cases)):
        n.call(0x54b0a0, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: case['localId']})
        if n.u.reg_read(r.UC_X86_REG_RAX) != case['unit']:
            raise ValueError('Original local lookup did not retain its independently allocated hero')
        lookups += 1
    if (n.u32(world + 0x14) != len(cases) or
            bytes(n.u.mem_read(world + 0x168, 0x100)) != b'\xa5' * 0x100):
        raise ValueError('Original hero admission count/allocation guard differs')
    rejected_warm = False
    try:
        initialize_hero_client_types(n)
    except ValueError as error:
        if str(error) != 'Original hero/client runtime descriptors must be cold':
            raise
        rejected_warm = True
    if not rejected_warm:
        raise ValueError('Duplicate original type initialization was not rejected')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_hero_client_types)),
             Path(inspect.getfile(initialize_product_configuration)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'setup': setup, 'cases': cases,
              'duplicateInitializationRejected': rejected_warm, 'heroStackProbes': n.hero_stack_probes,
              'localLookupChecks': lookups,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalConcreteHeroFactory': True, 'originalHeroToClientCast': True,
                        'originalWorldAdmission': True,
                        'acceptedReplayEntities': False, 'networkAssignment': False,
                        'appearanceExecuted': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/ai-hero-type-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': cases,
                      'localLookupChecks': lookups,
                      'duplicateInitializationRejected': rejected_warm}))


if __name__ == '__main__':
    main()

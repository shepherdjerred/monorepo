"""Execute original startup and unit key/value dispatch on a cold concrete hero."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from archive_sized_arena_native import NativeArchiveSizedArena
from bounded_asset_arena_native import NativeBoundedAssetArena
from character_script_native import NativeCharacterScripts
from libcpp_shared_native import NativeLibcppSharedOwnership
from native_ai_unit_fixture import NativeAIUnitFixture
from navgrid_collision_native import NativeNavgridCollisionArena, initialize_navgrid_collision_provider
from navgrid_world_native import NativeNavgridStream, initialize_navgrid_world
from process_arguments_native import initialize_product_configuration
from unit_key_value_service_native import initialize_unit_key_value_service
from unit_category_module_native import initialize_unit_category_module
from vfx_spawn_native import sha


class Control(NativeNavgridCollisionArena, NativeArchiveSizedArena, NativeBoundedAssetArena,
              NativeNavgridStream, NativeHeroStackProbe, NativeLibcppSharedOwnership,
              NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    setup, controls, boundary = {}, [], None
    unit = None
    phase = 'setup'
    try:
        n.initialize_asset_arena(64)
        setup['unitCategoryModule'] = initialize_unit_category_module(n)
        setup['audio'] = n.initialize_audio_facade()
        setup['ui'] = n.initialize_ui_data_prefix()
        setup['product'] = initialize_product_configuration(n, 'LoL')
        setup['characterTypes'] = n.initialize_character_types()
        setup['heroTypes'] = initialize_hero_client_types(n, reuse_existing=True)
        setup['collisionProvider'] = initialize_navgrid_collision_provider(n)
        setup['navgrid'] = initialize_navgrid_world(fixture, setup['collisionProvider']['provider'])
        phase = 'service-startup'
        setup['service'] = initialize_unit_key_value_service(n)
        phase = 'hero-constructor'
        unit = n.allocate(0x4aa0)
        n.u.mem_write(unit + 0x49a0, b'\xa5' * 0x100)
        n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
        setup['heroCast'] = verify_hero_client_cast(n, unit)
        if n.q(unit + 0x39a8):
            raise ValueError('Cold unit control requires its original absent downstream component')
        phase = 'service-wrapper'
        def tree(header):
            root = n.q(unit + header + 8)
            result, pending, seen = {}, [root] if root else [], set()
            while pending:
                node = pending.pop()
                if node in seen or len(seen) >= 256 or n.allocations.get(node) != 0x28:
                    raise ValueError('Original unit key tree escaped unique owned bounded nodes')
                seen.add(node)
                key = n.u32(node + 0x1c)
                if key in result:
                    raise ValueError('Original unit key tree contains duplicate keys')
                result[key] = n.u32(node + 0x20)
                pending.extend(pointer for pointer in [n.q(node), n.q(node + 8)] if pointer)
            if len(result) != n.q(unit + header + 0x10):
                raise ValueError('Original unit key tree count differs')
            return result
        expected_current, expected_previous = tree(0x3978), tree(0x3990)
        for key, value in [(0xedf036d6, 0), (0xedf036d6, 3), (0xedf036d6, 7), (0x10203040, 9), (0xedf036d6, 0)]:
            if key == setup['service']['specialKey']:
                raise ValueError('Ordinary unit-tree control must not substitute special-key dependencies')
            before_current, before_previous = tree(0x3978), tree(0x3990)
            n.call(0x102ab0, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: key, r.UC_X86_REG_RDX: value})
            expected_previous[key] = expected_current.get(key, 0)
            expected_current[key] = value
            current, previous = tree(0x3978), tree(0x3990)
            if (current != expected_current or previous != expected_previous or
                    bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100):
                raise ValueError('Original wrapper current/previous unit tree mutation differs')
            controls.append({'key': key, 'value': value, 'currentBefore': before_current,
                             'previousBefore': before_previous, 'currentAfter': current, 'previousAfter': previous})
        phase = 'null-unit-original-guard'
        before = bytes(n.u.mem_read(setup['service']['object'], 0x48))
        n.call(0x102ab0, {r.UC_X86_REG_RDI: 0, r.UC_X86_REG_RSI: 0xedf036d6, r.UC_X86_REG_RDX: 0})
        if bytes(n.u.mem_read(setup['service']['object'], 0x48)) != before:
            raise ValueError('Original null-unit guard mutated its service')
    except Exception as error:
        boundary = {'phase': phase, 'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_' + name.upper()))
                                  for name in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
    functions = [initialize_unit_key_value_service, initialize_unit_category_module, initialize_product_configuration,
                 initialize_hero_client_types, verify_hero_client_cast]
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]],
             *[Path(inspect.getfile(f)) for f in functions]}
    output = fixture.cache / 'research/unit-key-value-service-native.json'
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'setup': setup, 'controls': controls,
              'unit': unit, 'boundary': boundary, 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalServiceStartupCompleted': 'service' in setup,
                        'originalConcreteHeroControl': 'heroCast' in setup,
                        'originalWrapperAndUnitTreesVerified': len(controls) == 5 and boundary is None,
                        'suppliedWrapperArguments': True,
                        'specialKeyCallbackPathVerified': False, 'downstreamUnitComponentAbsent': True,
                        'gameFieldsSupplied': False, 'serviceResultSubstituted': False,
                        'acceptedReplayEntity': False, 'mainViewerExpanded': False}}
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'service': setup.get('service'),
                      'controls': len(controls), 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

"""Construct an original concrete hero and trace its network-assignment boundary."""
import argparse
import inspect
import json
import runpy
from pathlib import Path
from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from ai_unit_manager_native import initialize_ai_unit_manager, initialize_ai_network_registry, initialize_actor_callback_service
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha
from libcpp_shared_native import NativeLibcppSharedOwnership
from champion_catalog_native import initialize_binary_resource_cache
from installed_resource_archive_native import register_resource_archive
from archive_subchunks_native import load_installed_subchunks
from startup_map_skin_native import recover_startup_map_skin
from linked_game_mode_native import initialize_linked_mode_provider
from mode_dependency_types_native import initialize_mode_dependency_types


class Control(NativeHeroStackProbe, NativeLibcppSharedOwnership, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('installation', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    report = fixture.read(fixture.cache / 'research/latest-semantics-effects.json')
    if report['build'] != n.profile['clientVersion'] or report['protocol'] != n.profile['protocolDigest']:
        raise ValueError('Exact-build recorded network identity required')
    hero = report['heroes'][0]
    setup, boundary = {}, None
    completed = {'constructor': False, 'worldAdmission': False, 'networkAssignment': False}
    unit = None
    controls = []
    lookup_checks = 0
    phase = 'setup'
    try:
        setup['audio'] = n.initialize_audio_facade()
        setup['ui'] = n.initialize_ui_data_prefix()
        setup['product'] = initialize_product_configuration(n, 'LoL')
        setup['characterTypes'] = n.initialize_character_types()
        setup['modeDependencyTypes'] = initialize_mode_dependency_types(n)
        setup['heroClientTypes'] = initialize_hero_client_types(n, reuse_existing=True)
        phase = 'hero-constructor'
        # The original factory 17e080 allocates precisely 49a0 and calls 154c10.
        unit = n.allocate(0x4aa0)
        n.u.mem_write(unit + 0x49a0, b'\xa5' * 0x100)
        n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
        if (n.q(unit) != n.base + 0x22f9ac8 or
                bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100):
            raise ValueError('Original hero constructor class or allocation guard differs')
        setup['heroClientTypeRoute'] = verify_hero_client_cast(n, unit)
        completed['constructor'] = True
        phase = 'world-admission'
        world = n.allocate(0x268)
        n.u.mem_write(world + 0x168, b'\xa5' * 0x100)
        n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
        n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: unit})
        if n.q(unit + 0xe8) != world or not n.u32(unit + 0x20):
            raise ValueError('Original hero world admission did not establish ownership/local identity')
        completed['worldAdmission'] = True
        phase = 'network-services'
        setup['recordedMapInput'] = recover_startup_map_skin(n, fixture.cache, fixture.root,
                                                          fixture.read, fixture.raw)
        map_observer = runpy.run_path(str(Path(__file__).with_name('observe-map-asset-links.py')))['observe_map_assets']
        setup['mapAssets'] = map_observer(fixture, setup['recordedMapInput']['variant'],
                                         additional_roots=[fixture.reference['selectedIdentity']])
        if (setup['mapAssets']['boundaries'] or not setup['mapAssets']['scope']['referenceLinksFixed'] or
                not setup['mapAssets']['mapSkinContext']['originalConstructorCompleted']):
            raise ValueError('Original hero callback requires the complete linked recorded-map control')
        setup['linkedModeProvider'] = initialize_linked_mode_provider(n, setup['mapAssets'], fixture.reference)
        setup['scriptVM'] = n.initialize_character_script_vm()
        setup['aiUnitManager'] = initialize_ai_unit_manager(n)
        setup['networkCallbackRegistry'] = initialize_ai_network_registry(n)
        setup['archive'] = register_resource_archive(fixture, args.installation, 'DATA.wad.client')
        archive_path = Path(setup['archive']['path'])
        setup['subchunks'] = load_installed_subchunks(fixture, args.installation, archive_path,
                                                     setup['archive']['archive'], fixture.raw(archive_path))
        setup['binaryResourceCache'] = initialize_binary_resource_cache(n)
        setup['actorCallbackService'] = initialize_actor_callback_service(n)
        phase = 'network-assignment'
        n.call(0x549580, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: hero['entityId']})
        n.call(0x548f00, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: hero['entityId']})
        if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
            raise ValueError('Original network lookup did not recover its concrete hero')
        completed['networkAssignment'] = True
        controls.append({'unit': unit, 'networkId': hero['entityId'], 'localId': n.u32(unit + 0x20),
                         'decodedCharacterLabel': hero['champion'], 'networkAssignmentCompleted': True})
        phase = 'additional-network-identities'
        heroes = report['heroes']
        if len(heroes) != 10 or len({value['entityId'] for value in heroes}) != 10:
            raise ValueError('Ten distinct decoded hero identities required for the world control')
        for additional in heroes[1:]:
            candidate = n.allocate(0x4aa0)
            n.u.mem_write(candidate + 0x49a0, b'\xa5' * 0x100)
            control = {'unit': candidate, 'networkId': additional['entityId'],
                       'decodedCharacterLabel': additional['champion'], 'networkAssignmentCompleted': False}
            controls.append(control)
            n.call(0x154c10, {r.UC_X86_REG_RDI: candidate})
            verify_hero_client_cast(n, candidate)
            n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: candidate})
            control['localId'] = n.u32(candidate + 0x20)
            n.call(0x548f00, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: additional['entityId']})
            if n.u.reg_read(r.UC_X86_REG_RAX) or n.u32(candidate + 0x78):
                raise ValueError('Additional hero identity was already assigned before its original setter')
            n.call(0x549580, {r.UC_X86_REG_RDI: candidate, r.UC_X86_REG_RSI: additional['entityId']})
            if n.u32(candidate + 0x78) != additional['entityId'] or n.q(candidate + 0xe8) != world:
                raise ValueError('Original additional hero network identity or ownership differs')
            control['networkAssignmentCompleted'] = True
        phase = 'retained-world-lookups'
        for control in controls + list(reversed(controls)):
            # 54b0d0 reads the separate tree at world+148. The recorded hero
            # consumer checks it before creation; it is not the active map at
            # world+40. Fresh controls must be absent from that secondary tree.
            for function, identity, expected in [(0x548f00, control['networkId'], control['unit']),
                                                  (0x54b0a0, control['localId'], control['unit']),
                                                  (0x54b0d0, control['networkId'], 0)]:
                n.call(function, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: identity})
                if n.u.reg_read(r.UC_X86_REG_RAX) != expected:
                    raise ValueError(f'Original world lookup {function:x} differs for identity {identity}')
                lookup_checks += 1
        if (n.u32(world + 0x14) != len(controls) or n.q(world + 0x48) != len(controls) or
                len({control['localId'] for control in controls}) != len(controls) or
                bytes(n.u.mem_read(world + 0x168, 0x100)) != b'\xa5' * 0x100):
            raise ValueError('Original multi-hero world counts, generation identities or guard differ')
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'phase': phase,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {key: n.u.reg_read(getattr(r, 'UC_X86_REG_' + key.upper()))
                                  for key in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
        boundary['stackHex'] = bytes(n.u.mem_read(boundary['registers']['rsp'], 128)).hex()
    if unit is not None and bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original hero escaped its guarded allocation')
    for control in controls:
        if bytes(n.u.mem_read(control['unit'] + 0x49a0, 0x100)) != b'\xa5' * 0x100:
            raise ValueError('Original additional hero escaped its guarded allocation')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_ai_unit_manager)), Path(inspect.getfile(initialize_product_configuration)),
             Path(inspect.getfile(initialize_hero_client_types)),
             Path(inspect.getfile(initialize_binary_resource_cache)),
             Path(inspect.getfile(register_resource_archive)), Path(inspect.getfile(load_installed_subchunks)),
             Path(inspect.getfile(recover_startup_map_skin)), Path(__file__).with_name('observe-map-asset-links.py'),
             Path(inspect.getfile(initialize_linked_mode_provider)),
             Path(inspect.getfile(initialize_mode_dependency_types)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'setup': setup, 'completed': completed, 'unit': unit, 'boundary': boundary,
              'recordedIdentityInput': hero['entityId'], 'heroStackProbes': n.hero_stack_probes,
              'identityControls': controls, 'retainedWorldLookupChecks': lookup_checks,
              'secondaryMapMissChecks': lookup_checks // 3,
              'networkVirtualSlotAc8': n.q(n.q(unit) + 0xac8) - n.base if unit is not None else None,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'concreteHeroConstructor': completed['constructor'], 'suppliedNetworkId': True,
                        'originalReplayCreationHandler': False, 'acceptedReplayEntity': False,
                        'appearanceExecuted': False, 'matchCoverage': False}}
    output = fixture.cache / 'research/ai-hero-construction-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'completed': completed,
                      'networkIdentitiesCompleted': sum(value['networkAssignmentCompleted'] for value in controls),
                      'retainedWorldLookupChecks': lookup_checks, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

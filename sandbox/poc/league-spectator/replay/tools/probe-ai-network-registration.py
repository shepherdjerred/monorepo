"""Compare original AI network/local lookup over supplied recorded hero IDs."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from ai_world_registration_native import register_control
from ai_network_registration_native import assign_network_control
from ai_unit_manager_native import initialize_ai_unit_manager, initialize_ai_network_registry
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, NativeCharacterScripts)
    n = fixture.native
    report = fixture.read(fixture.cache / 'research/latest-semantics-effects.json')
    if report['build'] != n.profile['clientVersion'] or report['protocol'] != n.profile['protocolDigest']:
        raise ValueError('Exact-build recorded hero input required')
    heroes = report['heroes']
    if len(heroes) != 10 or len({h['entityId'] for h in heroes}) != 10:
        raise ValueError('Ten distinct recorded hero identities required for this control')
    n.initialize_audio_facade()
    n.initialize_ui_data_prefix()
    product = initialize_product_configuration(n, 'LoL')
    script_vm = n.initialize_character_script_vm()
    manager = initialize_ai_unit_manager(n)
    callback_registry = initialize_ai_network_registry(n)
    world = n.allocate(0x268)
    n.u.mem_write(world + 0x168, b'\xa5' * 0x100)
    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
    cases = []
    boundary = None
    for hero in heroes:
        unit = n.allocate(0x4100)
        n.u.mem_write(unit + 0x4000, b'\xa5' * 0x100)
        n.call(0xea3c0, {r.UC_X86_REG_RDI: unit})
        local = register_control(n, world, unit)
        try:
            assigned = assign_network_control(n, world, unit, hero['entityId'])
        except Exception as error:
            boundary = {'kind': type(error).__name__, 'message': str(error), 'unit': unit,
                        'recordedNetworkId': hero['entityId'], 'recordedCharacter': hero['champion'],
                        'originalVirtualCallbackRva': n.q(n.q(unit) + 0x1c8) - n.base,
                        'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                        'registers': {key: n.u.reg_read(getattr(r, 'UC_X86_REG_' + key.upper()))
                                      for key in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
            boundary['stackHex'] = bytes(n.u.mem_read(boundary['registers']['rsp'], 128)).hex()
            break
        fixture.check_guard(unit)
        cases.append({'recordedCharacter': hero['champion'], 'local': local, 'network': assigned})
    lookups = 0
    for case in (cases + list(reversed(cases)) if boundary is None else []):
        expected = case['network']
        for function, identity in [(0x548f00, expected['networkId']), (0x54b0a0, expected['localId'])]:
            n.call(function, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: identity})
            if n.u.reg_read(r.UC_X86_REG_RAX) != expected['unit']:
                raise ValueError('Original AI world lookup disagreed after additional assignments')
            lookups += 1
    if bytes(n.u.mem_read(world + 0x168, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Network assignment escaped its owned world allocation')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)), Path(inspect.getfile(register_control)),
             Path(inspect.getfile(assign_network_control)),
             Path(inspect.getfile(initialize_ai_unit_manager)),
             Path(inspect.getfile(initialize_product_configuration)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'cases': cases, 'boundary': boundary, 'aiUnitManager': manager,
              'product': product,
              'scriptVM': script_vm,
              'networkCallbackRegistry': callback_registry,
              'lookupsCompared': lookups, 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalAIClientConstructors': True, 'originalLocalAndNetworkAssignment': boundary is None,
                        'suppliedRecordedNetworkIds': True, 'originalReplayCreationHandler': False,
                        'acceptedReplayEntities': False, 'appearanceExecuted': False, 'matchCoverage': False}}
    output = fixture.cache / 'research/ai-network-registration-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'units': len(cases), 'lookupsCompared': lookups, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

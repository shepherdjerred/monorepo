"""Original concrete-Hero root attachment provider on supplied cold controls."""
import argparse
import inspect
import json
import struct
from pathlib import Path

from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from character_script_native import NativeCharacterScripts
from libcpp_shared_native import NativeLibcppSharedOwnership
from native_ai_unit_fixture import NativeAIUnitFixture
from process_arguments_native import initialize_product_configuration
from mode_dependency_types_native import initialize_mode_dependency_types
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
    setup = {
        'audio': n.initialize_audio_facade(),
        'ui': n.initialize_ui_data_prefix(),
        'product': initialize_product_configuration(n, 'LoL'),
        'characterTypes': n.initialize_character_types(),
        'modeTypes': initialize_mode_dependency_types(n),
        'heroTypes': initialize_hero_client_types(n, reuse_existing=True),
    }
    unit = n.allocate(0x4aa0)
    n.u.mem_write(unit + 0x49a0, b'\xa5' * 0x100)
    n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
    setup['heroCast'] = verify_hero_client_cast(n, unit)
    if n.q(unit) != n.base + 0x22f9ac8 or n.q(n.q(unit) + 0x68) != n.base + 0x111160:
        raise ValueError('Original concrete-Hero root getter differs')
    world = n.allocate(0x168)
    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
    shared, output = n.allocate(16), n.allocate(32)
    n.call(0x54f630, {r.UC_X86_REG_RDI: shared, r.UC_X86_REG_RSI: unit, r.UC_X86_REG_RDX: 0})
    provider = n.q(shared)
    if n.allocations.get(provider) != 0x40 or n.q(provider) != n.base + 0x2336b28 or n.u32(provider + 0x30):
        raise ValueError('Original source provider factory did not choose AI-client key-zero provider')
    n.call(0x54e420, {r.UC_X86_REG_RDI: provider})
    component = n.u.reg_read(r.UC_X86_REG_RAX)
    if component:
        raise ValueError('Cold Hero unexpectedly already publishes an animation component')
    table_getter = n.q(n.q(unit + 0x10) + 0x10) - n.base
    n.call(table_getter, {r.UC_X86_REG_RDI: unit + 0x10})
    component_table = n.u.reg_read(r.UC_X86_REG_RAX)
    table_count = n.u32(component_table + 8)
    if table_count > 128:
        raise ValueError('Cold Hero component table exceeds bounded observation')
    component_lookup = {'getterRva': table_getter, 'container': component_table,
                        'count': table_count, 'records': []}
    records = n.q(component_table)
    for index in range(table_count):
        address = records + index * 32
        component_lookup['records'].append({'bytesHex': bytes(n.u.mem_read(address, 32)).hex()})
    initial = {'rootOverrideBits': n.u32(unit + 0x3ba0), 'proxyNetworkId': n.u32(unit + 0xb38),
               'component': component, 'componentOwner': None}
    if initial['rootOverrideBits'] != 0x7f7fffff or initial['proxyNetworkId'] != 0:
        raise ValueError('Original cold Hero root selection defaults differ')
    cases = []
    for position, direction, override in [
        ([900.25, -106, 1200.5], [1, 0, 0], None),
        ([8010.125, 4, 999.25], [0, 0, -1], [17.25, 28.5, -39.75]),
        ([-100.5, 0.125, 1000], [1 / 3, 0, -1 / 7], None),
    ]:
        n.put(unit + 0x15c, '3f', *position)
        n.put(unit + 0x58, '3f', *direction)
        if override is None:
            n.call(0x1111e0, {r.UC_X86_REG_RDI: unit})
        else:
            n.put(output, '3f', *override)
            n.call(0x1111c0, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: output})
        n.call(0x111160, {r.UC_X86_REG_RDI: unit})
        root = n.u.reg_read(r.UC_X86_REG_RAX)
        expected_root = unit + (0x15c if override is None else 0x3ba0)
        if root != expected_root:
            raise ValueError('Original Hero root getter selected an unexpected source')
        expected = struct.pack('<3f', *(position if override is None else override))
        root_result = bytes(n.u.mem_read(root, 12))
        if root_result != expected:
            raise ValueError('Original concrete Hero root-position result differs')
        n.u.mem_write(output, b'\xa5' * 32)
        n.call(0x54e2c0, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: output})
        position_success = n.u.reg_read(r.UC_X86_REG_RAX) & 255
        if position_success or bytes(n.u.mem_read(output, 32)) != b'\xa5' * 32:
            raise ValueError('Original cold source position provider must fail without writing output')
        n.call(0x54def0, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: output})
        actual_direction = bytes(n.u.mem_read(output, 12))
        if n.u.reg_read(r.UC_X86_REG_RAX) & 255 != 1 or actual_direction != struct.pack('<3f', *direction):
            raise ValueError('Original source direction provider differs')
        if bytes(n.u.mem_read(output + 12, 20)) != b'\xa5' * 20:
            raise ValueError('Original source provider escaped its output')
        cases.append({'position': position, 'direction': direction, 'override': override,
                      'rootSourceOffset': expected_root-unit, 'positionHex': root_result.hex(),
                      'providerPositionResolved': False, 'directionHex': actual_direction.hex()})
    if bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original Hero/provider escaped its owned unit')
    sources = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
               Path(inspect.getfile(initialize_hero_client_types)),
               Path(inspect.getfile(initialize_product_configuration)),
               Path(inspect.getfile(initialize_mode_dependency_types)),
               *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    ranges = [(0x111160, 0x1111f0), (0x18df40, 0x18df87), (0x54f630, 0x54f91f),
              (0x54e420, 0x54e537), (0x54e2c0, 0x54e301), (0x54def0, 0x54df79)]
    result = {'schema': 1, 'kind': 'original-concrete-hero-root-attachment-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'setup': setup, 'initial': initial, 'cases': cases,
              'componentLookup': component_lookup,
              'inputs': fixture.inputs, 'sources': {str(p.resolve()): sha(p.read_bytes()) for p in sorted(sources)},
              'sourceBlocks': [{'rva': a, 'size': b-a, 'sha256': sha(n.image[a:b])} for a, b in ranges],
              'scope': {'fullOriginalConcreteHeroConstructor': True, 'originalSourceProviderFactory': True,
                        'originalAnimationComponentLookupExecuted': True,
                        'coldAnimationComponentMissing': True, 'originalHeroRootGetter': True,
                        'originalRootOverrideSetterAndReset': True, 'originalDirectionProvider': True,
                        'coldZeroProxyHandleOnly': True, 'nonzeroProxyHandleResolved': False,
                        'suppliedWorldPoseControls': True, 'matchTransformsRecovered': False,
                        'compilerAdmissionChanged': False, 'mainViewerExpanded': False}}
    output_path = fixture.cache / 'research/hero-root-attachment-native.json'
    output_path.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output_path), 'cases': len(cases), 'provider': provider, 'component': component}))


if __name__ == '__main__':
    main()

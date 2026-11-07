"""Bounded original target-predicate controls with explicit constructor views.

The replay's group4/index0 base flags have a proven schema binding. This does
not recover live linked owners, optional providers or native target acceptance.
"""
import argparse
import inspect
import json
import struct
import unicorn
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    schema = fixture.read(fixture.cache / 'public/latest-champion-state/package.json')
    group = schema['groups']['4']
    if (schema['build'] != n.profile['clientVersion'] or schema['protocol'] != n.profile['protocolDigest'] or
            schema['decoderImageSha256'] != sha(n.image) or group['offsets'][0] != 0xc50 or
            group['floatMask'] & 1 or group['symbols'][0] != 'baa79226e054b50a'):
        raise ValueError('Exact original base flag replication binding differs')
    for block in schema['sourceBlocks']:
        if sha(n.image[block['startRva']:block['endRva']]) != block['sha256']:
            raise ValueError('Original base flag registration evidence changed')
    unit = fixture.construct_ai()
    world = n.allocate(0x268)
    n.u.mem_write(world + 0x168, b'\xa5' * 0x100)
    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
    n.put(unit + 0x78, 'I', 0x4000003d)
    n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: unit})
    config = n.allocate(0x1c0)
    n.call(0x624060, {r.UC_X86_REG_RDI: config})
    text, string, reference = n.allocate(128), n.allocate(24), n.allocate(8)
    supplied_path = b'predicate-control.rofl'
    n.u.mem_write(text, supplied_path + b'\0')
    n.call(0x11fe0, {r.UC_X86_REG_RDI: string, r.UC_X86_REG_RSI: text,
                     r.UC_X86_REG_RDX: len(supplied_path)})
    n.put(reference, 'Q', string)
    fixture.run_to(0x624540, 0x6248c6,
                   {r.UC_X86_REG_RDI: config, r.UC_X86_REG_RDX: reference})
    fixture.run_to(0xf03dfa, 0xf03e17, {})
    if n.u32(config + 8) != 3 or bytes(n.u.mem_read(n.base + 0x255cc88, 1)) != b'\0':
        raise ValueError('Original supplied ROFL/disabled-view policy input differs')
    preconditions = {'linkedNetworkIdB38': n.u32(unit + 0xb38),
                     'baseFlagsC50': n.u32(unit + 0xc50),
                     'externalFlagsProviderC68': n.q(unit + 0xc68),
                     'localPlayer2562970': n.q(n.base + 0x2562970),
                     'bypass2562969': bytes(n.u.mem_read(n.base + 0x2562969, 1))[0],
                     'encodedSpecialTarget3730': n.q(unit + 0x3730),
                     'byte38cd': bytes(n.u.mem_read(unit + 0x38cd, 1))[0]}
    if any(preconditions[key] for key in ['linkedNetworkIdB38', 'externalFlagsProviderC68',
                                        'localPlayer2562970', 'bypass2562969', 'byte38cd']):
        raise ValueError('Constructor target-predicate branch preconditions differ')
    if preconditions['encodedSpecialTarget3730'] != 0xf3644af53fffffff:
        raise ValueError('Original special target component null encoding differs')
    if preconditions['baseFlagsC50'] != 0xf:
        raise ValueError('Original constructor base flags differ')
    radius_tables = []
    for table in [0x22ec2d0, 0x22ef3d0, 0x22f80e0]:
        slot = n.image[table + 0x5c0:table + 0x5c8]
        if slot != n.source.image[table + 0x5c0:table + 0x5c8] or struct.unpack('<Q', slot)[0] != n.base + 0xd2240:
            raise ValueError('Original AI-client target radius virtual differs')
        radius_tables.append({'vtableRva': table, 'slot': 0x5c0, 'targetRva': 0xd2240, 'sha256': sha(slot)})
    special = n.allocate(0x20)
    n.call(0x1f7020, {r.UC_X86_REG_RDI: special, r.UC_X86_REG_RSI: unit})
    if n.q(special + 0x10) != unit or n.q(special + 0x18) != 0:
        raise ValueError('Original typed special target component constructor differs')
    mask64 = (1 << 64) - 1
    rol = lambda value, bits: ((value << bits) | (value >> (64 - bits))) & mask64
    encoded_special = rol((rol(special, 52) - 0x326ed42c) & mask64, 30)
    special_query_calls = []
    n.u.hook_add(unicorn.UC_HOOK_CODE,
                 lambda engine, address, size, user: special_query_calls.append(address - n.base),
                 begin=n.base + 0x1f7090, end=n.base + 0x1f7090)
    rows = []
    for variant in ['null', 'typed-nonnull-inactive', 'typed-nonnull-active-all-bits']:
      n.put(unit + 0x3730, 'Q', preconditions['encodedSpecialTarget3730'] if variant == 'null' else encoded_special)
      n.put(special + 0x18, 'II', 0xffffffff if variant.endswith('all-bits') else 0,
            0xffffffff if variant.endswith('all-bits') else 0)
      for initialized in [0, 1]:
        n.put(unit + 0x201, 'B', initialized)
        for flags in [0, 1, 0x20000, 0x20000000, 0x20020000, 0x80000000, 0xffffffff]:
            n.put(unit + 0xc50, 'I', flags)
            getters = {}
            for key, entry, bit in [('flagBit17', 0x6e860, 17), ('flagBit29', 0x6e350, 29)]:
                n.call(entry, {r.UC_X86_REG_RDI: unit + 0xc20})
                getters[key] = n.u.reg_read(r.UC_X86_REG_RAX) & 255
                if getters[key] != ((flags >> bit) & 1):
                    raise ValueError('Original constructor-view base flag getter differs')
            n.call(0xc9090, {r.UC_X86_REG_RDI: unit})
            accepted = n.u.reg_read(r.UC_X86_REG_RAX) & 255
            if accepted != int(bool(initialized) and not bool(flags & 0x20000)):
                raise ValueError('Original constructor-view target predicate differs')
            rows.append({'specialTargetComponent': variant,
                         'suppliedInitializedByte201': initialized, 'suppliedBaseFlagsC50': flags,
                         **getters, 'originalTargetPredicate': accepted,
                         'nativeAcceptedInternalId': None, 'actualNativeAcceptance': None})
    if special_query_calls:
        raise ValueError('No-local-player target predicate unexpectedly consumed cross-team special state')
    fixture.check_guard(unit)
    if bytes(n.u.mem_read(world + 0x168, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original target-predicate world escaped its owned allocation')
    blocks, md = [], Cs(CS_ARCH_X86, CS_MODE_64)
    for label, start, end in [
            ('full-target-predicate', 0xc9090, 0xc9206),
            ('original-constructor-base-flags-and-provider-defaults', 0x6de60, 0x6deef),
            ('original-zero-target-query-radius', 0xd2240, 0xd2249),
            ('target-predicate-character-state-query', 0xc8fa0, 0xc9070),
            ('target-predicate-special-target-query', 0xc1be0, 0xc1c1d),
            ('base-flags-bit29-provider-query', 0x6e350, 0x6e38d),
            ('base-flags-bit17-provider-query', 0x6e860, 0x6e89c),
            ('optional-flags-provider-feature-gate', 0x1d2010, 0x1d208d),
            ('optional-flags-provider-registration-feature-gate', 0x1d1f70, 0x1d1ff6),
            ('original-base-flags-and-optional-provider-registration', 0x6e9c0, 0x6ea61),
            ('linked-network-owner-query', 0x18df40, 0x18df87),
            ('special-target-bit-query', 0x1f7090, 0x1f70c6),
            ('original-typed-special-target-component-constructor', 0x1f7020, 0x1f704d),
            ('original-no-special-config-query', 0x625420, 0x625428)]:
        raw = n.image[start:end]
        instructions = list(md.disasm(raw, start))
        if raw != n.source.image[start:end] or sum(i.size for i in instructions) != len(raw):
            raise ValueError('Original target predicate instruction boundary differs')
        blocks.append({'label': label, 'rva': start, 'bytes': len(raw), 'sha256': sha(raw),
                       'instructions': [{'rva': i.address, 'mnemonic': i.mnemonic, 'operands': i.op_str} for i in instructions]})
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'original-target-predicate-constructor-view-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'blocks': blocks, 'preconditions': preconditions, 'controls': rows, 'radiusVirtualTables': radius_tables,
              'typedSpecialTargetComponent': {'vtableRva': n.q(special) - n.base,
                                              'originalConstructorRva': 0x1f7020,
                                              'specialGetterCallsAcrossAllControls': len(special_query_calls)},
              'replicationBinding': {'group': 4, 'index': 0, 'offset': 0xc50, 'type': 'uint32',
                                     'symbol': group['symbols'][0]},
              'scope': {'fullOriginalTargetPredicateExecuted': True, 'originalRoFLLaunchPrefix': True,
                        'originalDisabledViewPrefix': True, 'baseFlagsAndInitializationExplicitlySupplied': True,
                        'externalFlagsProviderAbsent': True, 'linkedOwnerAbsent': True,
                        'localPlayerAbsent': True, 'bypassFlagUnchanged': True,
                        'actualRecordedFlagsAppliedHere': False, 'actualNativeTargetAcceptanceRecovered': False,
                        'actualProjectileAdmissionExpanded': False}}
    output = fixture.cache / 'research/missile-target-gates-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(rows), 'blocks': len(blocks),
                      'replicationBinding': result['replicationBinding'], 'preconditions': preconditions,
                      'scope': result['scope']}))


if __name__ == '__main__':
    main()

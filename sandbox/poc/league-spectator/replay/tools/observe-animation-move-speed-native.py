"""Compare recorded raw stats through original concrete hero animation updater.

The original replication reader, raw-to-cache refresh and complete MoveSpeed
updater execute. Their observation ordering is explicit; the native game frame
scheduler and live external attribute providers remain unadmitted.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from animation_provider_native import NativeAnimationProvider, create_animation_provider_fixture, construct_animation_hero
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from ai_material_owner_type_native import initialize_ai_material_owner_type
from character_graph_snapshot import restore
from mode_dependency_types_native import initialize_mode_dependency_types
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--snapshot-bindings', type=Path)
    args = parser.parse_args()
    encoded = args.input.read_bytes()
    request = json.loads(encoded)
    root = Path(__file__).resolve().parent
    paths = {Path(__file__), root/'prepare-animation-move-speed-input.mjs',
             *[Path(inspect.getfile(function)) for function in [create_animation_provider_fixture,
                construct_animation_hero, initialize_hero_client_types, verify_hero_client_cast,
                initialize_ai_material_owner_type, restore, initialize_mode_dependency_types,
                initialize_product_configuration]],
             *[Path(inspect.getfile(klass)) for klass in NativeAnimationProvider.__mro__ if klass is not object]}
    sources = {str(file.resolve()): sha(file.read_bytes()) for file in paths}
    if (request['kind'] != 'derived-original-animation-move-speed-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['preparerSha256'] != sha((root/'prepare-animation-move-speed-input.mjs').read_bytes()) or
            len(set(request['heroIds'])) != 10 or not 0 < len(request['records']) <= 1000000):
        raise ValueError('Exact bounded original MoveSpeed validation input required')
    for file, identity in request['inputs'].items():
        data = Path(file).read_bytes()
        if len(data) != identity['bytes'] or sha(data) != identity['sha256']:
            raise ValueError('MoveSpeed source input changed: '+file)
    bindings_bytes = args.snapshot_bindings.read_bytes() if args.snapshot_bindings else None
    bindings = json.loads(bindings_bytes) if bindings_bytes else None
    fixture = create_animation_provider_fixture(args.cache, args.client, bindings)
    if bindings_bytes is not None:
        fixture.inputs[str(args.snapshot_bindings.resolve())] = sha(bindings_bytes)
    n = fixture.native
    if sha(n.image) != request['decoderImageSha256']:
        raise ValueError('Original MoveSpeed decoder image differs')
    package = json.loads((args.cache/'public/latest-combat-stats/package.json').read_bytes())
    schema = json.loads((args.cache/'public/latest-champion-state/package.json').read_bytes())
    if sha((args.cache/'public/latest-combat-stats/package.json').read_bytes()) != request['combatStatPackageSha256']:
        raise ValueError('Original combat-stat program identity differs')
    units = {entity: construct_animation_hero(fixture) for entity in request['heroIds']}
    # Match the existing exact champion-schema control: optional observer
    # configuration is explicitly cached false; no observer callbacks are added.
    n.put(n.base+0x255b7d0, 'I', 1)
    first_unit = units[request['heroIds'][0]]
    n.call(0x13e690, {r.UC_X86_REG_RDI: first_unit})
    replicator = n.q(first_unit+0x2400)
    descriptor = n.q(replicator+8+5*8)
    if bytes(n.u.mem_read(descriptor, 0x198)).hex() != schema['groups']['32']['descriptorHex']:
        raise ValueError('Original concrete hero replication registration differs')
    if max(schema['groups']['32']['offsets'])+4 > 0x49a0:
        raise ValueError('Original hero group escaped its concrete extent')
    source, slot, output = n.allocate(4096), n.allocate(8), n.allocate(16)
    n.put(slot, 'Q', descriptor)
    samples, first, known, checked, unavailable, active, boundary = [], {}, set(), 0, 0, None, None
    try:
        for record in request['records']:
            active = {key: record[key] for key in ['entityId', 'time', 'transportSequence', 'recordIndex']}
            unit = units[record['entityId']]
            for group in record['groups']:
                data = bytes.fromhex(group['dataHex'])
                if group['group'] != 32 or len(data) > 4080:
                    raise ValueError('Bounded original full stat group required')
                n.u.mem_write(source, data+bytes(16))
                n.call(0x1db4e0, {r.UC_X86_REG_RDI: slot, r.UC_X86_REG_RSI: unit,
                                  r.UC_X86_REG_RDX: group['mask'], r.UC_X86_REG_RCX: source})
                if n.u.reg_read(r.UC_X86_REG_RAX) != len(data):
                    raise ValueError('Original stat group consumption differs')
            if n.q(unit+0x17b8):
                raise ValueError('Unexpected external raw MoveSpeed attribute provider')
            n.call(0x69150, {r.UC_X86_REG_RDI: unit+0x1340, r.UC_X86_REG_RSI: unit+0xd10})
            n.put(output+8, 'I', 0x7fc00000)
            n.call(0x1176f0, {r.UC_X86_REG_RSI: unit+8, r.UC_X86_REG_RDX: output})
            bits = n.u32(output+8)
            if bits != n.u32(unit+0xf9c):
                raise ValueError('Complete original updater differs from native cache')
            if record['moveSpeedWritten']:
                known.add(record['entityId'])
                first.setdefault(str(record['entityId']), {key: record[key] for key in
                    ['time', 'transportSequence', 'recordIndex', 'expectedBits']})
            if record['expectedBits'] is None:
                if record['entityId'] in known:
                    raise ValueError('Known observed stat became unavailable')
                unavailable += 1
            elif record['entityId'] not in known or bits != record['expectedBits']:
                raise ValueError('Recorded native MoveSpeed provider bits differ')
            else:
                checked += 1
            if bytes(n.u.mem_read(unit+0x49a0, 0x100)) != b'\xa5'*0x100:
                raise ValueError('Original stat/updater path escaped hero extent')
            samples.append({**active, 'bits': bits if record['expectedBits'] is not None else None})
    except Exception as error:
        boundary = {'record': active, 'error': str(error), 'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    for file, digest in sources.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('MoveSpeed native source changed during observation: '+file)
    for file, digest in fixture.inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('MoveSpeed native input changed during observation: '+file)
    for file, identity in request['inputs'].items():
        if sha(Path(file).read_bytes()) != identity['sha256']:
            raise ValueError('MoveSpeed replay input changed during observation: '+file)
    result = {'schema': 1, 'kind': 'original-concrete-hero-animation-move-speed-observations',
              'build': request['build'], 'protocol': request['protocol'],
              'decoderImageSha256': sha(n.image), 'inputSha256': sha(encoded),
              'inputs': {**fixture.inputs, **{file: identity['sha256'] for file, identity in request['inputs'].items()}},
              'sources': sources,
              'setup': fixture.animation_provider_setup, 'heroCount': len(units),
              'concreteHeroType': {'descriptorRva': 0x24913e0, 'typeHash': 0xe260302c,
                'bytes': 0x49a0, 'constructorRva': 0x154c10, 'animationOwnerOffset': 8,
                'updaterRva': 0x1176f0, 'rawStatOffset': 0x17a0, 'cacheOffset': 0xf9c},
              'firstObserved': first, 'samples': samples, 'checked': checked, 'unavailable': unavailable,
              'boundary': boundary, 'originalBlocks': list(n.blocks.values()),
              'scope': {'completeConcreteHeroConstructorsExecuted': True, 'originalOwnerRttiCastExecuted': True,
                'originalReplicationAndCacheRefreshExecuted': True, 'completeOriginalUpdaterExecuted': True,
                'beforeFirstObservation': 'unavailable', 'nativeFrameSchedulingEstablished': False,
                'liveExternalAttributeProvidersEstablished': False, 'acceptedReplayEntities': False,
                'nativeGraphInputsAdmitted': False}}
    args.output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'checked': checked, 'unavailable': unavailable, 'heroes': len(units), 'boundary': boundary}))
    if boundary is not None:
        raise ValueError('Original MoveSpeed provider control stopped at an explicit boundary')


if __name__ == '__main__':
    main()

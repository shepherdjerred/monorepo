"""Read archived CharacterRecord scalars with original typed native consumers.

Only replication-class selection, overhead height and corpse lifetime are
observed. Appearance, full character loading, clocks and replay admission are
outside this component.
"""
import argparse
import inspect
import json
import math
import struct
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from libcpp_shared_native import NativeLibcppSharedOwnership
from vfx_spawn_native import sha, name_hash


class NativeWorldRecords(NativeLibcppSharedOwnership, NativeCharacterAssets):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'reference', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    input_bytes, reference_bytes = args.input.read_bytes(), args.reference.read_bytes()
    request, reference = json.loads(input_bytes), json.loads(reference_bytes)
    root = Path(__file__).resolve().parent
    if (request['kind'] != 'original-native-world-character-record-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['preparerSha256'] != sha((root/'prepare-native-world-records-input.mjs').read_bytes()) or
            request['readerSha256'] != sha((root/'exact-map-bin.mjs').read_bytes()) or
            request['manifest']['sha256'] != sha(Path(request['manifest']['file']).read_bytes()) or
            not 0 < len(request['roots']) <= 2048 or
            sha(reference_bytes) != '8c87ff65515392c77743b579e5c9647e072d39a9948fb38a23b84d45d971d922'):
        raise ValueError('Exact original field input and approved Map11 native schema required')
    n = NativeWorldRecords(args.cache/'public/decoder-16.21-macos', args.client)
    n.initialize_character_types()
    if reference['decoderImageSha256'] != sha(n.image):
        raise ValueError('Original world schema image differs')
    for block in reference['sourceBlocks']:
        if sha(n.image[block['startRva']:block['endRva']]) != block['sha256']:
            raise ValueError('Approved world schema instruction bytes differ')
    properties = n.catalog()['%08x' % name_hash('CharacterRecord')]['properties']
    expected = {'minionFlags': 0x64, 'healthBarHeight': 0xc0, 'deathTime': 0x474}
    for name, offset in expected.items():
        matches = [field for field in properties if field['hash'] == name_hash(name)]
        if len(matches) != 1 or matches[0]['offset'] != offset:
            raise ValueError('Original CharacterRecord scalar registration differs: '+name)
    if n.q(n.base+0x246c950):
        raise ValueError('Original minion lifetime defaults must be cold')
    manager = n.allocate(0x78)
    n.call(0x18ae90, {r.UC_X86_REG_RDI: manager})
    entity, wrapper = n.allocate(0x5000), n.allocate(0x180)
    n.put(entity, 'Q', n.base+0x23013b8)
    n.put(entity+0x3598, 'Q', wrapper)
    n.u.mem_write(n.base+0x255b7d0, b'\x01\x00\x00\x00')
    cases, boundary, active = [], None, None
    try:
        for item in request['roots']:
            active = {'key': item['key']}
            raw = Path(item['source']['file']).read_bytes()
            if len(raw) != item['source']['bytes'] or sha(raw) != item['source']['sha256']:
                raise ValueError('Original CharacterRecord source changed')
            fields = []
            for span in item['fields']:
                start, size = span['offset'], span['bytes']
                if start < 0 or size < 5 or start+size > len(raw):
                    raise ValueError('Original CharacterRecord field escaped source')
                field = raw[start:start+size]
                if sha(field) != span['sha256'] or field[:4].hex() != bytes.fromhex(span['fieldHash'])[::-1].hex():
                    raise ValueError('Original CharacterRecord field digest/hash differs')
                fields.append(field)
            if int(item['typeHash'], 16) != name_hash('CharacterRecord'):
                raise ValueError('Original CharacterRecord class required')
            observed = n.observe_actor_fields(name_hash('CharacterRecord'), fields)
            if observed['originalSkippedFields'] or observed['pendingReferences']:
                raise ValueError('Selected original CharacterRecord scalars were not fully read')
            record = observed['object']
            flags = n.u32(record+0x64)
            height, death = [struct.unpack('<f', n.u.mem_read(record+at, 4))[0] for at in [0xc0, 0x474]]
            if not math.isfinite(height) or not 0 < height < 10000 or not math.isfinite(death):
                raise ValueError('Native CharacterRecord height/lifetime is invalid')
            n.put(wrapper+0x28, 'Q', record)
            n.call(0x187190, {r.UC_X86_REG_RDI: entity})
            replicator = n.q(entity+0x2400)
            schema_key = 'minion-bit8' if flags & 8 else 'minion'
            schema = reference['classes'][schema_key]
            for index, group in enumerate([1, 2, 4, 8, 16, 32, 64]):
                descriptor = n.q(replicator+8+index*8)
                expected_bytes = bytes.fromhex(schema['groups'][str(group)]['descriptorHex'])
                if bytes(n.u.mem_read(descriptor, len(expected_bytes))) != expected_bytes:
                    raise ValueError('Original actor replication registration differs from approved native class')
            n.call(0x1897d0, {r.UC_X86_REG_RDI: entity})
            duration_bits = n.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff
            duration = struct.unpack('<f', struct.pack('<I', duration_bits))[0]
            if duration != (4.0 if death < 0 else death):
                raise ValueError('Original actor corpse lifetime differs from its loaded CharacterRecord')
            cases.append({key: item[key] for key in ['key', 'character', 'resourceSkinId', 'reference', 'source']} | {
                'loaded': observed, 'minionFlags': flags, 'replicationSchema': schema_key,
                'healthBarHeight': height, 'deathTime': death,
                'corpseDuration': duration, 'corpseDurationBits': duration_bits,
            })
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'active': active,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    result = {
        'schema': 1, 'kind': 'original-world-character-record-consumers',
        'build': request['build'], 'protocol': request['protocol'], 'decoderImageSha256': sha(n.image),
        'inputSha256': sha(input_bytes), 'schemaReferenceSha256': sha(reference_bytes),
        'libcppSharedOwnershipCalls': n.shared_calls,
        'cases': cases, 'boundary': boundary, 'originalBlocks': list(n.blocks.values()),
        'sources': {str(file.resolve()): sha(file.read_bytes()) for file in sorted(paths)},
        'scope': {'selectedOriginalScalarFieldsRead': boundary is None,
                  'originalReplicationRegistrationCompared': boundary is None,
                  'originalCorpseLifetimeGetterExecuted': boundary is None,
                  'completeCharacterLoaded': False, 'nativeFactoryAccepted': False,
                  'nativeLiveClockBindingVerified': False, 'renderedActors': False},
    }
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases), 'boundary': boundary}), flush=True)
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

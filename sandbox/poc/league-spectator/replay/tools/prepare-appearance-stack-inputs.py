"""Recover original appearance push/pop/clear/copy field codecs.

This prepares build-specific field tables, not appearance state or asset choices.
"""
import argparse
import inspect
import json
from pathlib import Path
from appearance_stack_native import NativeAppearanceStackInputs, SPECS, BOOLEANS
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def read(path):
        b = path.read_bytes()
        inputs[str(path.resolve())] = sha(b)
        return json.loads(b)

    samples = read(cache/'research/structural-corpus.json')
    objects = read(cache/'research/structural-corpus-native.json')
    n = NativeAppearanceStackInputs(cache/'public/decoder-16.21-macos', args.client)
    if (objects['decoderImageSha256'] != sha(n.image) or objects['constructorImageSha256'] != n.profile['constructorImageSha256'] or
            samples['build'] != n.profile['clientVersion'] or samples['protocol'] != n.profile['protocolDigest']):
        raise ValueError('Matching appearance packet observations required')
    codecs, probes, records = {}, [], []
    for opcode, spec in SPECS.items():
        fields = {}
        for name, (offset, width, output) in spec['fields'].items():
            columns = [[] for _ in range(width)]
            for value in range(256):
                data = bytearray(spec['objectSize'])
                data[offset:offset+width] = bytes([value])*width
                actual = n.arguments(opcode, bytes(data))[name]
                for lane in range(width):
                    columns[lane].append(bool(actual) if name in BOOLEANS else (actual >> (lane*8)) & 255)
            if name not in BOOLEANS and any(len(set(c)) != 256 for c in columns):
                raise ValueError('Appearance scalar getter is not a byte bijection: '+name)
            if name in BOOLEANS and set(columns[0]) != {False, True}:
                raise ValueError('Appearance predicate codec differs: '+name)
            for index in range(512):
                encoded = bytes((index*73+lane*61+(index >> 8)*29) & 255 for lane in range(width))
                data = bytearray(spec['objectSize'])
                data[offset:offset+width] = encoded
                actual = n.arguments(opcode, bytes(data))[name]
                translated = columns[0][encoded[0]] if name in BOOLEANS else int.from_bytes(
                    bytes(columns[lane][byte] for lane, byte in enumerate(encoded)), 'little')
                if actual != translated:
                    raise ValueError('Mixed original appearance getter differs: '+name)
                probes.append({'opcode': opcode, 'field': name, 'encodedHex': encoded.hex(), 'value': actual})
            fields[name] = {'offset': offset, 'width': width, 'boolean': name in BOOLEANS, 'decode': columns}
        codecs[opcode] = {'objectSize': spec['objectSize'], 'decoderRva': n.profile['packets'][str(opcode)]['entryRva'],
                         'getterBlock': [spec['start'], spec['end']], 'fields': fields}
        selected = [(key, sample) for key, sample in samples['packets'].items() if sample['opcode'] == opcode]
        for key, sample in selected:
            observation = objects['observations'][key]
            if observation['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex'])) or observation['param'] != sample['param']:
                raise ValueError('Appearance payload evidence differs')
            result = n.record(opcode, observation)
            records.append({'key': key, 'opcode': opcode, 'time': sample['time'], 'stream': sample['stream'],
                            'entityId': sample['param'], **result})
        print(json.dumps({'opcode': opcode, 'fields': len(fields), 'packetSamples': len(selected)}), flush=True)
    paths = {Path(__file__), Path(inspect.getfile(NativeEffectContexts)),
             *[Path(inspect.getfile(c)) for c in NativeAppearanceStackInputs.__mro__ if c is not object]}
    ranges = [(v['start'], v['end']) for v in SPECS.values()] + [(0xf7718, 0xf7721), (0xcc180, 0xcc1a0),
              (0x67120, 0x67210), (0xcb93d, 0xcb9d5), (0x66230, 0x66310), (0x667e4, 0x667f6)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original appearance code differs from matching executable')
    meta = {'schema': 1, 'kind': 'prepared-original-appearance-stack-inputs',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'constructorImageSha256': n.profile['constructorImageSha256'],
        'arenaBase': 0x10200000, 'packets': codecs,
        'strings': {'character': 0x18, 'alternateCharacterA': 0x38, 'namespace': 0x48, 'alternateCharacterB': 0x58},
        'modifierVector': {'pointerOffset': 0x28, 'countOffset': 0x30, 'stride': 16},
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'producerSha256': sha(Path(__file__).read_bytes()),
        'scope': {'staticBuildDataOnly': True, 'containsReplayEvents': False,
                  'originalArgumentGetterPrefixesExecuted': True, 'unitCallbacksExecuted': False,
                  'fullAppearanceTransitionExecuted': False, 'liveResourceStackReconstructed': False,
                  'effectFactoryExecuted': False, 'mainViewerIntegrated': False}}
    encoded = json.dumps(meta, indent=2).encode()
    dest = cache/'public/latest-appearance-stack-inputs/package.json'
    dest.parent.mkdir(exist_ok=True)
    dest.write_bytes(encoded)
    report = {'schema': 1, 'kind': 'original-appearance-stack-input-observations',
        'build': meta['build'], 'protocol': meta['protocol'], 'packageSha256': sha(encoded),
        'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'originalBlocks': list(n.blocks.values()), 'probes': probes, 'records': records,
        'routingUnit': n.routing_unit, 'routingUnitHex': bytes(n.u.mem_read(n.routing_unit, 0x168)).hex(),
        'counts': {'packetSamples': len(records), 'fields': sum(len(p['fields']) for p in codecs.values()),
                   'mixedGetterComparisons': len(probes)}, 'scope': meta['scope']}
    (cache/'research/appearance-stack-inputs-native.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(encoded), 'counts': report['counts'], 'examples': records[:2]}))


if __name__ == '__main__':
    main()

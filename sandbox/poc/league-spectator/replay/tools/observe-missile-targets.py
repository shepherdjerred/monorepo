"""Execute the original target-ID conversion on native decoded packet fixtures."""
import argparse
import importlib.util
import inspect
import json
from pathlib import Path
import struct

module_path = Path(__file__).with_name('prepare-missile-targets.py')
spec = importlib.util.spec_from_file_location('native_target_codec', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    package = cache / 'public/decoder-16.21-macos'
    source_paths = [module_path, Path(__file__), Path(inspect.getfile(module.MachImage)),
                    package / 'profile.json', package / 'image.bin', args.client]
    inputs = {str(path.resolve()): module.sha(path.read_bytes()) for path in source_paths}
    native = module.NativeMissileTargetCodec(package, args.client)
    records = []
    for name in ['projectile-combat-native.json', 'combat-native.json']:
        path = cache / 'research' / name
        raw = path.read_bytes()
        inputs[str(path)] = module.sha(raw)
        observed = json.loads(raw)
        if (observed['clientVersion'] != native.profile['clientVersion'] or
                observed['decoderImageSha256'] != native.profile['decoderImageSha256'] or
                observed['constructorImageSha256'] != native.profile['constructorImageSha256']):
            raise ValueError('Native target observation build differs')
        for key, observation in observed['observations'].items():
            opcode = observation['opcode']
            if opcode not in [28, 1027]:
                continue
            if observation['status'] != 'complete':
                raise ValueError('Incomplete original packet cannot establish target fields')
            obj, heap = bytes.fromhex(observation['object']), bytes.fromhex(observation['heap'])
            if len(obj) != (632 if opcode == 28 else 336):
                raise ValueError('Original target-bearing packet size differs')
            cast = 168 if opcode == 28 else 24
            pointer, count = struct.unpack_from('<QI', obj, cast + 120)
            offset = pointer - 0x10200000
            if count > 65536 or count and not 0 <= offset <= len(heap) - count * 16:
                raise ValueError('Original target vector escapes its decoded heap')
            data = heap[offset:offset + count * 16] if count else b''
            identities = []
            for at in range(0, len(data), 16):
                if struct.unpack_from('<Q', data, at)[0] != native.base + native.VTABLE:
                    raise ValueError('Original target record vtable differs')
                identities.append(native.decode_word(struct.unpack_from('<I', data, at + 8)[0]))
            records.append({'source': str(path), 'key': key, 'opcode': opcode,
                            'payloadSha256': observation['payloadSha256'], 'targetCount': count,
                            'entriesHex': data.hex(), 'requestedEntityIds': identities})
    target_package_path = cache / 'public/latest-missile-targets/package.json'
    target_package_bytes = target_package_path.read_bytes()
    inputs[str(target_package_path)] = module.sha(target_package_bytes)
    target_package = json.loads(target_package_bytes)
    unsigned_controls = []
    for requested in [0, 1, 0x80000000, 0xffffffff]:
        encoded = 0
        for lane, column in enumerate(target_package['networkId']['decode']):
            encoded |= column.index((requested >> (lane * 8)) & 255) << (lane * 8)
        if native.decode_word(encoded) != requested:
            raise ValueError('Original unsigned target boundary conversion differs')
        unsigned_controls.append({'requestedEntityId': requested,
                                  'entriesHex': (struct.pack('<QI', native.base + native.VTABLE, encoded) + bytes(4)).hex()})
    for path, expected in inputs.items():
        if module.sha(Path(path).read_bytes()) != expected:
            raise ValueError('Missile target native input changed during observation: ' + path)
    output = cache / 'research/missile-targets-native.json'
    result = {'schema': 1, 'build': native.profile['clientVersion'],
              'protocol': native.profile['protocolDigest'], 'records': records,
              'nativeExecutions': native.calls, 'unsignedBoundaryControls': unsigned_controls, 'inputs': inputs,
              'unicornVersion': module.unicorn.__version__,
              'scope': {'originalIdFragmentExecuted': True,
                        'worldTargetLookupExecuted': False, 'targetTrackingVerified': False,
                        'movementEligibilityExpanded': False, 'mainViewerExpanded': False}}
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'packets': len(records), 'targets': native.calls}))


if __name__ == '__main__':
    main()

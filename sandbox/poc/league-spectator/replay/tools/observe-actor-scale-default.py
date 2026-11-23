"""Recover the absent skinScale value from its original registered constructor."""
import argparse
import inspect
import json
import math
import struct
from pathlib import Path
from character_asset_native import NativeCharacterAssets
from vfx_spawn_native import name_hash, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    n = NativeCharacterAssets(args.cache/'public/decoder-16.21-macos', args.client)
    n.initialize_character_types()
    catalog = n.catalog()
    key = '%08x' % name_hash('SkinMeshDataProperties')
    descriptor = catalog[key]
    fields = [field for field in descriptor['properties'] if field['hash'] == name_hash('skinScale')]
    if len(fields) != 1 or fields[0]['type'] != 10 or fields[0]['offset']+4 > descriptor['size']:
        raise ValueError('Original scalar skinScale descriptor required')
    observed = n.observe_actor_fields(int(key, 16), [])
    value_bytes = bytes(n.u.mem_read(observed['object']+fields[0]['offset'], 4))
    value = struct.unpack('<f', value_bytes)[0]
    if not math.isfinite(value) or value <= 0:
        raise ValueError('Original skinScale constructor did not initialize a positive finite value')
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    proof = {'schema': 1, 'kind': 'original-skin-scale-default', 'build': n.profile['clientVersion'],
             'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
             'classHash': key, 'descriptor': descriptor, 'property': fields[0],
             'value': value, 'valueBits': value_bytes.hex(), 'originalObject': observed,
             'originalBlocks': list(n.blocks.values()),
             'sources': {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)},
             'scope': {'originalConstructorExecuted': True, 'authoredOverrideSupplied': False,
                       'meshScaleConsumerExecuted': False, 'completeActorConstructorExecuted': False}}
    args.output.write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'classHash': key, 'value': value, 'valueBits': value_bytes.hex(),
                      'propertyOffset': fields[0]['offset'], 'constructorRva': descriptor['constructRva']}))


if __name__ == '__main__':
    main()

"""Prepare exact-build raw opcode822 layout; no live visibility is inferred."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from macho import MachImage


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    decoder = args.cache / 'public/decoder-16.21-macos'
    profile = json.loads((decoder / 'profile.json').read_bytes())
    image = (decoder / 'image.bin').read_bytes()
    constructors = (decoder / 'constructors.bin').read_bytes()
    source = MachImage(args.client.read_bytes())
    if (profile['clientVersion'] != '16.21.829.8620' or profile['protocolDigest'] != '20e09df23c66b85e' or
            sha(image) != profile['decoderImageSha256'] or sha(source.binary) != profile['sliceSha256'] or
            sha(constructors) != profile['constructorImageSha256'] or
            profile['packets']['822']['entryRva'] != 0x10f86a0 or profile['packets']['822']['objectSize'] != 48):
        raise ValueError('Exact target visibility packet build/decoder required')
    packet = profile['packets']['822']
    header = constructors[packet['offset']:packet['offset'] + 48]
    if len(header) != 48 or struct.unpack_from('<QI', header)[0:2] != (profile['imageBase'] + 0x23c90a0, 822):
        raise ValueError('Original target visibility packet constructor layout differs')
    ranges = [(0x10f86a0, 0x10f872c), (0x23c90a0, 0x23c90c0),
              (0x6e27da, 0x6e2806), (0x21b710, 0x21b774), (0x21b780, 0x21b7e0)]
    for start, end in ranges:
        if image[start:end] != source.image[start:end]:
            raise ValueError('Original target visibility instructions/data differ')
    output = args.cache / 'public/latest-target-visibility/package.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    result = {'schema': 1, 'kind': 'raw-target-visibility-inputs',
        'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
        'decoderImageSha256': profile['decoderImageSha256'], 'sliceSha256': profile['sliceSha256'],
        'packet': {'opcode': 822, 'objectBytes': 48, 'vtableRva': 0x23c90a0,
                   'decoderRva': 0x10f86a0, 'entityIdOffset': 12,
                   'vectors': [{'name': 'primaryPayloadHex', 'offset': 16},
                               {'name': 'secondaryPayloadHex', 'offset': 32}]},
        'originalRanges': [{'rva': start, 'bytes': end-start, 'sha256': sha(image[start:end])}
                           for start, end in ranges], 'producerSha256': sha(Path(__file__).read_bytes()),
        'scope': {'staticBuildDataOnly': True, 'rawSerializedOwnerPayloads': True,
                  'ownerPayloadSemanticsRecovered': False, 'liveVisibilityAccepted': False}}
    raw = json.dumps(result, separators=(',', ':')).encode()
    output.write_bytes(raw)
    print(json.dumps({'output': str(output), 'sha256': sha(raw)}))


if __name__ == '__main__':
    main()

"""Prepare exact-build raw visibility mask/reset packet layouts only."""
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
            sha(constructors) != profile['constructorImageSha256']):
        raise ValueError('Exact visibility mask/reset build required')
    packets = []
    for opcode, entry, size, vtable, callback in [
            (48, 0x10f8740, 20, 0x23c9130, 0x21b5a0),
            (582, 0x10f87c0, 20, 0x23c9178, 0x21b5d0),
            (918, 0x10f8730, 16, 0x23c90e8, 0x21b570)]:
        packet = profile['packets'][str(opcode)]
        header = constructors[packet['offset']:packet['offset'] + size]
        if (packet['entryRva'] != entry or packet['objectSize'] != size or len(header) != size or
                struct.unpack_from('<QI', header) != (profile['imageBase'] + vtable, opcode)):
            raise ValueError('Original visibility mask/reset constructor differs')
        packets.append({'opcode': opcode, 'decoderRva': entry, 'objectBytes': size,
                        'vtableRva': vtable, 'entityIdOffset': 12,
                        'encodedViewSlotByteOffset': 16 if opcode != 918 else None,
                        'componentCallbackRva': callback})
    ranges = [(0x10f8730, 0x10f8840), (0x23c90e8, 0x23c91c0), (0x21b570, 0x21b5f9)]
    for first, last in ranges:
        if image[first:last] != source.image[first:last]:
            raise ValueError('Original visibility mask/reset instructions differ')
    result = {'schema': 1, 'kind': 'raw-target-visibility-mask-inputs',
        'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
        'decoderImageSha256': profile['decoderImageSha256'], 'sliceSha256': profile['sliceSha256'],
        'packets': packets, 'originalRanges': [
            {'rva': first, 'bytes': last-first, 'sha256': sha(image[first:last])} for first, last in ranges],
        'producerSha256': sha(Path(__file__).read_bytes()),
        'scope': {'staticBuildDataOnly': True, 'rawEncodedViewSlotByte': True,
                  'componentRoutingAccepted': False, 'liveVisibilityAccepted': False}}
    output = args.cache / 'public/latest-target-visibility-masks/package.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(result, separators=(',', ':')).encode()
    output.write_bytes(raw)
    print(json.dumps({'output': str(output), 'sha256': sha(raw)}))


if __name__ == '__main__':
    main()

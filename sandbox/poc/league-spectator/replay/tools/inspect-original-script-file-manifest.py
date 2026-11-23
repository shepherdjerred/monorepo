"""Exact source evidence for the original script-file registry input path.

The original path literal/open caller is inspected, not executed. Archive
ownership, stream parsing and recorded script availability remain separate.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('decoder_root', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    profile_bytes = (args.decoder_root/'profile.json').read_bytes()
    image = (args.decoder_root/'image.bin').read_bytes()
    profile = json.loads(profile_bytes)
    if (profile['clientVersion'] != '16.21.829.8620' or profile['protocolDigest'] != '20e09df23c66b85e' or
            profile['decoderImageSha256'] != '3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7' or
            sha(image) != profile['decoderImageSha256']):
        raise ValueError('Exact original16.21 image required')
    lea, call = 0x8528de, 0x8528e8
    if (image[lea:lea+3] != bytes.fromhex('488d35') or image[call] != 0xe8 or
            call+5+struct.unpack_from('<i', image, call+1)[0] != 0x1479da0):
        raise ValueError('Original script manifest literal/open call differs')
    literal = lea+7+struct.unpack_from('<i', image, lea+3)[0]
    end = image.find(b'\0', literal, literal+512)
    if not 0 <= literal < end:
        raise ValueError('Bounded original manifest path required')
    file = image[literal:end].decode('ascii')
    if file != 'DATA/all_lua_files.manifest':
        raise ValueError('Original script manifest path differs')
    blocks = [(0x6770e0, 0x677108), (0x8529e0, 0x852a2f), (0x8528c0, 0x85299f)]
    if ((args.decoder_root/'profile.json').read_bytes() != profile_bytes or
            (args.decoder_root/'image.bin').read_bytes() != image):
        raise ValueError('Script manifest source changed during inspection')
    result = {'schema': 1, 'kind': 'original-script-file-manifest-source-reference',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
              'decoderImageSha256': sha(image), 'profileSha256': sha(profile_bytes),
              'sourceSha256': sha(Path(__file__).read_bytes()), 'file': file,
              'literalRva': literal, 'literalSha256': sha(image[literal:end+1]),
              'pathLoadRva': lea, 'openCallRva': call, 'openReaderRva': 0x1479da0,
              'startupEntryRva': 0x6770e0, 'registryConstructorRva': 0x8529e0,
              'registryLoadRva': 0x8528c0, 'scriptPathLookupRva': 0x85d790,
              'sourceBlocks': [{'rva': start, 'bytes': end-start, 'sha256': sha(image[start:end])}
                               for start, end in blocks],
              'scope': {'sourceOnly': True, 'originalRegistryLoadExecuted': False,
                        'archiveOwnerResolved': False, 'scriptFileNamesResolved': False,
                        'runtimeSpellResourcesPublished': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'file': file}))


if __name__ == '__main__':
    main()

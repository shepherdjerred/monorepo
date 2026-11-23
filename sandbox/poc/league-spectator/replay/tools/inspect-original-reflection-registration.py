"""Source-only exact-build reflection constructor/caller candidates.

Actual MOV ESI,class / CALL14b5a10 instructions and direct caller bytes are
retained. A nearby frame prologue is a candidate extent, not execution proof.
Only an adjacent original LEA RDI,descriptor / CALL pair is named as such.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('decoder_root', type=Path)
    parser.add_argument('class_hashes', help='One to16 comma-separated eight-digit hexadecimal hashes')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    profile_bytes = (args.decoder_root/'profile.json').read_bytes()
    image = (args.decoder_root/'image.bin').read_bytes()
    profile = json.loads(profile_bytes)
    if (profile['clientVersion'] != '16.21.829.8620' or profile['protocolDigest'] != '20e09df23c66b85e' or
            profile['decoderImageSha256'] != '3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7' or
            sha(image) != profile['decoderImageSha256'] or len(image) != profile['sizeOfImage']):
        raise ValueError('Exact approved16.21 original image required')
    values = args.class_hashes.split(',')
    if (not 0 < len(values) <= 16 or len(set(values)) != len(values) or
            any(len(value) != 8 or any(char not in '0123456789abcdef' for char in value) for value in values)):
        raise ValueError('Distinct canonical bounded class hashes required')
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    def instructions(start, end):
        return [{'rva': ins.address, 'bytes': ins.bytes.hex(), 'mnemonic': ins.mnemonic,
                 'operands': ins.op_str} for ins in md.disasm(image[start:end], start)]
    def calls(target):
        found, offset = [], 0
        while True:
            offset = image.find(b'\xe8', offset, 0x1fef000)
            if offset < 0:
                return found
            at, offset = offset, offset+1
            if at+5+struct.unpack_from('<i', image, at+1)[0] == target:
                found.append(at)
    records = []
    for text in values:
        identity = int(text, 16)
        signature = b'\xbe'+struct.pack('<I', identity)
        offset, candidates = 0, []
        while True:
            offset = image.find(signature, offset, 0x1fef000)
            if offset < 0:
                break
            at, offset = offset, offset+1
            body = instructions(at, at+40)
            matches = [row for row in body if row['mnemonic'] == 'call' and
                       row['bytes'].startswith('e8') and len(row['bytes']) == 10 and
                       row['rva']+5+struct.unpack('<i', bytes.fromhex(row['bytes'])[1:])[0] == 0x14b5a10]
            if not matches:
                continue
            frame = image.rfind(bytes.fromhex('554889e5'), max(0, at-512), at)
            caller_rows = []
            if frame >= 0:
                for caller in calls(frame):
                    prefix = caller-7
                    pair = image[prefix:caller+5]
                    descriptor = None
                    if pair[:3] == bytes.fromhex('488d3d'):
                        descriptor = prefix+7+struct.unpack_from('<i', pair, 3)[0]
                        if not 0 <= descriptor <= len(image)-0x50:
                            raise ValueError('Original descriptor LEA escapes image')
                    caller_rows.append({'callRva': caller, 'targetRva': frame,
                                        'adjacentLeaRdiRva': prefix if descriptor is not None else None,
                                        'staticDescriptorRva': descriptor,
                                        'pairSha256': sha(pair), 'instructions': instructions(prefix, caller+5)})
            candidates.append({'classMoveRva': at, 'typeRegistrationCallRva': matches[0]['rva'],
                               'registrationRva': 0x14b5a10, 'candidateFramePrologueRva': frame if frame >= 0 else None,
                               'registrationInstructions': instructions(at, matches[0]['rva']+5),
                               'callers': caller_rows})
        records.append({'classHash': text, 'candidates': candidates})
    if ((args.decoder_root/'profile.json').read_bytes() != profile_bytes or
            (args.decoder_root/'image.bin').read_bytes() != image):
        raise ValueError('Reflection source changed during inventory')
    result = {'schema': 1, 'kind': 'original-reflection-registration-source-candidates',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
              'decoderImageSha256': sha(image), 'profileSha256': sha(profile_bytes),
              'sourceSha256': sha(Path(__file__).read_bytes()), 'records': records,
              'scope': {'sourceOnly': True, 'originalConstructorsExecuted': False,
                        'candidateFrameExtentProved': False, 'classLayoutAdmitted': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'records': [
        {'classHash': row['classHash'], 'candidates': len(row['candidates']),
         'staticCallerPairs': sum(sum(call['staticDescriptorRva'] is not None for call in candidate['callers'])
                                  for candidate in row['candidates'])} for row in records]}))


if __name__ == '__main__':
    main()

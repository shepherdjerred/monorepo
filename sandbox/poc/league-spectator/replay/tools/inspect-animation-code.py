"""Read original exact-build animation instruction ranges without mutation."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import capstone
from macho import MachImage

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('ranges', nargs='+', help='Hex start:end RVA pairs')
parser.add_argument('--client', type=Path)
args = parser.parse_args()
profile = json.loads((args.package/'profile.json').read_bytes())
image = (args.package/'image.bin').read_bytes()
if hashlib.sha256(image).hexdigest() != profile['decoderImageSha256']:
    raise ValueError('Exact original decoder image required')
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
pristine = MachImage(args.client.read_bytes()).image if args.client else None
for pair in args.ranges:
    if pair.startswith('floats@'):
        start, count = [int(value, 16) for value in pair[7:].split(':')]
        if not 0 < count <= 16 or start < 0 or start+count*4 > len(image):
            raise ValueError('Bounded original float constants required')
        current = image[start:start+count*4]
        if pristine is not None and current != pristine[start:start+count*4]:
            raise ValueError('Prepared image constant differs from original client')
        print(json.dumps({'rva': hex(start), 'hex': current.hex(), 'values': struct.unpack_from('<'+'f'*count, image, start), 'pristineClientMatched': pristine is not None}))
        continue
    if pair.startswith('writes@'):
        target = int(pair[7:], 16)
        for prefix, size in [(b'\xc7\x05', 10), (b'\x89\x05', 6), (b'\x48\x89\x05', 7), (b'\x48\xc7\x05', 11), (b'\x0f\x29\x05', 7), (b'\x0f\x11\x05', 7), (b'\x66\x0f\x7f\x05', 8), (b'\xf3\x0f\x7f\x05', 8), (b'\x66\x0f\xd6\x05', 8), (b'\xf3\x0f\x11\x05', 8), (b'\x48\x8d\x3d', 7)]:
            cursor = 0
            while True:
                cursor = image.find(prefix, cursor)
                if cursor < 0 or cursor+size > len(image):
                    break
                if cursor+size+struct.unpack_from('<i', image, cursor+len(prefix))[0] == target:
                    print(f'write {cursor:x} -> {target:x}')
                cursor += 1
        continue
    if pair.startswith('calls@'):
        target = int(pair[6:], 16)
        cursor = 0
        while True:
            cursor = image.find(b'\xe8', cursor)
            if cursor < 0 or cursor+5 > len(image):
                break
            if cursor+5+struct.unpack_from('<i', image, cursor+1)[0] == target:
                print(f'callsite {cursor:x} -> {target:x}')
            cursor += 1
        continue
    start, end = [int(value, 16) for value in pair.split(':')]
    if not 0 <= start < end <= len(image) or end-start > 0x4000:
        raise ValueError('Bounded original instruction range required')
    for instruction in decoder.disasm(image[start:end], start):
        print(f'{instruction.address:x}: {instruction.mnemonic} {instruction.op_str}')

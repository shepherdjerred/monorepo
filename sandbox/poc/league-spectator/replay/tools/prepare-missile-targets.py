"""Static target-reference byte codec from the original CastInfo conversion.

This prepares build data only. Decoding a requested network ID does not prove
that the original world lookup accepted that target or establish its motion.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as r
from macho import MachImage


def sha(data):
    return hashlib.sha256(data).hexdigest()


class NativeMissileTargetCodec:
    START, END = 0x82ad74, 0x82aeb8
    XMM11, XMM12 = 0x20ca860, 0x20ca390
    VTABLE = 0x23d5be0

    def __init__(self, package, client):
        self.package = Path(package)
        self.profile = json.loads((self.package / 'profile.json').read_bytes())
        self.image = (self.package / 'image.bin').read_bytes()
        source = MachImage(Path(client).read_bytes())
        if (self.profile['clientVersion'] != '16.21.829.8620' or
                self.profile['protocolDigest'] != '20e09df23c66b85e' or
                sha(self.image) != self.profile['decoderImageSha256'] or
                sha(source.binary) != self.profile['sliceSha256']):
            raise ValueError('Exact original target codec build and image required')
        self.ranges = [(self.START, self.END),
                       (0x82aeb8, 0x82aecd),  # ESI flows into target lookup helper.
                       (0x82c850, 0x82c8c6),  # Original world lookup 0x548f00.
                       (0x82aecd, 0x82aedf),  # Original SIMD constant reloads.
                       (self.XMM11, self.XMM11 + 16),
                       (self.XMM12, self.XMM12 + 16),
                       (self.VTABLE, self.VTABLE + 0x30)]
        for start, end in self.ranges:
            if self.image[start:end] != source.image[start:end]:
                raise ValueError('Original target codec instructions/data differ')
        # Validate the actual RIP-relative constant loads used by the loop.
        if (0x82aed6 + struct.unpack_from('<i', self.image, 0x82aed2)[0] != self.XMM12 or
                0x82aedf + struct.unpack_from('<i', self.image, 0x82aedb)[0] != self.XMM11):
            raise ValueError('Original target codec SIMD input addresses differ')
        self.base = self.profile['imageBase']
        self.engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
        self.engine.mem_map(self.base, len(self.image), unicorn.UC_PROT_READ | unicorn.UC_PROT_EXEC)
        self.engine.mem_write(self.base, self.image)
        self.engine.mem_map(0x10000000, 0x1000, unicorn.UC_PROT_READ | unicorn.UC_PROT_WRITE)
        self.initial = self.engine.context_save()
        self.calls = 0

    def decode_word(self, word):
        if type(word) is not int or not 0 <= word <= 0xffffffff:
            raise ValueError('Target codec requires an encoded uint32')
        e = self.engine
        e.context_restore(self.initial)
        e.mem_write(0x10000008, struct.pack('<I', word))
        for register, value in [
            (r.UC_X86_REG_RAX, 0x10000000), (r.UC_X86_REG_RBX, 0),
            (r.UC_X86_REG_XMM11, int.from_bytes(self.image[self.XMM11:self.XMM11 + 16], 'little')),
            (r.UC_X86_REG_XMM12, int.from_bytes(self.image[self.XMM12:self.XMM12 + 16], 'little')),
        ]:
            e.reg_write(register, value)
        e.emu_start(self.base + self.START, self.base + self.END, count=1000)
        if e.reg_read(r.UC_X86_REG_RIP) != self.base + self.END:
            raise ValueError('Original target codec escaped its bounded fragment')
        self.calls += 1
        return e.reg_read(r.UC_X86_REG_ESI)

    def tables(self):
        baseline = self.decode_word(0).to_bytes(4, 'little')
        tables = []
        for lane in range(4):
            column = []
            for value in range(256):
                actual = self.decode_word(value << (lane * 8)).to_bytes(4, 'little')
                if any(actual[i] != baseline[i] for i in range(4) if i != lane):
                    raise ValueError('Target network ID codec is not lane independent')
                column.append(actual[lane])
            if set(column) != set(range(256)):
                raise ValueError('Target network ID codec is not a byte permutation')
            tables.append(column)
        word = 0x82ad74
        for _ in range(512):
            word = (word * 1664525 + 1013904223) & 0xffffffff
            expected = int.from_bytes(bytes(tables[i][(word >> (i * 8)) & 255] for i in range(4)), 'little')
            if self.decode_word(word) != expected:
                raise ValueError('Combined target byte codec disagrees with original execution')
        return tables


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    native = NativeMissileTargetCodec(args.package, args.client)
    result = {
        'schema': 1, 'build': native.profile['clientVersion'],
        'protocol': native.profile['protocolDigest'],
        'decoderImageSha256': native.profile['decoderImageSha256'],
        'sliceSha256': native.profile['sliceSha256'],
        'targetRecordBytes': 16, 'targetRecordVtableRva': native.VTABLE,
        'networkId': {'offset': 8, 'bytes': 4, 'decode': native.tables()},
        'originalRanges': [{'rva': start, 'bytes': end - start,
                            'sha256': sha(native.image[start:end])}
                           for start, end in native.ranges],
        'nativeExecutions': native.calls,
        'producerSha256': sha(Path(__file__).read_bytes()),
        'scope': {'staticBuildDataOnly': True, 'requestedNetworkIdentity': True,
                  'worldTargetAccepted': False, 'movementEligibilityExpanded': False},
    }
    output = args.package.parent / 'latest-missile-targets/package.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(result, separators=(',', ':')).encode('utf-8')
    output.write_bytes(raw)
    print(json.dumps({'output': str(output), 'sha256': sha(raw),
                      'nativeExecutions': native.calls, 'scope': result['scope']}))


if __name__ == '__main__':
    main()

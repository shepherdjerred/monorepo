"""Observe the original batched-quad erosion input ABI without a game process.

This captures native call-site values and native vertex packing, not a complete
render submission or reference-client pixel comparison.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    decoder = args.cache / 'public/decoder-16.21-macos'
    n = NativeSpawn(decoder, args.client)
    # Stop before the real uniform setter; no substitute callback is installed.
    n.call(0x173d8e5, {}, 0x173d8f1)
    mode = n.u.reg_read(r.UC_X86_REG_RSI)
    n.call(0x173da70, {r.UC_X86_REG_RAX: 0x100e0000}, 0x173da77)
    name_pointer = n.u.reg_read(r.UC_X86_REG_RSI)
    name = bytes(n.u.mem_read(name_pointer, 19)).split(b'\0')[0].decode('ascii')
    if mode != 1 or name != 'USE_INSTANCE_DRAW':
        raise ValueError('Original quad draw mode differs')
    # The native UV helper called by both admitted quad writers packs
    # XMM0/XMM1/XMM2/XMM3 into half4. The fourth lane is the pool's +28 drive.
    samples = []
    for drive in [-.5, -0., 0., .125, .5, .875, 1., 2.]:
        out = 0x100e1000
        regs = {r.UC_X86_REG_RDI: out}
        for register, value in [(r.UC_X86_REG_XMM0, .25),
                                (r.UC_X86_REG_XMM1, .75),
                                (r.UC_X86_REG_XMM2, 1.),
                                (r.UC_X86_REG_XMM3, drive)]:
            regs[register] = int.from_bytes(struct.pack('<f', value), 'little')
        n.call(0x1731fb0, regs)
        packed = bytes(n.u.mem_read(out, 8))
        expected = struct.pack('<4e', .25, .75, 1., drive)
        if packed != expected:
            raise ValueError('Native half4 packing differs')
        samples.append({'driveHex': struct.pack('<f', drive).hex(),
                        'packedHex': packed.hex()})
    blocks = [(0x173d8e5, 0x173d8f6), (0x173da70, 0x173da87),
              (0x17335eb, 0x1733605), (0x1733792, 0x17337a7),
              (0x173073b, 0x173075a), (0x1731a50, 0x1731c4c),
              (0x1731fb0, 0x17320e7)]
    sources = {Path(__file__), Path(inspect.getfile(NativeSpawn))}
    result = {'schema': 1, 'kind': 'native-batched-quad-erosion-input',
              'build': n.profile['clientVersion'],
              'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image),
              'sources': {v.name: sha(v.read_bytes()) for v in sources},
              'originalBlocks': [{'rva': a, 'size': b-a, 'sha256': sha(n.image[a:b])}
                                 for a, b in blocks],
              'uniform': {'name': name, 'value': mode,
                          'nameRva': name_pointer-n.base,
                          'callsiteRva': 0x173d8f1},
              'vertexInput': {'attribute': 'a_TEXCOORD', 'component': 3,
                              'byteOffset': 22, 'encoding': 'float16',
                              'poolAttributeOffset': 0x28,
                              'poolAttributeStride': 0x2c},
              'samples': samples,
              'scope': {'nativeCallsiteObserved': True,
                        'nativeHalfPackingObserved': True,
                        'uniformSetterExecuted': False,
                        'gpuSubmissionObserved': False,
                        'referenceCompared': False}}
    output = args.cache / 'research/quad-erosion-input-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'uniform': result['uniform'],
                      'packingSamples': len(samples)}))


if __name__ == '__main__':
    main()

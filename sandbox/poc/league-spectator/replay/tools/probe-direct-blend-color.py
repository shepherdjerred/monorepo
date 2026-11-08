"""Execute original arbitrary-quad blend color fragment and byte packer."""
import argparse
import inspect
import json
from pathlib import Path
import struct

from unicorn import x86_const as r
from vfx_point_quad_native import NativePointQuad
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    n = NativePointQuad(cache / 'public/decoder-16.21-macos', args.client)
    frame = A['context'] + 0x1000
    attributes = A['point']
    controls = []
    for blend in [0, 1, 2, 4, 255]:
        for color in [[0, 0, 0, 0], [1, 1, 1, 1], [0.2, 0.4, 0.8, 0.5],
                      [2, -1, 0.5, 0.125], [0.003, 0.99, 0.333, 0.0001]]:
            for multiplier in [[1, 1, 1, 1], [0.5, 0.7, 0.9, 0.3]]:
                n.put(attributes + 4, '4f', *color)
                n.put(frame - 0x160, '4f', *multiplier[:2], 0, 0)
                n.put(frame - 0x150, '4f', *multiplier[2:], 0, 0)
                n.put(frame - 0xac, 'B', blend)
                n.call(0x173075a, {r.UC_X86_REG_RBP: frame,
                                   r.UC_X86_REG_RCX: attributes, r.UC_X86_REG_R12: 44}, 0x17307b0)
                transformed = list(struct.unpack('<4f', n.u.mem_read(frame - 0x108, 16)))
                n.call(0x148f090, {r.UC_X86_REG_RDI: attributes + 0x100,
                                   r.UC_X86_REG_RSI: frame - 0x108})
                controls.append({'blend': blend, 'color': color, 'multiplier': multiplier,
                                 'transformed': transformed,
                                 'packed': list(n.u.mem_read(attributes + 0x100, 4))})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sites = [(0x173075a, 0x17307b0), (0x1733605, 0x173365b), (0x148f090, 0x148f110)]
    result = {'schema': 1, 'kind': 'original-quad-blend-color-controls',
              'decoderImageSha256': n.profile['decoderImageSha256'], 'controls': controls,
              'sourceSites': [{'startRva': start, 'endRva': end,
                               'bytesHex': n.image[start:end].hex(), 'sha256': sha(n.image[start:end])}
                              for start, end in sites],
              'originalBlocks': list(n.blocks.values()),
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'scope': {'originalArbitraryColorFragmentExecuted': True,
                        'originalBytePackerExecuted': True, 'suppliedComponentInputs': True,
                        'mode2Admission': False, 'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-blend-color-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'first': controls[:2]}))


if __name__ == '__main__':
    main()

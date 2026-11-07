"""Execute the original navigation-grid shader transform setter on explicit vectors."""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    decoder = cache / 'public/decoder-16.21-macos'
    n = NativeVfxRetirement(decoder, args.client)
    controls = [
        ([0, 0, 0], [100, 0, 200]), ([50, 0, 100], [100, 0, 200]),
        ([123.5, -77, -456.25], [37, 0, 109]), ([-1000, 7, 2500], [500, 19, 10000]),
        ([6603.411, 0, 6243.991], [12400, 0, 11850]),
        ([1, 0, -1], [.001, 0, .003]), ([0, 3, 0], [1e30, -123, 1e-30]),
        ([123.5, 99, -456.25], [37, 1234, 109]),
    ]
    center_ptr, extent_ptr = n.allocate(12), n.allocate(12)
    cases = []
    for center, extent in controls:
        center = list(struct.unpack('<3f', struct.pack('<3f', *center)))
        extent = list(struct.unpack('<3f', struct.pack('<3f', *extent)))
        n.put(center_ptr, '3f', *center)
        n.put(extent_ptr, '3f', *extent)
        n.call(0x182bfc0, {r.UC_X86_REG_RDI: center_ptr, r.UC_X86_REG_RSI: extent_ptr})
        raw = bytes(n.u.mem_read(n.base + 0x2549030, 16))
        cases.append({'center': center, 'extent': extent, 'outputHex': raw.hex()})
    sources = {Path(__file__)}
    sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
    paths = {args.client, decoder / 'profile.json', decoder / 'image.bin', *sources}
    result = {'schema': 1, 'kind': 'native-navgrid-shader-transform-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'], 'cases': cases,
              'inputs': {str(path.resolve()): sha(path.read_bytes()) for path in paths},
              'originalBlocks': [{'rva': a, 'size': z-a, 'sha256': sha(n.image[a:z])} for a, z in
                                 [(0x182bfc0, 0x182c004), (0x60c8fb, 0x60c940), (0x16bd3c0, 0x16bd460),
                                  (0x20ca0d0, 0x20ca0e0), (0x20d6e80, 0x20d6e90), (0x20ca120, 0x20ca130)]],
              'scope': {'originalSetterExecuted': True, 'suppliedCenterExtent': True,
                        'actualMapGettersExecuted': False, 'originalUniformUploadExecuted': False,
                        'runtimeAdmissionChanged': False}}
    target = cache / 'research/direct-navgrid-transform-native.json'
    target.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(target), 'cases': len(cases)}))


if __name__ == '__main__':
    main()

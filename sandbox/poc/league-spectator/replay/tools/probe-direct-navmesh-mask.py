"""Original fourfold navmesh-mask expansion on explicitly supplied RGBA cells.

The contiguous CPU fragment ends before the texture upload. No original
navgrid/game/graphics callback is replaced, and no map mask is admitted.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    decoder = cache / 'public/decoder-16.21-macos'
    n = NativeVfxRetirement(decoder, args.client)
    table = n.image[0x20d6bd0:0x20d6cd0]
    if sha(table) != 'dd7549d63f4dbe9cde8ba813fe2be5e9db334b0e54d65edaa0ad5bc4ca100fd6':
        raise ValueError('Original 16-case expansion table differs')
    supplied = []
    for code in range(16):
        rgba = bytes(v for i in range(4) for v in [17, 93, 129 if code & (1 << i) else 128, 201])
        supplied.append((f'corners-{code}', 2, 2, rgba))
    for w, h in [(2, 3), (3, 2), (3, 3), (5, 4), (7, 5), (32, 17)]:
        for level in [0, 127, 128, 129, 255]:
            supplied.append((f'uniform-{w}-{h}-{level}', w, h, bytes([3, 41, level, 199]) * (w * h)))
        rgba = bytes(v for i in range(w * h) for v in [i % 256, (i * 17) % 256, (i * 73 + 128) % 256, (i * 37) % 256])
        supplied.append((f'gradient-{w}-{h}', w, h, rgba))
    cases = []
    frame = A['stack'] - 0x200
    expanded = [(f'{label}-prior-{pattern}', w, h, rgba, pattern)
                for label, w, h, rgba in supplied for pattern in ['zero', 'a5', 'gradient']]
    for label, w, h, rgba, pattern in expanded:
        source = n.allocate(len(rgba) + 32, 0xa5)
        out_size = w * 4 * h * 4
        output = n.allocate(out_size + 32, 0xa5)
        previous = (bytes(out_size) if pattern == 'zero' else bytes([0xa5]) * out_size
                    if pattern == 'a5' else bytes((i * 43 + 17) % 256 for i in range(out_size)))
        n.u.mem_write(source + 16, rgba)
        n.u.mem_write(output + 16, previous)
        n.u.mem_write(frame - 0x90, bytes([0xa5]) * 0x90)
        for offset, value in [(-0x40, h), (-0x38, output + 16), (-0x68, w * 4), (-0x58, h * 4)]:
            n.put(frame + offset, 'Q', value)
        n.fragment(0x741055, 0x741240, {
            r.UC_X86_REG_RBP: frame, r.UC_X86_REG_RSP: frame - 0x90,
            r.UC_X86_REG_R13: w, r.UC_X86_REG_R12: source + 16,
            r.UC_X86_REG_RBX: w * 4,
        })
        actual = bytes(n.u.mem_read(output + 16, out_size))
        if (bytes(n.u.mem_read(source + 16, len(rgba))) != rgba or
                any(bytes(n.u.mem_read(ptr, 16)) != bytes([0xa5]) * 16 for ptr in
                    [source, source + 16 + len(rgba), output, output + 16 + out_size])):
            raise ValueError('Original expansion modified its source or escaped owned buffers')
        cases.append({'label': label, 'width': w, 'height': h, 'rgbaHex': rgba.hex(), 'previousHex': previous.hex(),
                      'outputWidth': w * 4, 'outputHeight': h * 4, 'outputHex': actual.hex()})
    sources = {Path(__file__)}
    sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
    paths = {args.client, decoder / 'profile.json', decoder / 'image.bin', *sources}
    result = {
        'schema': 1, 'kind': 'native-navmesh-mask-fourfold-expansion-controls',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'cases': cases, 'table': {'rva': 0x20d6bd0, 'size': 256, 'sha256': sha(table), 'bytesHex': table.hex()},
        'inputs': {str(path.resolve()): sha(path.read_bytes()) for path in paths},
        'originalBlocks': [{'rva': a, 'size': z-a, 'sha256': sha(n.image[a:z])} for a, z in
                           [(0x740e60, 0x741055), (0x741055, 0x741240), (0x741240, 0x741274)]],
        'scope': {'contiguousOriginalCpuExpansionExecuted': True, 'suppliedCellSurface': True,
                  'suppliedPreviousOutputSurface': True,
                  'actualReplayNavgridSurfaceRecovered': False, 'graphicsExpansionSettingRecovered': False,
                  'textureUploadExecuted': False, 'blurFadeExecuted': False, 'runtimeAdmissionChanged': False},
    }
    target = cache / 'research/direct-navmesh-mask-native.json'
    target.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(target), 'cases': len(cases), 'bytes': sum(len(c['outputHex']) // 2 for c in cases)}))


if __name__ == '__main__':
    main()

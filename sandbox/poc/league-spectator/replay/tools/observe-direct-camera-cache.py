"""Observe all original camera-cache entries with explicit orthogonal inputs."""
import argparse
import inspect
import json
import math
from pathlib import Path
from unicorn import x86_const as r
from vfx_camera_quad_native import NativeCameraQuad, CAMERA_CACHE, CAMERA_INPUT
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    n = NativeCameraQuad(args.cache / 'public/decoder-16.21-macos', args.client)
    cameras = [([1, 0, 0], [0, 1, 0]), ([0, 0, -1], [0, 1, 0]),
               ([1 / math.sqrt(2), 0, -1 / math.sqrt(2)],
                [1 / math.sqrt(6), 2 / math.sqrt(6), 1 / math.sqrt(6)])]
    cases = []
    for right, up in cameras:
        n.put(CAMERA_INPUT, 'fff', *up)
        n.put(CAMERA_INPUT + 0x10, 'fff', *right)
        n.call(0x1746290, {r.UC_X86_REG_RDI: CAMERA_CACHE + 0x158,
                          r.UC_X86_REG_RSI: CAMERA_INPUT,
                          r.UC_X86_REG_RDX: CAMERA_INPUT + 0x10})
        cases.append({'right': right, 'up': up,
                      'cacheHex': bytes(n.u.mem_read(CAMERA_CACHE + 0x170, 360 * 24)).hex()})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'build': n.profile['clientVersion'],
              'decoderImageSha256': n.profile['decoderImageSha256'], 'cases': cases,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalCacheBuilder': True, 'suppliedCameraAxes': True, 'matchCoverage': False}}
    output = args.cache / 'research/direct-camera-cache-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cameras': len(cases), 'angles': 360}))


if __name__ == '__main__':
    main()

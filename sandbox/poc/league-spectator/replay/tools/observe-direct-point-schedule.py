"""Run native point components with the direct runtime's explicit 60 Hz inputs."""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_point_quad_native import NativePointQuad
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--loaded', action='store_true')
    args = parser.parse_args()
    cache = args.cache.resolve()
    assets = cache / 'public'
    admission_bytes = (cache / 'research/direct-effects.json').read_bytes()
    admission = json.loads(admission_bytes)
    manifest_bytes = (assets / 'latest-effects/manifest.json').read_bytes()
    if admission['inputs']['effectsManifestSha256'] != sha(manifest_bytes):
        raise ValueError('Current direct component admission required')
    kind = 'loaded' if args.loaded else 'point'
    package_key = 'vfxLoadedQuadsSha256' if args.loaded else 'vfxPointQuadsSha256'
    n = (NativeLoadedQuad if args.loaded else NativePointQuad)(assets / 'decoder-16.21-macos', args.client)
    meta = n.checked_json('vfx-' + kind + '-quads.json', package_key)
    selected = {(definition['id'], index) for definition in admission['definitions'] for index in definition['supported']}
    requirements = {(d['id'], c['id']): c['placementRequirements']
                    for d in admission['definitions'] for c in d['components']}
    selected &= {(ref['effectId'], ref['emitterIndex']) for ref in meta['templates']}
    if not selected:
        raise ValueError('No direct point components selected for comparison')
    cases = []
    for identity in sorted(selected):
        matches = [ref for ref in meta['templates'] if (ref['effectId'], ref['emitterIndex']) == identity]
        if len(matches) != 1:
            raise ValueError('Selected component lacks its original point-quad graph: ' + repr(identity))
        ref = matches[0]
        graph_bytes = (assets / 'decoder-16.21-macos' / ref['file']).read_bytes()
        if sha(graph_bytes) != ref['sha256']:
            raise ValueError('Native schedule graph changed')
        seed = 0x12345
        n.reset_quad(json.loads(graph_bytes), seed, 0)
        if requirements[identity]['boundObjectSize'] == 0:
            n.call(0x1763fd0, {r.UC_X86_REG_RDI: A['system'], r.UC_X86_REG_XMM0: 0})
        bound_size = struct.unpack('<f', n.u.mem_read(A['system'] + 0x1cc, 4))[0]
        if bound_size != (0 if requirements[identity]['boundObjectSize'] == 0 else 1):
            raise ValueError('Supplied native component bound size differs')
        previous = [0, 0, 0]
        frames = []
        for tick in range(121):
            time = tick / 60
            current = [time * 130, time * 3, time * 70]
            inputs = {'time': time, 'previous': previous, 'current': current,
                      'boundObjectSize': bound_size,
                      'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                      'viewPosition': [0, 1000, 0]}
            frames.append({'input': inputs, 'output': n.frame_quad(inputs)})
            previous = current
        cases.append({'effectId': identity[0], 'emitterIndex': identity[1],
                      'graphSha256': ref['sha256'], 'seedHex': f'{seed:016x}', 'frames': frames})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'native-direct-' + kind + '-schedule-control',
              'build': meta['build'], 'protocol': meta['protocol'],
              'decoderImageSha256': n.profile['decoderImageSha256'],
              'quadPackageSha256': n.profile[package_key],
              'admissionSha256': sha(admission_bytes), 'manifestSha256': sha(manifest_bytes),
              'cases': cases, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalComponentUpdateAndGeometry': True, 'supplied60HzClock': True,
                        'suppliedMotionAndSeed': True, 'originalParentActivation': False,
                        'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / ('research/direct-' + kind + '-schedule-native.json')
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(cases),
                      'frames': sum(len(case['frames']) for case in cases)}))


if __name__ == '__main__':
    main()

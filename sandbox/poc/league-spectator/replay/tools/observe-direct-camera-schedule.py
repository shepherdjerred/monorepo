"""Run admitted camera components with persistent state and three views per tick."""
import argparse
import inspect
import json
import math
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_camera_quad_native import NativeCameraQuad
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    assets = cache / 'public'
    admission_bytes = (cache / 'research/direct-effects.json').read_bytes()
    admission = json.loads(admission_bytes)
    manifest_bytes = (assets / 'latest-effects/manifest.json').read_bytes()
    if admission['inputs']['effectsManifestSha256'] != sha(manifest_bytes):
        raise ValueError('Current direct component admission required')
    n = NativeCameraQuad(assets / 'decoder-16.21-macos', args.client)
    meta = n.checked_json('vfx-camera-quads.json', 'vfxCameraQuadsSha256')
    selected = {(d['id'], i) for d in admission['definitions'] for i in d['supported']}
    requirements = {(d['id'], c['id']): c['placementRequirements']
                    for d in admission['definitions'] for c in d['components']}
    cameras = [([1, 0, 0], [0, 1, 0], [0, 0, 1]),
               ([0, 0, -1], [0, 1, 0], [1, 0, 0]),
               ([1 / math.sqrt(2), 0, -1 / math.sqrt(2)],
                [1 / math.sqrt(6), 2 / math.sqrt(6), 1 / math.sqrt(6)],
                [1 / math.sqrt(3), -1 / math.sqrt(3), 1 / math.sqrt(3)])]
    cases = []
    for ref in meta['templates']:
        if (ref['effectId'], ref['emitterIndex']) not in selected:
            continue
        raw = (assets / 'decoder-16.21-macos' / ref['file']).read_bytes()
        if sha(raw) != ref['sha256']:
            raise ValueError('Native camera graph changed')
        seed = 0x12345
        n.reset_quad(json.loads(raw), seed, 0)
        identity = (ref['effectId'], ref['emitterIndex'])
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
            views = cameras if tick in [0, 1, 6, 30, 60, 120] else cameras[:1]
            for view, (right, up, axis) in enumerate(views):
                inp = {'time': time, 'previous': previous, 'current': current,
                       'boundObjectSize': bound_size,
                       'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                       'viewPosition': [0, 0, 1000],
                       'cameraRight': right, 'cameraUp': up, 'viewAxis': axis}
                inp['cameraViews'] = len(views)
                if view == 0:
                    output = n.frame_camera(inp)
                else:
                    n.camera_right, n.camera_up, n.view_axis = right, up, axis
                    output = {'state': state, 'geometry': n.render_quad(inp['viewPosition'])}
                if view == 0:
                    state = output['state']
                frames.append({'input': inp, 'output': output})
            previous = current
        cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                      'graphSha256': ref['sha256'], 'seedHex': f'{seed:016x}', 'frames': frames})
    if not cases:
        raise ValueError('No admitted camera components to compare')
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'native-direct-camera-schedule-control',
              'build': meta['build'], 'protocol': meta['protocol'],
              'decoderImageSha256': n.profile['decoderImageSha256'],
              'quadPackageSha256': n.profile['vfxCameraQuadsSha256'],
              'admissionSha256': sha(admission_bytes), 'manifestSha256': sha(manifest_bytes),
              'cases': cases, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalComponentUpdateAndGeometry': True, 'supplied60HzClock': True,
                        'cameraChangesWithoutSimulation': True, 'suppliedMotionAndSeed': True,
                        'originalParentActivation': False, 'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-camera-schedule-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(cases),
                      'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__':
    main()

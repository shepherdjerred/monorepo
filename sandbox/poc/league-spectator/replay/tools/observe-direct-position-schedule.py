"""Observe unchanged constant EmitterPosition components at two seeds and poses.

The original emitter update and quad writers execute. System clocks, moving
origins, world poses and random seeds are explicit component control inputs.
"""
import argparse
import inspect
import json
from pathlib import Path

from vfx_camera_quad_native import NativeCameraQuad
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    assets = cache / 'public'
    inputs = {}

    def raw(path):
        encoded = path.read_bytes()
        inputs[str(path)] = sha(encoded)
        return encoded

    raw_manifest = raw(assets / 'latest-effects/manifest.json')
    manifest = json.loads(raw_manifest)
    admission_raw = (cache / 'research/direct-effects.json').read_bytes()
    admission = json.loads(admission_raw)
    if admission['inputs']['effectsManifestSha256'] != sha(raw_manifest):
        raise ValueError('Current direct admission required')
    selected = {(d['id'], i) for d in admission['definitions'] for i in d['supported']}
    cases = []
    sources = {Path(__file__)}
    packages = {}
    for kind, cls, key in [('camera', NativeCameraQuad, 'vfxCameraQuadsSha256'),
                           ('loaded', NativeLoadedQuad, 'vfxLoadedQuadsSha256')]:
        n = cls(assets / 'decoder-16.21-macos', args.client)
        metadata_raw = raw(assets / 'decoder-16.21-macos' / ('vfx-' + kind + '-quads.json'))
        meta = n.checked_json('vfx-' + kind + '-quads.json', key)
        packages[kind] = sha(metadata_raw)
        sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
        for ref in meta['templates']:
            if (ref['effectId'], ref['emitterIndex']) not in selected:
                continue
            path = assets / 'latest-effects' / manifest['definitions'][ref['effectId']]['file']
            encoded = raw(path)
            if sha(encoded) != ref['sourceDefinitionSha256']:
                raise ValueError('Native position authored definition changed')
            emitter = json.loads(encoded)['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
            offset = emitter.get('EmitterPosition')
            if offset is None:
                continue
            if not isinstance(offset, dict) or set(offset) != {'__type', 'constantValue'} or offset['__type'] != 'ValueVector3':
                raise ValueError('Selected offset is not the admitted constant vector')
            graph_raw = raw(assets / 'decoder-16.21-macos' / ref['file'])
            if sha(graph_raw) != ref['sha256']:
                raise ValueError('Native position graph changed')
            for seed in [1, 0x12345]:
                for pose, basis in [
                    ('identity', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
                    ('yaw90', [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]),
                    ('pitch90', [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]),
                    ('changing', None),
                ]:
                    n.reset_quad(json.loads(graph_raw), seed, 0)
                    frames = []
                    previous = [0, 0, 0]
                    for tick in range(121):
                        time = tick / 60
                        current = [time * 130, time * 3, time * 70]
                        frame_basis = basis if basis is not None else (
                            [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] if 30 <= tick < 90 else
                            [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
                        frame = {'time': time, 'previous': previous, 'current': current,
                                 'basis': frame_basis, 'viewPosition': [0, 0, 1000],
                                 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1]}
                        out = n.frame_camera(frame) if kind == 'camera' else n.frame_quad(frame)
                        frames.append({'input': frame, 'output': out})
                        previous = current
                    cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                                  'primitiveKind': kind, 'pose': pose, 'offset': offset,
                                  'graphSha256': ref['sha256'], 'seedHex': f'{seed:016x}', 'frames': frames})
    if not cases:
        raise ValueError('No admitted position component')
    report = {'schema': 1, 'kind': 'native-direct-position-schedule-control',
              'build': meta['build'], 'protocol': meta['protocol'],
              'decoderImageSha256': n.profile['decoderImageSha256'],
              'packages': packages, 'cases': cases, 'manifestSha256': sha(raw_manifest),
              'admissionSha256': sha(admission_raw),
              'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'scope': {'unchangedLoadedEmitters': True, 'suppliedPoseMotionSeedAndClock': True,
                        'originalParentActivation': False, 'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-position-schedule-native.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len({(c['effectId'], c['emitterIndex']) for c in cases}), 'cases': len(cases),
                      'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__':
    main()

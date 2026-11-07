"""Observe authored constant emitter offsets under explicit original system poses."""
import argparse
import inspect
import json
import struct
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
    raw_manifest = (assets / 'latest-effects/manifest.json').read_bytes()
    manifest = json.loads(raw_manifest)
    cases = []
    inputs = {}
    sources = {Path(__file__)}
    for kind, cls, key in [('camera', NativeCameraQuad, 'vfxCameraQuadsSha256'),
                           ('loaded', NativeLoadedQuad, 'vfxLoadedQuadsSha256')]:
        n = cls(assets / 'decoder-16.21-macos', args.client)
        meta = n.checked_json('vfx-' + kind + '-quads.json', key)
        sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
        for ref in meta['templates']:
            path = assets / 'latest-effects' / manifest['definitions'][ref['effectId']]['file']
            encoded = path.read_bytes()
            inputs[str(path)] = sha(encoded)
            if sha(encoded) != ref['sourceDefinitionSha256']:
                raise ValueError('Native offset authored definition changed')
            emitter = json.loads(encoded)['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
            offset = emitter.get('EmitterPosition')
            if not isinstance(offset, dict) or set(offset) != {'__type', 'constantValue'} or offset['__type'] != 'ValueVector3':
                continue
            if ref['effectId'] not in ['champions/karthus/10/ce863744', 'champions/jinx/2/30f9e0b8']:
                continue
            graph_path = assets / 'decoder-16.21-macos' / ref['file']
            graph_raw = graph_path.read_bytes()
            inputs[str(graph_path)] = sha(graph_raw)
            if sha(graph_raw) != ref['sha256']:
                raise ValueError('Native offset graph changed')
            for pose, basis in [
                ('identity', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
                ('yaw90', [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]),
            ]:
                n.reset_quad(json.loads(graph_raw), 0x12345, 0)
                frames = []
                for tick in range(4):
                    t = tick / 60
                    frame = {'time': t, 'previous': [0, 0, 0], 'current': [0, 0, 0],
                             'basis': basis, 'viewPosition': [0, 0, 1000],
                             'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1]}
                    out = n.frame_camera(frame) if kind == 'camera' else n.frame_quad(frame)
                    data = bytes.fromhex(out['geometry']['verticesHex'])
                    points = [struct.unpack_from('<fff', data, i) for i in range(0, len(data), 28)]
                    frames.append({'input': frame, 'output': out,
                                   'center': [sum(p[i] for p in points) / len(points) for i in range(3)] if points else None})
                cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                              'kind': kind, 'pose': pose, 'offset': offset, 'frames': frames})
    report = {'schema': 1, 'cases': cases, 'manifestSha256': sha(raw_manifest),
              'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'scope': {'unchangedLoadedEmitters': True, 'suppliedPoseAndClock': True,
                        'matchActivation': False}}
    output = cache / 'research/direct-emitter-position-probe.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': [{k: v for k, v in c.items() if k != 'frames'} | {
        'centers': [f['center'] for f in c['frames']]} for c in cases]}))


if __name__ == '__main__':
    main()

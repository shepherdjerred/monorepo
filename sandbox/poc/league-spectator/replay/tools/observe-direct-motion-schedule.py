"""Observe original near-admitted quad motion without projecting native fields.

Select components by shared remaining motion dependencies, independently of
champion/definition IDs. Supplied clocks, seeds, root motion and poses remain
component controls. This observer does not change compiler/runtime admission.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

from vfx_camera_quad_native import NativeCameraQuad
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha, field_layout


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

    manifest_raw = raw(assets / 'latest-effects/manifest.json')
    manifest = json.loads(manifest_raw)
    admission_raw = (cache / 'research/direct-effects.json').read_bytes()
    admission = json.loads(admission_raw)
    if admission['inputs']['effectsManifestSha256'] != sha(manifest_raw):
        raise ValueError('Current direct admission required')
    reasons = {'field:birthVelocity', 'field:worldAcceleration'}
    selection = {(d['id'], e['index']) for d in admission['definitions'] for e in d['unsupported']
                 if isinstance(e['index'], int) and e['reasons'] and set(e['reasons']) <= reasons}
    default_arbitrary = False
    for d in admission['definitions']:
        ref = manifest['definitions'][d['id']]
        record = json.loads(raw(assets / 'latest-effects' / ref['file']))
        for index in d['supported']:
            source = record['definition']['complexEmitterDefinitionData'][index]
            primitive = source.get('primitive', {}).get('__type')
            if 'birthVelocity' in source:
                selection.add((d['id'], index))
            if primitive == 'VfxPrimitiveArbitraryQuad':
                if source.get('isLocalOrientation') in [0, False]:
                    selection.add((d['id'], index))
                elif 'isLocalOrientation' not in source and not default_arbitrary:
                    selection.add((d['id'], index))
                    default_arbitrary = True
    cases = []
    sources = {Path(__file__)}
    packages = {}
    for kind, cls, key in [('camera', NativeCameraQuad, 'vfxCameraQuadsSha256'),
                           ('loaded', NativeLoadedQuad, 'vfxLoadedQuadsSha256')]:
        n = cls(assets / 'decoder-16.21-macos', args.client)
        registration = field_layout(n.source.image)['isLocalOrientation']
        if registration['offset'] != 0x2d0 or registration['mask'] != 0x200000:
            raise ValueError('Original orientation property registration changed')
        default_code = n.source.image[0x1700202:0x170020c]
        if default_code != bytes.fromhex('c783d002000000202000'):
            raise ValueError('Original emitter orientation constructor default changed')
        metadata_raw = raw(assets / 'decoder-16.21-macos' / ('vfx-' + kind + '-quads.json'))
        meta = n.checked_json('vfx-' + kind + '-quads.json', key)
        packages[kind] = sha(metadata_raw)
        sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
        for ref in meta['templates']:
            if (ref['effectId'], ref['emitterIndex']) not in selection:
                continue
            path = assets / 'latest-effects' / manifest['definitions'][ref['effectId']]['file']
            encoded = raw(path)
            if sha(encoded) != ref['sourceDefinitionSha256']:
                raise ValueError('Native motion authored definition changed')
            emitter = json.loads(encoded)['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
            graph_raw = raw(assets / 'decoder-16.21-macos' / ref['file'])
            if sha(graph_raw) != ref['sha256']:
                raise ValueError('Native motion graph changed')
            graph = json.loads(graph_raw)
            native_flags = struct.unpack_from('<I', bytes.fromhex(graph['assetObjectHex']), 0x2d0)[0]
            inherited = bool(native_flags & 0x200000)
            if inherited != (emitter.get('isLocalOrientation', True) not in [False, 0]):
                raise ValueError('Native loaded orientation flag differs from authored/default policy')
            for seed in [1, 0x12345]:
                for pose in ['identity', 'yaw90', 'pitch90', 'changing']:
                    n.reset_quad(json.loads(graph_raw), seed, 0)
                    previous = [0, 0, 0]
                    frames = []
                    for tick in range(121):
                        time = tick / 60
                        current = [time * 130, time * 3, time * 70]
                        rotated = pose == 'yaw90' or pose == 'changing' and 30 <= tick < 90
                        basis = ([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] if rotated else
                                 [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
                        if pose == 'pitch90':
                            basis = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
                        frame = {'time': time, 'previous': previous, 'current': current,
                                 'basis': basis, 'viewPosition': [0, 0, 1000],
                                 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1]}
                        output = n.frame_camera(frame) if kind == 'camera' else n.frame_quad(frame)
                        for birth in output['state']['births']:
                            expected_basis = basis if inherited else [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
                            actual_basis = list(struct.unpack_from('<16f', bytes.fromhex(birth['birthHex'])))
                            # The final column separately retains its moving
                            # birth origin; this check verifies orientation.
                            if any(actual_basis[i] != expected_basis[i] for i in [0, 1, 2, 4, 5, 6, 8, 9, 10]):
                                raise ValueError('Original birth did not retain the admitted orientation basis')
                        packed = bytes.fromhex(output['geometry']['verticesHex'])
                        points = [struct.unpack_from('<fff', packed, i) for i in range(0, len(packed), 28)]
                        centers = [[sum(p[lane] for p in points[i:i+4]) / 4 for lane in range(3)]
                                   for i in range(0, len(points), 4)]
                        frames.append({'input': frame, 'output': output, 'centers': centers})
                        previous = current
                    cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                                  'primitiveKind': kind, 'pose': pose, 'emitter': emitter,
                                  'nativeEmitterFlags': native_flags, 'nativeInheritedBasis': inherited,
                                  'graphSha256': ref['sha256'], 'seedHex': f'{seed:016x}', 'frames': frames})
    observed = {(c['effectId'], c['emitterIndex']) for c in cases}
    if observed != selection:
        raise ValueError('Selected motion components lack original native graphs: ' + repr(selection - observed))
    report = {'schema': 1, 'kind': 'native-direct-motion-schedule-control',
              'build': meta['build'], 'protocol': meta['protocol'],
              'decoderImageSha256': n.profile['decoderImageSha256'], 'packages': packages,
              'manifestSha256': sha(manifest_raw), 'admissionSha256': sha(admission_raw),
              'orientationRegistration': registration,
              'constructorDefault': {'instructionRva': 0x1700202, 'bytesHex': default_code.hex(), 'flags': 0x202000},
              'cases': cases, 'inputs': inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'scope': {'unchangedNativeEmitterGraphs': True, 'suppliedClockSeedMotionAndPose': True,
                        'compilerAdmissionChanged': False, 'nativeParentActivation': False,
                        'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-motion-schedule-native.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(observed), 'cases': len(cases),
                      'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__':
    main()

"""Observe unchanged ground-layer quad geometry with supplied poses/clocks."""
import argparse
import inspect
import json
from pathlib import Path

from vfx_camera_quad_native import NativeCameraQuad
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha, ADDRESSES as A


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
    selection = json.loads(raw(cache / 'research/direct-ground-layer-native.json'))
    for name, digest in selection['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError('Native absent blend default producer changed')
    selected = {(c['effectId'], c['emitterIndex']) for c in selection['cases']}
    prior_selected = set(selected)
    # Preserve the complete prior cohort and add every admitted authored
    # navigation-ground quad. Shader/resource acquisition is a separate proof.
    admission = json.loads(raw(cache / 'research/direct-effects.json'))
    for definition in admission['definitions']:
        if not definition['supported']:
            continue
        ref = manifest['definitions'][definition['id']]
        encoded = raw(assets / 'latest-effects' / ref['file'])
        if sha(encoded) != ref['sha256']:
            raise ValueError('Current admitted original definition differs')
        authored = json.loads(encoded)['definition']['complexEmitterDefinitionData']
        for index in definition['supported']:
            source = authored[index]
            if (source.get('useNavmeshMask') in [1, True]
                    and source.get('isGroundLayer') in [1, True]
                    and source.get('primitive', {}).get('__type') in ['VfxPrimitiveArbitraryQuad', 'VfxPrimitiveCameraQuad']):
                selected.add((definition['id'], index))
    cases, packages = [], {}
    sources = {Path(__file__)}
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
            encoded = raw(assets / 'latest-effects' / manifest['definitions'][ref['effectId']]['file'])
            if sha(encoded) != ref['sourceDefinitionSha256']:
                raise ValueError('Native blend authored definition changed')
            emitter = json.loads(encoded)['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
            if emitter.get('isGroundLayer') not in [1, True]:
                raise ValueError('Ground observer requires an unchanged authored ground flag')
            graph_raw = raw(assets / 'decoder-16.21-macos' / ref['file'])
            if sha(graph_raw) != ref['sha256']:
                raise ValueError('Native blend graph changed')
            for seed in [1, 0x12345]:
                for pose, basis in [
                    ('identity', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
                    ('yaw90', [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]),
                    ('pitch90', [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]),
                ]:
                    n.reset_quad(json.loads(graph_raw), seed, 0)
                    frames, previous = [], [0, 0, 0]
                    for tick in range(121):
                        time = tick / 60
                        current = [time * 130, time * 3, time * 70]
                        frame = {'time': time, 'previous': previous, 'current': current,
                                 'basis': basis, 'viewPosition': [0, 0, 1000],
                                 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1]}
                        out = n.frame_camera(frame) if kind == 'camera' else n.frame_quad(frame)
                        frames.append({'input': frame, 'output': out})
                        previous = current
                    # A separate supplied control clears only the typed ground
                    # flag after the identical original runtime initialization.
                    # Compare complete frame outputs, not only draw positions.
                    n.reset_quad(json.loads(graph_raw), seed, 0)
                    before_flag = n.u.mem_read(A['definition'] + 0x2d1, 1)[0]
                    if not before_flag & 0x10:
                        raise ValueError('Original ground graph flag is not present')
                    n.put(A['definition'] + 0x2d1, 'B', before_flag & ~0x10)
                    for frame in frames:
                        out = n.frame_camera(frame['input']) if kind == 'camera' else n.frame_quad(frame['input'])
                        if out != frame['output']:
                            raise ValueError('Ground flag changes native geometry/pool/RNG output')
                    cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                                  'primitiveKind': kind, 'pose': pose,
                                  'graphSha256': ref['sha256'], 'seedHex': f'{seed:016x}', 'frames': frames,
                                  'groundFlagDifferential': {'typedByteOffset': 0x2d1, 'mask': 0x10,
                                      'controlClearsOnlyThisFlagAfterReset': True, 'comparedFrames': len(frames),
                                      'completeFrameOutputsEqual': True}})
            print(json.dumps({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                              'primitiveKind': kind, 'cases': 6}), flush=True)
    observed = {(c['effectId'], c['emitterIndex']) for c in cases}
    if observed != selected:
        raise ValueError('Absent blend native templates differ from selected component inventory')
    report = {'schema': 1, 'kind': 'native-direct-ground-layer-schedule-control',
              'build': meta['build'], 'protocol': meta['protocol'],
              'decoderImageSha256': n.profile['decoderImageSha256'],
              'packages': packages, 'cases': cases, 'manifestSha256': sha(raw_manifest),
              'cohortExpansion': {'priorComponents': len(prior_selected), 'currentComponents': len(selected),
                                  'added': [{'effectId': e, 'emitterIndex': i} for e, i in sorted(selected - prior_selected)]},
              'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'scope': {'unchangedLoadedEmitters': True, 'suppliedPoseMotionSeedAndClock': True,
                        'originalParentActivation': False, 'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-ground-schedule-native.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(observed), 'cases': len(cases),
                      'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__':
    main()

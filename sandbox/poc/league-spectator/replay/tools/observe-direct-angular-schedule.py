"""Observe unchanged loaded quads with authored birth rotational velocity.

Selection comes from the exact authored field, independently of JS admission.
Clocks, root motion and seeds are supplied component controls, not match state.
"""
import argparse
import inspect
import json
from pathlib import Path
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

    manifest_bytes = raw(assets / 'latest-effects/manifest.json')
    manifest = json.loads(manifest_bytes)
    n = NativeLoadedQuad(assets / 'decoder-16.21-macos', args.client)
    meta = n.checked_json('vfx-loaded-quads.json', 'vfxLoadedQuadsSha256')
    cases = []
    selected = []
    for ref in meta['templates']:
        definition_ref = manifest['definitions'][ref['effectId']]
        encoded = raw(assets / 'latest-effects' / definition_ref['file'])
        if sha(encoded) != ref['sourceDefinitionSha256'] or sha(encoded) != definition_ref['sha256']:
            raise ValueError('Angular component source definition changed')
        definition = json.loads(encoded)['definition']
        emitter = definition['complexEmitterDefinitionData'][ref['emitterIndex']]
        angular = emitter.get('birthRotationalVelocity0')
        if angular is None:
            continue
        # This first capability isolates constant angular birth values. A curve
        # has additional clocks and RNG draws and remains a separate behavior.
        if (set(angular) != {'__type', 'constantValue'} or angular['__type'] != 'ValueVector3' or
                not isinstance(angular['constantValue'], list) or len(angular['constantValue']) != 3):
            continue
        selected.append((ref, emitter))
    if not selected:
        raise ValueError('No unchanged loaded constant-angular components available')
    for ref, emitter in selected:
        graph_bytes = raw(assets / 'decoder-16.21-macos' / ref['file'])
        if sha(graph_bytes) != ref['sha256']:
            raise ValueError('Original angular component graph changed')
        for seed in [1, 0x12345]:
            n.reset_quad(json.loads(graph_bytes), seed, 0)
            previous = [0, 0, 0]
            frames = []
            for tick in range(121):
                time = tick / 60
                current = [time * 130, time * 3, time * 70]
                frame = {'time': time, 'previous': previous, 'current': current,
                         'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                         'viewPosition': [0, 1000, 0]}
                frames.append({'input': frame, 'output': n.frame_quad(frame)})
                previous = current
            cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                          'graphSha256': ref['sha256'], 'seedHex': f'{seed:016x}',
                          'angular': emitter['birthRotationalVelocity0'], 'frames': frames})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'native-direct-angular-schedule-control',
              'build': meta['build'], 'protocol': meta['protocol'],
              'decoderImageSha256': n.profile['decoderImageSha256'],
              'quadPackageSha256': n.profile['vfxLoadedQuadsSha256'],
              'manifestSha256': sha(manifest_bytes), 'cases': cases,
              'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'unchangedLoadedEmitters': True, 'supplied60HzClockMotionAndSeed': True,
                        'parentActivation': False, 'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-angular-schedule-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(selected), 'cases': len(cases),
                      'frames': sum(len(case['frames']) for case in cases)}))


if __name__ == '__main__':
    main()

"""Original unchanged camera-navigation emitter with supplied clocks and views.

This is a bounded component oracle. Material acquisition/pass eligibility and
same-time navigation scene ownership have separate controls.
"""
import argparse
import inspect
import json
import math
from pathlib import Path
from vfx_camera_quad_native import NativeCameraQuad
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
        path = Path(path).resolve()
        value = path.read_bytes()
        digest = sha(value)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Camera navigation oracle input drift')
        inputs[str(path)] = digest
        return value

    manifest_bytes = raw(assets / 'latest-effects/manifest.json')
    manifest = json.loads(manifest_bytes)
    n = NativeCameraQuad(assets / 'decoder-16.21-macos', args.client)
    raw(args.client)
    raw(assets / 'decoder-16.21-macos/profile.json')
    raw(assets / 'decoder-16.21-macos/image.bin')
    metadata = n.checked_json('vfx-camera-quads.json', 'vfxCameraQuadsSha256')
    raw(assets / 'decoder-16.21-macos/vfx-camera-quads.json')
    effect, index = 'champions/karthus/10/8ad0cea5', 7
    refs = [r for r in metadata['templates'] if r['effectId'] == effect and r['emitterIndex'] == index]
    if len(refs) != 1:
        raise ValueError('One original camera emitter required')
    ref = refs[0]
    definition = raw(assets / 'latest-effects' / manifest['definitions'][effect]['file'])
    graph = raw(assets / 'decoder-16.21-macos' / ref['file'])
    if sha(definition) != ref['sourceDefinitionSha256'] or sha(graph) != ref['sha256']:
        raise ValueError('Original unchanged camera source/graph differs')
    source = json.loads(definition)['definition']['complexEmitterDefinitionData'][index]
    if source.get('primitive', {}).get('__type') not in [None, 'VfxPrimitiveCameraQuad'] or source.get('useNavmeshMask') != 1:
        raise ValueError('Authored camera navigation source required')
    cameras = [([1, 0, 0], [0, 1, 0], [0, 0, 1]),
               ([0, 0, -1], [0, 1, 0], [1, 0, 0]),
               ([1 / math.sqrt(2), 0, -1 / math.sqrt(2)],
                [1 / math.sqrt(6), 2 / math.sqrt(6), 1 / math.sqrt(6)],
                [1 / math.sqrt(3), -1 / math.sqrt(3), 1 / math.sqrt(3)])]
    cases = []
    for speed in [1, 4]:
        for seed in [1, 0x12345]:
            n.reset_quad(json.loads(graph), seed, 0)
            previous = [0, 0, 0]
            frames = []
            for tick in range(121):
                time = tick / 60
                current = [time * 130, time * 3, time * 70]
                capture = tick % speed == 0
                views = cameras if capture and tick in [0, speed, 6 * speed, 15 * speed, 30 * speed] else cameras[:1]
                state = None
                for view, (right, up, axis) in enumerate(views):
                    frame = dict(time=time, previous=previous, current=current,
                                 basis=[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                                 viewPosition=[0, 0, 1000], cameraRight=right, cameraUp=up, viewAxis=axis)
                    if view == 0:
                        output = n.frame_camera(frame)
                        state = output['state']
                    else:
                        n.camera_right, n.camera_up, n.view_axis = right, up, axis
                        output = dict(state=state, geometry=n.render_quad(frame['viewPosition']))
                    if capture:
                        frames.append(dict(input=frame, output=output, cameraOnly=view != 0))
                previous = current
            cases.append(dict(effectId=effect, emitterIndex=index, graphSha256=ref['sha256'],
                              sourceDefinitionSha256=ref['sourceDefinitionSha256'], seedHex=f'{seed:016x}',
                              speed=speed, frames=frames))
    for cls in type(n).__mro__:
        if cls is not object:
            raw(inspect.getfile(cls))
    raw(__file__)
    result = dict(schema=1, kind='original-camera-navigation-emitter-schedule-controls',
                  build=manifest['build'], protocol=manifest['protocol'], decoderImageSha256=sha(n.image),
                  inputs=inputs, originalBlocks=list(n.blocks.values()), cases=cases,
                  scope=dict(unchangedOriginalEmitter=True, suppliedClocksSeedsMotion=True,
                             originalComponentSimulationAndGeometry=True, cameraOnlyWithoutSimulation=True,
                             originalParentActivation=False, gpuDrawSubmitted=False, matchFidelityClaim=False))
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Camera navigation oracle final input drift')
    output = cache / 'research/direct-nav-camera-schedule-native-v37.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(dict(output=str(output), cases=len(cases), frames=sum(len(c['frames']) for c in cases))))


if __name__ == '__main__':
    main()

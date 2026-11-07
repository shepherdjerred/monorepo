"""Original palette UVs and exact prepared shaders, isolated diagnostic raster.

The zero-coordinate draw is a counterexample control, never a runtime fallback.
Each sample is independently framed. This does not show match playback.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import numpy as np
from PIL import Image, ImageDraw
from offscreen_direct_batch import DirectBatchDraw, adapter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    assets = cache / 'public'

    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = adapter.sha(data)
        return data

    def read(path):
        return json.loads(raw(path))

    proof = read(cache / 'research/direct-particle-palette-comparison.json')
    if (proof['kind'] != 'default-native-particle-palette-coordinate-comparison' or
            proof['differences'] or proof['frames'] != 488 or
            proof['controllerInputs'] != 128 or proof['arithmeticAndHalfControls'] != 67):
        raise ValueError('Complete native coordinate and packing proof required')
    for path, digest in proof['inputs'].items():
        if adapter.sha(raw(Path(path))) != digest:
            raise ValueError('Palette coordinate input drift')
    native = read(cache / 'research/direct-particle-palette-native.json')
    package = read(assets / 'latest-complete-quad-gpu/package.json')
    identities = [('champions/karthus/10/fde333aa', 0), ('champions/jinx/2/953aab68', 1),
                  ('champions/maokai/3/b9d05a01', 0), ('champions/maokai/3/99dd2080', 0)]
    sheet = Image.new('RGBA', (3 * 256, len(identities) * 280), (6, 9, 14, 255))
    labels = ImageDraw.Draw(sheet)
    renderer = DirectBatchDraw(args.angle)
    results = []
    try:
        for row, identity in enumerate(identities):
            effect_id, emitter_index = identity
            selected = [value for value in package['emitters']
                        if (value['effectId'], value['emitterIndex']) == identity]
            if len(selected) != 1:
                raise ValueError('One exact prepared native material required')
            binding = selected[0]
            material = next(value for value in native['materials']
                            if (value['effectId'], value['emitterIndex']) == identity)
            selection = next(value for value in native['selections']
                             if (value['effectId'], value['emitterIndex']) == identity)
            if (binding['sourceDefinitionSha256'] != material['sourceDefinitionSha256'] or
                    binding['graphSha256'] != material['graphSha256'] or
                    binding['environment'] != selection['environment'] or
                    binding['nativeDefines'] != selection['renderState']['defines'] or
                    binding['nativeRenderStateHex'] != selection['renderState']['bytesHex']):
                raise ValueError('Prepared binding differs from fresh original material execution')
            if binding['shaders']['pixel']['sha256'] != '66fb44fe736a476b8b3676a855f41b460d423c324423b46bcd6671eca07c8574':
                raise ValueError('Exact palette/alpha-test shader required')
            stages = []
            for stage in ['vertex', 'pixel']:
                ref = binding['shaders'][stage]
                path = assets / 'latest-shaders' / ref['file']
                shader = read(path)
                if inputs[str(path.resolve())] != ref['sha256']:
                    raise ValueError('Prepared shader differs')
                stages.append(shader)
            program = renderer.program(*stages)
            try:
                textures = {}
                for shader in stages:
                    for texture in shader['sidecar']['textures']:
                        resources = [binding['textures'][sampler['glslName']] for sampler in texture['samplers']]
                        if not resources or any(value != resources[0] for value in resources):
                            raise ValueError('Original reflected resource alias differs')
                        resource = resources[0]
                        if resource['kind'] == 'prepared-texture':
                            path = assets / 'latest-effects' / resource['file']
                            if adapter.sha(raw(path)) != resource['sha256']:
                                raise ValueError('Exact installed texture bytes required')
                            pixels = np.array(Image.open(path).convert('RGBA'))
                            address = resource['sampler']['name']
                            filtering = 'nearest' if resource['sampler']['pixelated'] else 'linear'
                        elif resource['kind'] == 'supplied-transparent-remap':
                            pixels, address, filtering = np.zeros((1, 1, 4), dtype=np.uint8), 'clamp', 'nearest'
                        else:
                            raise ValueError('No fabricated palette/resource fallback')
                        textures[texture['name']] = renderer.texture(pixels, address, filtering)
                case = next(value for value in native['cases']
                            if (value['effectId'], value['emitterIndex']) == identity and
                            value['variant'] == 'authored' and value['seedHex'] == '0000000000012345')
                ticks = [2, 3, 5] if effect_id.startswith('champions/maokai/') else [6, 12, 18]
                for column, tick in enumerate(ticks):
                    frame = case['frames'][tick]
                    vertices = bytes.fromhex(frame['output']['geometry']['verticesHex'])
                    indices = bytes.fromhex(frame['output']['geometry']['indicesHex'])
                    points = np.array([struct.unpack_from('<3f', vertices, offset) for offset in range(0, len(vertices), 28)])
                    low, high = points.min(0), points.max(0)
                    axes = np.argsort(high - low)[-2:]
                    center = (low + high) / 2
                    extent = max((high - low)[axes]) * .6
                    if not extent > 0:
                        raise ValueError('Nondegenerate original palette geometry required')
                    projection = np.zeros((4, 4))
                    projection[0, axes[0]] = projection[1, axes[1]] = 1 / extent
                    projection[0, 3], projection[1, 3] = -center[axes[0]] / extent, -center[axes[1]] / extent
                    projection[2, 3] = .5
                    projection[3, 3] = 1
                    uniforms = {}
                    for shader in stages:
                        for block in shader['sidecar']['blocks']:
                            data = bytes.fromhex(next(value for value in binding['blocks'] if value['glslName'] == block['glslName'])['bytesHex'])
                            for member in block['members']:
                                if not member['used']:
                                    continue
                                value = (projection.flatten().tolist() if member['name'] == 'mProj' else [0, 1000, 0]
                                         if member['name'] == 'vCamera' else list(struct.unpack_from('<' +
                                         {'float': 'f', 'uint': 'I', 'int': 'i', 'bool': 'I'}[member['scalar']] *
                                         (member['size'] // 4), data, member['offset'])))
                                uniforms[block['glslName'] + '.' + member['name']] = value
                    factors = binding['nativeBlendFactors']
                    if factors[0] != factors[1] or factors[2] != factors[3]:
                        raise ValueError('Separate alpha adapter required')
                    mapping = {1: 1, 6: 0x302, 7: 0x303}
                    blend = mapping[factors[0]], mapping[factors[2]]
                    rgba, _ = renderer.draw(program, stages, vertices, indices, uniforms, textures, blend=blend)
                    bad = bytearray(vertices)
                    for offset in range(0, len(bad), 28):
                        bad[offset + 24:offset + 28] = bytes(4)
                    zero, _ = renderer.draw(program, stages, bytes(bad), indices, uniforms, textures, blend=blend)
                    visible = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
                    changed = int(np.count_nonzero(np.any(rgba != zero, axis=2)))
                    if not visible or (row == 1 and not changed) or (row == 0 and changed):
                        raise ValueError('Palette raster/zero-coordinate counterexample failed')
                    sheet.paste(Image.fromarray(rgba).resize((256, 256)), (column * 256, row * 280))
                    labels.text((column * 256 + 5, row * 280 + 258), f'{effect_id.split("/")[1]} {effect_id.split("/")[-1]} t={frame["input"]["time"]:.3f}', fill='white')
                    results.append({'effectId': effect_id, 'emitterIndex': emitter_index, 'time': frame['input']['time'],
                                    'visiblePixels': visible, 'zeroCoordinateCounterexamplePixels': changed,
                                    'rgbaSha256': adapter.sha(rgba.tobytes())})
            finally:
                renderer.gl.glDeleteProgram(program)
    finally:
        renderer.close()
    for path in [Path(__file__), Path(inspect.getfile(DirectBatchDraw)), Path(adapter.__file__), Path(adapter.adapter.__file__),
                 args.angle / 'libEGL.dll', args.angle / 'libGLESv2.dll']:
        raw(path)
    image = cache / 'visuals/direct-particle-palette-components.png'
    sheet.save(image)
    for path, digest in inputs.items():
        if adapter.sha(Path(path).read_bytes()) != digest:
            raise ValueError('Final palette raster input drift')
    output = cache / 'research/direct-particle-palette-rendering.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'native-particle-palette-isolated-raster-proof', 'inputs': inputs,
                                 'image': str(image), 'imageSha256': adapter.sha(image.read_bytes()), 'draws': results,
                                 'scope': {'nativeGeometry': True, 'exactPreparedNativeMaterial': True,
                                           'independentlyFramedSamples': True, 'zeroCoordinateControlIsCounterexampleOnly': True,
                                           'runtimeAdmissionChanged': False, 'actualMatchPlayback': False,
                                           'browserExecuted': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'image': str(image), 'nativeDraws': len(results), 'counterexampleDraws': len(results)}))


if __name__ == '__main__':
    main()

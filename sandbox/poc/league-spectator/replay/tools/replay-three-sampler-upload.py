"""Replay actual THREE sampler uploads against the selected original mesh draw.

The historical replay supplies geometry/UBOs only; it is not current playback
acceptance. Shader, sampler commands and texture bytes are the current owned
static renderer's exports. No texture or shader substitution is permitted.
"""
import argparse
import ctypes as C
import inspect
import json
from pathlib import Path

import numpy as np
from PIL import Image

from offscreen_static_mesh import StaticMeshDraw, adapter
from graphics_pipeline_device import GraphicsPipelineDevice


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = adapter.sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Sampler proof source changed during capture')
        inputs[str(path)] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    commands_path = cache/'research/direct-three-sampler-upload-commands-v33.json'
    commands = read(commands_path)
    proof = read(cache/'research/direct-three-sampler-upload-v33.json')
    if adapter.sha(raw(commands_path)) != proof['commandSha256']:
        raise ValueError('Actual THREE command export digest mismatch')
    for path, digest in proof['inputs'].items():
        if adapter.sha(raw(path)) != digest:
            raise ValueError('Current THREE upload proof source changed: '+path)
    worker_path = cache/'research/shared-direct-playback-worker-v32-final.json'
    worker = read(worker_path)
    frames = read(cache/'research/shared-v32-comparable-static-mesh-frame-bindings.json')
    source_worker_pins = [digest for path, digest in frames['inputs'].items()
                          if Path(path).name == 'shared-direct-playback-worker.json']
    if source_worker_pins != [adapter.sha(raw(worker_path))]:
        raise ValueError('Historical draw bindings must pin the exact immutable worker fixture')
    metadata = next(p for p in worker['staticMeshPrograms'] if p['materialKey'] == commands['materialKey'])
    package = read(cache/'public/latest-direct-static-mesh-materials/package.json')
    emitter = next(e for e in package['emitters'] if
                   (e['effectId'], e['emitterIndex']) == (metadata['definitionId'], metadata['emitterId']))
    selection = metadata['meshMaterialSelection']
    variant = next(r for r in emitter['rows'] if r['hash'] == selection['passHash'])['variants'][selection['variantIndex']]

    def resource(ref):
        data = raw(cache/'public/latest-direct-static-mesh-materials'/ref['file'])
        if len(data) != ref['bytes'] or adapter.sha(data) != ref['sha256']:
            raise ValueError('Selected original mesh resource changed')
        return data

    stages = [json.loads(resource(variant['shaders'][s])) for s in ['vertex', 'pixel']]
    shader_pair = [s['glsl'] for s in stages]
    if commands['shaders'] != shader_pair or adapter.sha(('\0'.join(shader_pair)).encode()) != commands['shaderPairSha256']:
        raise ValueError('Actual upload export must use the exact selected original shader pair')
    vertices = resource(emitter['mesh']['vertices'])
    if adapter.sha(vertices) != selection['vertexSha256']:
        raise ValueError('Selected original mesh geometry differs')
    indices = np.arange(len(vertices)//36, dtype='<u2').tobytes()
    chosen_frame, chosen_draw = next((frame, draw) for frame in frames['frames'] for draw in frame['draws']
                                    if draw['materialKey'] == commands['materialKey'] and draw['particleCount'] == 1)
    matching_draws = [draw for frame in worker['snapshots'] if frame['time'] == chosen_frame['time']
                     for draw in frame['draws'] if (draw['sourceEventId'], draw['generation'], draw['materialKey']) ==
                     (chosen_draw['sourceEventId'], chosen_draw['generation'], chosen_draw['materialKey'])]
    if len(matching_draws) != 1 or matching_draws[0]['particleCount'] != chosen_draw['particleCount']:
        raise ValueError('Exact historical worker draw identity required')
    blocks = [{**b, 'bytes': bytes.fromhex(b['bytesHex'])} for b in chosen_draw['particles'][0]['uniformBlocks']]
    original_textures = {t['name']: resource(t['levels'][0][0]) for t in variant['textures']}
    current_textures = {t['id']: t for t in commands['textures']}
    fixed = next(c for c in commands['cases'] if c['label'] == 'actual-fixed-renderer-keys')
    fixed_assignments = {a['name']: a for a in fixed['assignments']}
    for renamed in commands['renamed']:
        texture = current_textures[fixed_assignments[renamed['glsl']]['texture']]
        if bytes.fromhex(texture['bytesHex']) != original_textures[renamed['native']]:
            raise ValueError('Actual THREE authored texture bytes differ from selected package')
    renderer = StaticMeshDraw(args.angle)
    device = GraphicsPipelineDevice(renderer, raw(cache/'public/decoder-16.21-macos/image.bin'))
    program = renderer.program(*stages)
    pipeline = device.create(bytes.fromhex(variant['pipeline']['descriptorHex']), {'linked': True, 'glHandle': program})
    raster = frames['rasterStates'][commands['materialKey']]
    if pipeline['state'] != raster['sourceState'] or not raster['windingReversed'] or raster['cullModeChanged']:
        raise ValueError('Exact original Metal to GLES raster conversion required')
    pipeline = {**pipeline, 'nativeRasterState': pipeline['state'], 'state': raster['state']}
    handles = {}
    images, observations = {}, []
    original_draw = renderer.gl.glDrawElements
    renderer.fn(renderer.gl, 'glGetUniformiv', None, C.c_uint, C.c_int, C.POINTER(C.c_int))
    renderer.fn(renderer.gl, 'glGetActiveUniform', None, C.c_uint, C.c_uint, C.c_int,
                C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_uint), C.c_void_p)
    try:
        count, active_samplers = C.c_int(), []
        renderer.gl.glGetProgramiv(program, 0x8b86, C.byref(count))
        for index in range(count.value):
            name, length, size, kind = C.create_string_buffer(512), C.c_int(), C.c_int(), C.c_uint()
            renderer.gl.glGetActiveUniform(program, index, len(name), C.byref(length), C.byref(size), C.byref(kind), name)
            if kind.value in [0x8b5e, 0x8dd2]:
                active_samplers.append({'name': name.value.decode(), 'size': size.value, 'glType': kind.value})
        expected_samplers = [{k: a[k] for k in ['name', 'size', 'glType']} for a in fixed['assignments']]
        if active_samplers != expected_samplers:
            raise ValueError('Actual linked native sampler reflection differs from THREE upload export')
        for texture in commands['textures']:
            if texture['dimension'] != '2d' or texture['mipmaps'] or texture['flipY'] or texture['colorSpace']:
                raise ValueError('Unsupported actual texture upload contract')
            data = bytes.fromhex(texture['bytesHex'])
            if texture['integer']:
                if (texture['format'], texture['type'], texture['internalFormat']) != (1029, 1014, 'R32UI'):
                    raise ValueError('Exact exported R32UI texture required')
                handle = renderer.uint_texture(data)
            else:
                if (texture['format'], texture['type'], texture['internalFormat']) != (1023, 1009, None):
                    raise ValueError('Exact exported RGBA8 texture required')
                handle = renderer.texture(np.frombuffer(data, dtype=np.uint8).reshape(texture['height'], texture['width'], 4), 'clamp', 'nearest')
            renderer.gl.glBindTexture(0x0de1, handle)
            for name, value in texture['glParameters'].items():
                renderer.gl.glTexParameteri(0x0de1, int(name), value)
            handles[texture['id']] = handle
        reverse_names = {r['glsl']: r['native'] for r in commands['renamed']}
        canonical_units = {t['name']: t['unit'] for t in variant['textures']}
        canonical_units.update({'FOW_MAP_SharedTexture': 1, 'PIXEL_COLOR_REMAP_RAMP_SharedTexture': 2,
                                'ParticleMeshInstanceInfo_SharedDataBuffer': 0})
        textures, data_textures = {}, {}
        for assignment in fixed['assignments']:
            native_name = reverse_names.get(assignment['name'], assignment['name'])
            item = {'handle': handles[assignment['texture']], 'sampler': 0, 'unit': canonical_units[native_name]}
            if assignment['glType'] == 0x8dd2:
                data_textures[assignment['name']] = item
            else:
                textures[native_name] = item

        def apply_pipeline():
            device.apply(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
            return device.inspect(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])

        baseline, _ = renderer.draw_mesh(program, stages, vertices, indices, blocks, textures, data_textures, apply_pipeline)
        images['canonical-correct-binding'] = baseline
        for case in commands['cases']:
            draw_errors, observed_assignments = [], []

            def replay_draw(*args):
                if renderer.gl.glGetError():
                    raise ValueError('GL error before sampler command replay')
                # Relinking initializes samplers to zero. Explicitly restore that
                # state, so an earlier valid draw cannot conceal omitted uploads.
                for assignment in case['assignments']:
                    location = renderer.gl.glGetUniformLocation(program, assignment['name'].encode())
                    if location < 0:
                        raise ValueError('Exported active sampler missing from actual linked shader')
                    renderer.gl.glUniform1i(location, 0)
                for unit in range(len(commands['textures'])):
                    renderer.gl.glActiveTexture(0x84c0+unit)
                    renderer.gl.glBindSampler(unit, 0)
                    renderer.gl.glBindTexture(0x0de1, 0)
                for command in case['commands']:
                    if command['op'] == 'uniform1i':
                        location = renderer.gl.glGetUniformLocation(program, command['name'].encode())
                        renderer.gl.glUniform1i(location, command['unit'])
                    elif command['op'] == 'setTexture2D':
                        renderer.gl.glActiveTexture(0x84c0+command['unit'])
                        renderer.gl.glBindTexture(0x0de1, handles[command['texture']])
                    else:
                        raise ValueError('Unknown actual THREE upload operation')
                if renderer.gl.glGetError():
                    raise ValueError('Actual THREE sampler setup itself failed')
                for assignment in case['assignments']:
                    value = C.c_int()
                    renderer.gl.glGetUniformiv(program, renderer.gl.glGetUniformLocation(program, assignment['name'].encode()), C.byref(value))
                    if value.value != assignment['unit']:
                        raise ValueError('Actual GLES sampler unit differs from THREE export')
                    observed_assignments.append({'name': assignment['name'], 'unit': value.value, 'texture': assignment['texture']})
                original_draw(*args)
                draw_errors.append(renderer.gl.glGetError())

            renderer.gl.glDrawElements = replay_draw
            pixels, _ = renderer.draw_mesh(program, stages, vertices, indices, blocks, textures, data_textures, apply_pipeline)
            renderer.gl.glDrawElements = original_draw
            historical = case['label'] == 'historical-native-semantic-keys'
            changed = int(np.count_nonzero(np.any(np.abs(pixels[:, :, :3].astype(int)-[6, 9, 14]) > 2, axis=2)))
            if draw_errors != ([0x502] if historical else [0]):
                raise ValueError('Unexpected native sampler draw error: '+str(draw_errors))
            if historical and changed or not historical and (not changed or not np.array_equal(pixels, baseline)):
                raise ValueError('Historical/fixed native raster did not meet exact pixel gate')
            images[case['label']] = pixels
            observations.append({'label': case['label'], 'drawErrors': draw_errors, 'samplerAssignments': observed_assignments,
                                 'positivePixels': changed, 'rgbaSha256': adapter.sha(pixels.tobytes()),
                                 'canonicalPixelIdentical': bool(np.array_equal(pixels, baseline))})
        image_path = cache/'research/visuals/direct-three-sampler-upload-v33.png'
        image_path.parent.mkdir(exist_ok=True)
        Image.fromarray(np.concatenate(list(images.values()), axis=1)).save(image_path)
        for path in [Path(__file__), Path(inspect.getfile(StaticMeshDraw)), Path(adapter.__file__),
                     Path(inspect.getfile(GraphicsPipelineDevice)), args.angle/'libEGL.dll', args.angle/'libGLESv2.dll']:
            raw(path)
        raw(Path(adapter.adapter.__file__))
        for path, digest in inputs.items():
            if adapter.sha(Path(path).read_bytes()) != digest:
                raise ValueError('Sampler proof source changed: '+path)
        output = cache/'research/direct-three-sampler-upload-gles-v33.json'
        output.write_text(json.dumps({'schema': 1, 'kind': 'actual-three-sampler-command-native-gles-draw',
            'inputs': inputs, 'context': renderer.info, 'materialKey': commands['materialKey'],
            'shaderPairSha256': commands['shaderPairSha256'], 'activeSamplers': active_samplers,
            'canonicalTextureUnits': canonical_units,
            'fixture': {'worker': 'shared-direct-playback-worker-v32-final.json',
            'time': chosen_frame['time'], 'sourceEventId': chosen_draw['sourceEventId'], 'generation': chosen_draw['generation'],
            'verticesSha256': adapter.sha(vertices), 'indicesSha256': adapter.sha(indices),
            'uniformBlocks': [{'name': b['name'], 'sha256': adapter.sha(b['bytes'])} for b in blocks]},
            'cases': observations, 'image': str(image_path), 'imageSha256': adapter.sha(image_path.read_bytes()),
            'scope': {'actualNativeGlesDraw': True, 'actualThreeExportedSamplerCommands': True,
            'sameOriginalShadersGeometryUniformBytesAndPipeline': True, 'currentBrowserPlaybackObserved': False,
            'historicalReplayPlacementFixture': True, 'nativeWorldPixelParity': False,
            'partialTexturePolicy': 'native-static-mesh-allvision-remap-omitted-v1',
            'inactiveInstanceBuffer': 'original-noninstanced-branch-explicit-api-binding-52-zero-uints'}}, indent=2))
        print(json.dumps({'output': str(output), 'cases': observations, 'image': str(image_path)}))
    finally:
        renderer.gl.glDrawElements = original_draw
        renderer.gl.glDeleteProgram(program)
        renderer.close()


if __name__ == '__main__':
    main()

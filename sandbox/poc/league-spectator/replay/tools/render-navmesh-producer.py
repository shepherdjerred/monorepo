"""Replay the shared JS navmask command plan on GLES, with no guest execution.

Compare every finished pass with original CPU-produced GLES commands. Both
paths share the explicit resource-row backend adapter; native Metal pixels,
decoded scene selection and live scene publication remain unproved.
"""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import struct
import sys

from PIL import Image, ImageDraw
from navmesh_resource_coordinates import adapt_navmesh_resource_vertex

spec = importlib.util.spec_from_file_location('nav_plan_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    parser.add_argument('--commands', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = adapter.sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Nav replay input changed')
        inputs[str(path)] = digest
        return data

    proof = json.loads(raw(args.commands if args.commands else cache / 'research/navmesh-producer-comparison.json'))
    if proof['kind'] not in ['shared-navmesh-producer-native-command-differential','owned-three-nav-scene-executor-command-export'] or proof['mismatches']:
        raise ValueError('Current command differential required')
    from_three = proof['kind'] == 'owned-three-nav-scene-executor-command-export'
    for path, digest in proof['inputs'].items():
        if adapter.sha(raw(path)) != digest:
            raise ValueError('Native command proof input changed')
    tools = Path(__file__).resolve().parent
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(tools):
            raw(path)
    raw(__file__)
    folder = cache / 'public/latest-shared-shaders-navmask-v29'
    manifest = json.loads(raw(folder / 'package.json'))

    def stage(digest):
        refs = [r for r in manifest['translations'] if r['dxbcSha256'] == digest]
        if len(refs) != 1:
            raise ValueError('Exact original stage required')
        data = raw(folder / refs[0]['file'])
        if adapter.sha(data) != refs[0]['sha256']:
            raise ValueError('Shader translation changed')
        return json.loads(data)

    vertex = stage('ea6fba36ce6d661beb55e8b2aa4856753a04bb6a8862b022387d7a027288b22a')
    vertex['glsl'] = adapt_navmesh_resource_vertex(vertex['glsl'])
    pixels = {
        'fade': stage('98a98b9fb3b0f8ac1e60d1d2c1d986f6e5f245bc4f6c2d8d1c3b2ff0462ab3e5'),
        'blur': stage('8d191c51e4cecea3adb01c254a8778c487fe835a483699a74456bd029efe18cc'),
    }
    d = adapter.Draw(args.angle)
    d.fn(d.gl, 'glDrawArrays', None, C.c_uint, C.c_int, C.c_int)
    d.fn(d.gl, 'glTexSubImage2D', None, C.c_uint, C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_void_p)
    d.fn(d.gl, 'glPixelStorei', None, C.c_uint, C.c_int)
    programs = {}
    observations = []
    pictures = []
    try:
        programs = {name: d.program(vertex, pixel) for name, pixel in pixels.items()}
        for case in proof['cases']:
            width, height = case['resources']['width'], case['resources']['height']
            textures = {}
            for resource in case['resources']['masks'] + case['resources']['targets']:
                handle = C.c_uint()
                d.gl.glGenTextures(1, C.byref(handle))
                d.textures.append(handle)
                textures[resource['id']] = handle.value
                d.gl.glBindTexture(0xde1, handle)
                for key, value in [(0x2802, 0x812f), (0x2803, 0x812f), (0x2801, 0x2600), (0x2800, 0x2600)]:
                    d.gl.glTexParameteri(0xde1, key, value)
                is_mask = resource['format'] == 'r8-unorm'
                data = bytes.fromhex(resource['initialBytesHex']) if is_mask else None
                if is_mask and (len(data) != width * height or any(data)):
                    raise ValueError('Exact zero-initialized history mask required')
                d.gl.glPixelStorei(0xcf5, 1)
                d.gl.glTexImage2D(0xde1, 0, 0x8229 if is_mask else 0x8058, width, height, 0,
                                  0x1903 if is_mask else 0x1908, 0x1401,
                                  C.create_string_buffer(data) if data is not None else None)
            for index, update in enumerate(case['updates']):
                if update['targetLifetime'] != 'per-update-pool-lease':
                    raise ValueError('Transient output target ownership required')
                # This allocator reuses two physical leases. Native pool reuse
                # may exchange them; the command proof verifies each DAG.
                if update['upload']:
                    upload = update['upload']
                    data = bytes.fromhex(upload['bytesHex'])
                    d.gl.glBindTexture(0xde1, textures[upload['target']])
                    d.gl.glTexSubImage2D(0xde1, 0, 0, 0, width, height, 0x1903, 0x1401, C.create_string_buffer(data))
                for at, command in enumerate(update['passes']):
                    program = programs[command['shader']]
                    d.gl.glUseProgram(program)
                    block = d.gl.glGetUniformBlockIndex(program, b'Globals_ps')
                    if block == 0xffffffff:
                        raise ValueError('Original parameter block missing')
                    uniform = d.buffer(0x8a11, struct.pack('<4f', *command['parameters']))
                    d.gl.glUniformBlockBinding(program, block, 0)
                    d.gl.glBindBufferBase(0x8a11, 0, uniform)
                    names = ({'current': 'SAMPLER_NAV_GRID_CURRENT_TX', 'target': 'SAMPLER_NAV_GRID_TARGET_TX'}
                             if command['shader'] == 'fade' else {'source': 'srcTex_TX'})
                    for unit, (role, name) in enumerate(names.items()):
                        location = d.gl.glGetUniformLocation(program, name.encode())
                        if location < 0 or command['textures'][role] == command['target']:
                            raise ValueError('Original non-feedback texture slot required')
                        d.gl.glActiveTexture(0x84c0 + unit)
                        d.gl.glBindTexture(0xde1, textures[command['textures'][role]])
                        filter_value = {'clamp-nearest': 0x2600, 'clamp-linear': 0x2601}[command['samplers'][role]]
                        for key in [0x2801, 0x2800]:
                            d.gl.glTexParameteri(0xde1, key, filter_value)
                        d.gl.glUniform1i(location, unit)
                    d.gl.glBindFramebuffer(0x8d40, d.framebuffer)
                    d.gl.glFramebufferTexture2D(0x8d40, 0x8ce0, 0xde1, textures[command['target']], 0)
                    if d.gl.glCheckFramebufferStatus(0x8d40) != 0x8cd5:
                        raise ValueError('Shared plan framebuffer incomplete')
                    d.buffer(0x8892, struct.pack('<6f', 0, 0, 2, 0, 0, 2))
                    location = d.gl.glGetAttribLocation(program, b'a_POSITION')
                    if location < 0:
                        raise ValueError('Original fullscreen position missing')
                    d.gl.glEnableVertexAttribArray(location)
                    d.gl.glVertexAttribPointer(location, 2, 0x1406, False, 8, None)
                    for flag in [0x0be2, 0x0b44, 0x0b71, 0x0b90, 0x8037]:
                        d.gl.glDisable(flag)
                    d.gl.glViewport(0, 0, width, height)
                    d.gl.glDrawArrays(4, 0, 3)
                    output = C.create_string_buffer(width * height * 4)
                    d.gl.glReadPixels(0, 0, width, height, 0x1908, 0x1401, output)
                    if d.gl.glGetError():
                        raise ValueError('Shared navmask GPU replay failed')
                    red = output.raw[0::4]
                    expected = update['expectedPixels'][at]
                    if adapter.sha(red) != expected['redSha256'] or adapter.sha(output.raw) != expected['rgbaSha256']:
                        raise ValueError(f'Finished GPU pixels differ: {case["resolution"]}/{index}/{at}')
                    observations.append({'resolution': case['resolution'], 'update': index, 'pass': at,
                                         'shader': command['shader'], 'redSha256': adapter.sha(red),
                                         'rgbaSha256': adapter.sha(output.raw), 'pixels': width * height,
                                         'positiveRedPixels': sum(v > 0 for v in red)})
                    if at == 4:
                        pictures.append((case['resolution'], index, update.get('replayTime',1+index*.25), Image.frombytes('L', (width, height), red)))
    finally:
        for program in programs.values():
            d.gl.glDeleteProgram(program)
        d.close()
    resolutions=list(dict.fromkeys(row[0] for row in pictures))
    columns=max(row[1] for row in pictures)+1
    canvas = Image.new('RGB', (columns * 360, len(resolutions) * 390), '#101820')
    label = ImageDraw.Draw(canvas)
    for resolution, index, now, picture in pictures:
        x, y = index * 360, resolutions.index(resolution) * 390
        picture.thumbnail((352, 340))
        canvas.paste(picture.convert('RGB'), (x + 4, y + 36))
        label.text((x + 4, y + 6), f'{resolution} / {now:.2f}s / filtered output', fill='white')
    stem='direct-nav-scene-renderer-gpu-replay' if from_three else 'navmesh-producer-gpu-replay'
    image = cache / f'visuals/{stem}.png'
    canvas.save(image)
    for path, digest in inputs.items():
        if adapter.sha(Path(path).read_bytes()) != digest:
            raise ValueError('Nav replay source changed')
    report = cache / f'research/{stem}.json'
    report.write_text(json.dumps({'schema': 1, 'kind': 'shared-navmesh-plan-gles-command-replay',
        'inputs': inputs, 'passes': observations, 'mismatches': [], 'image': str(image),
        'imageSha256': adapter.sha(image.read_bytes()),
        'scope': {'guestInstructionsExecuted': False, 'sharedJsCommandPlan': True,
                  'commandsFromActualThreeExecutor':from_three,'actualThreeWebGlBackendExecuted':False,
                  'allFinishedGlesPassPixelsExact': True, 'nativeMetalGpuParity': False,
                  'decodedMapVariantRecovered': False, 'dynamicSourceMutationRecovered': False,
                  'scenePublicationRecovered': False, 'runtimeAdmissionChanged': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'report': str(report), 'image': str(image), 'passes': len(observations)}))


if __name__ == '__main__':
    main()

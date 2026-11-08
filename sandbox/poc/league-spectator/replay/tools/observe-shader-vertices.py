"""Locate shader differences before rasterization using original DXBC outputs.

D3D11 stream output and ES3 transform feedback capture the unchanged programs.
Only the explicit D3D-to-GL clip-Z convention is normalized for comparison.
No window, browser or League process is used.
"""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess

import numpy as np

spec = importlib.util.spec_from_file_location('draw_adapter', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
Draw, sha = adapter.Draw, adapter.sha


class Request:
    def __init__(self, data):
        self.data, self.at = data, 0
        if self.fixed(8) != b'SCDXBC01':
            raise ValueError('Unknown oracle request')
        self.width, self.height, self.src, self.dst = [self.word() for _ in range(4)]
        self.vs, self.ps, self.vertices, self.indices = [self.blob() for _ in range(4)]
        self.buffers = []
        for _ in range(self.count(32)):
            stage, name, data = self.word(), self.text(), self.blob()
            members = []
            for _ in range(self.count(256)):
                members.append((self.text(), [self.word() for _ in range(8)]))
            self.buffers.append((stage, name, data, members))
        self.textures = []
        for _ in range(self.count(32)):
            self.textures.append((self.text(), self.word(), self.word(), self.blob()))
        self.samplers = {}
        for _ in range(self.count(32)):
            name, address, filtering = self.text(), self.word(), self.word()
            if name in self.samplers:
                raise ValueError('Duplicate oracle sampler')
            self.samplers[name] = (address, filtering)
        if self.at != len(self.data):
            raise ValueError('Unconsumed oracle request')

    def fixed(self, count):
        if count < 0 or self.at + count > len(self.data):
            raise ValueError('Truncated oracle request')
        result = self.data[self.at:self.at + count]
        self.at += count
        return result

    def word(self):
        return struct.unpack('<I', self.fixed(4))[0]

    def count(self, maximum):
        count = self.word()
        if count > maximum:
            raise ValueError('Oracle count exceeds bound')
        return count

    def blob(self):
        return self.fixed(self.count(64 * 1024 * 1024))

    def text(self):
        return self.blob().decode('ascii')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'angle', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cache, sources = args.cache.resolve(), {}
    def raw(path):
        data = path.read_bytes()
        sources[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    baseline = read(cache / 'public/evidence/latest-shader-pixels.json')
    for path, expected in baseline['sources'].items():
        if sha(raw(Path(path))) != expected:
            raise ValueError(f'Pixel baseline source changed: {path}')
    build = read(cache / 'research/shader-oracle/build.json')
    oracle = cache / 'research/shader-oracle/shader-oracle.exe'
    if sha(raw(oracle)) != build['binarySha256'] or build != baseline['oracleBuild']:
        raise ValueError('Original shader oracle build changed')
    work = cache / 'research/shader-vertices'
    work.mkdir(parents=True, exist_ok=True)
    renderer, programs, results = Draw(args.angle), [], []
    u, i, p = C.c_uint, C.c_int, C.c_void_p
    try:
        if renderer.info != baseline['context']:
            raise ValueError('Vertex capture backend differs from pixel baseline')
        for name, result, arguments in [
            ('glTransformFeedbackVaryings', None, [u, i, C.POINTER(C.c_char_p), u]),
            ('glBeginTransformFeedback', None, [u]), ('glEndTransformFeedback', None, []),
            ('glDrawArrays', None, [u, i, i]),
            ('glMapBufferRange', p, [u, C.c_ssize_t, C.c_ssize_t, u]),
            ('glUnmapBuffer', C.c_ubyte, [u]),
        ]:
            renderer.fn(renderer.gl, name, result, *arguments)
        for sample in baseline['observations']:
            if sample['unblended']:
                continue  # Same VS inputs as the native-blend sample.
            request_file = Path(sample['requestFile'])
            request_bytes = raw(request_file)
            if sha(request_bytes) != sample['requestSha256']:
                raise ValueError('Vertex input request changed')
            request = Request(request_bytes)
            prefix = work / request_file.stem
            original_pixels = prefix.with_suffix('.rgba')
            report_file = prefix.with_suffix('.json')
            original_file = prefix.with_suffix('.original.bin')
            child = subprocess.run([str(oracle), str(request_file), str(original_pixels), str(report_file), str(original_file)], capture_output=True, text=True)
            if child.returncode:
                raise ValueError(f'Original vertex capture failed: {child.stderr}')
            report = read(report_file)
            if sha(raw(original_pixels)) != sample['originalRgbaSha256']:
                raise ValueError('Vertex capture changed the original pixel draw')
            package = cache / 'public' / ('latest-shadow-shaders' if sample['shadow'] else 'latest-shaders')
            stages = [read(package / 'stages' / f'{digest}.json') for digest in sample['originalDxbcSha256']]
            if [sha(request.vs), sha(request.ps)] != sample['originalDxbcSha256']:
                raise ValueError('Request shader identity changed')
            program = renderer.program(*stages)
            programs.append(program)
            names = []
            for output in report['vertexOutputs']:
                semantic = output['semantic']
                if semantic.lower() == 'sv_position':
                    name = 'gl_Position'
                    if output['firstComponent'] != 0 or output['components'] != 4:
                        raise ValueError('Unsupported native clip position shape')
                else:
                    name = 'v_' + semantic + (str(output['index']) if output['index'] else '')
                    if not re.search(r'^out vec4 ' + re.escape(name) + r';$', stages[0]['glsl'], re.M):
                        raise ValueError(f'Native output lacks an exact GLSL varying: {name}')
                names.append(name.encode('ascii'))
            varyings = (C.c_char_p * len(names))(*names)
            renderer.gl.glTransformFeedbackVaryings(program, len(names), varyings, 0x8c8c)
            renderer.gl.glLinkProgram(program)
            linked = C.c_int()
            renderer.gl.glGetProgramiv(program, 0x8b82, C.byref(linked))
            if not linked.value:
                raise ValueError(f'Transform feedback link failed: {renderer.log(program, True)}')
            values = {}
            for stage_index, stage in enumerate(stages):
                for block in stage['sidecar']['blocks']:
                    candidates = [b for b in request.buffers if b[0] == stage_index and b[1] == block['name']]
                    if len(candidates) != 1 or len(candidates[0][2]) != block['size']:
                        raise ValueError('Vertex constant-buffer identity/size mismatch')
                    for member in block['members']:
                        if member['used']:
                            code = {'float': 'f', 'int': 'i', 'uint': 'I', 'bool': 'I'}[member['scalar']]
                            values[block['glslName'] + '.' + member['name']] = list(struct.unpack_from('<' + code * (member['size'] // 4), candidates[0][2], member['offset']))
            texture_handles = {}
            for name, width, height, data in request.textures:
                if len(data) != width * height * 4:
                    raise ValueError('Vertex texture input size mismatch')
                descriptors = {request.samplers[b['sampler']] for stage in stages for texture in stage['sidecar']['textures'] if texture['name'] == name for b in texture['samplers']}
                if len(descriptors) != 1:
                    raise ValueError('Ambiguous vertex texture sampler')
                address, filtering = next(iter(descriptors))
                texture_handles[name] = renderer.texture(np.frombuffer(data, dtype=np.uint8).reshape(height, width, 4), {0: 'repeat', 1: 'clamp', 2: 'mirror'}[address], {0: 'nearest', 1: 'linear'}[filtering])
            blend = {1: 0, 2: 1, 5: 0x0302, 6: 0x0303}
            rgba, _ = renderer.draw(program, stages, request.vertices, request.indices, values, texture_handles, blend=(blend[request.src], blend[request.dst]))
            raster_same = sha(rgba.tobytes()) == sample['translatedRgbaSha256']
            count = len(request.vertices) // 28
            if report['vertexCount'] != count:
                raise ValueError('Native capture vertex count mismatch')
            capture_bytes = count * len(names) * 16
            capture = renderer.buffer(0x8c8e, b'\xa5' * capture_bytes)
            renderer.gl.glBindBufferBase(0x8c8e, 0, capture)
            renderer.gl.glEnable(0x8c89)
            renderer.gl.glBeginTransformFeedback(0)
            renderer.gl.glDrawArrays(0, 0, count)
            renderer.gl.glEndTransformFeedback()
            renderer.gl.glDisable(0x8c89)
            renderer.gl.glFinish()
            pointer = renderer.gl.glMapBufferRange(0x8c8e, 0, capture_bytes, 1)
            error = renderer.gl.glGetError()
            if not pointer or error:
                raise ValueError(f'Transform feedback readback failed: {error:04x}')
            gl_bytes = C.string_at(pointer, capture_bytes)
            if not renderer.gl.glUnmapBuffer(0x8c8e):
                raise ValueError('Transform feedback readback was invalidated')
            renderer.gl.glBindBufferBase(0x8c8e, 0, 0)
            translated_file = prefix.with_suffix('.translated.bin')
            translated_file.write_bytes(gl_bytes)
            original_bytes = raw(original_file)
            if len(original_bytes) != count * report['vertexStride']:
                raise ValueError('Original vertex capture size mismatch')
            original = np.frombuffer(original_bytes, dtype='<f4').reshape(count, report['vertexStride'] // 4)
            translated = np.frombuffer(gl_bytes, dtype='<f4').reshape(count, len(names), 4)
            outputs, changed_total = [], 0
            for index, output in enumerate(report['vertexOutputs']):
                first, components, offset = output['firstComponent'], output['components'], output['offset'] // 4
                expected = original[:, offset:offset + components].copy()
                if names[index] == b'gl_Position':
                    expected[:, 2] = np.float32(2) * expected[:, 2] - expected[:, 3]
                actual = translated[:, index, first:first + components].copy()
                if not np.isfinite(expected).all() or not np.isfinite(actual).all():
                    raise ValueError('Nonfinite shader vertex output')
                changed = expected.view('<u4') != actual.view('<u4')
                changed_total += int(changed.sum())
                outputs.append({**output, 'glslName': names[index].decode(), 'lanes': int(changed.size), 'changedLanes': int(changed.sum()),
                    'maximumAbsoluteError': float(np.abs(expected.astype(np.float64) - actual.astype(np.float64)).max()),
                    'differences': [{'vertex': int(v), 'component': int(c + first), 'originalNormalized': float(expected[v, c]), 'translated': float(actual[v, c]), 'originalBits': f'{expected.view("<u4")[v, c]:08x}', 'translatedBits': f'{actual.view("<u4")[v, c]:08x}'} for v, c in np.argwhere(changed)]})
            observation = {'effectId': sample['effectId'], 'emitterIndex': sample['emitterIndex'], 'time': sample['time'], 'shadow': sample['shadow'],
                'requestSha256': sample['requestSha256'], 'rasterReadbackReproducesBaseline': raster_same, 'vertices': count,
                'originalFile': str(original_file), 'originalSha256': sha(original_bytes), 'translatedFile': str(translated_file), 'translatedSha256': sha(gl_bytes),
                'nativeSignature': report['vertexOutputs'], 'originalStride': report['vertexStride'], 'outputs': outputs, 'changedLanes': changed_total}
            results.append(observation)
            print(json.dumps({k: observation[k] for k in ['effectId', 'time', 'shadow', 'vertices', 'changedLanes', 'rasterReadbackReproducesBaseline']}), flush=True)
    finally:
        for program in programs:
            renderer.gl.glDeleteProgram(program)
        renderer.close()
    result = {'schema': 1, 'kind': 'original-dxbc-vs-translated-glsl-vertices', 'build': baseline['build'], 'sources': sources,
        'observerSha256': sha(Path(__file__).read_bytes()), 'drawAdapterSha256': sha(Path(__file__).with_name('render-particle-shader.py').read_bytes()),
        'context': renderer.info, 'oracleBuild': build, 'observations': results,
        'counts': {'cases': len(results), 'vertices': sum(r['vertices'] for r in results), 'lanes': sum(o['lanes'] for r in results for o in r['outputs']),
            'changedLanes': sum(r['changedLanes'] for r in results), 'exactCases': sum(r['changedLanes'] == 0 for r in results),
            'rasterReadbackChanges': sum(not r['rasterReadbackReproducesBaseline'] for r in results)},
        'scope': {'tolerance': 0, 'clipZNormalization': 'float32(2 * originalZ) - originalW', 'nativeDefinedComponentsOnly': True,
            'pointDrawEachInputOnce': True, 'shaderSourceRewritten': False, 'browserRun': False, 'leagueRun': False,
            'pixelCauseEstablished': False, 'hardwareEquivalence': False, 'mainViewerIntegrated': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()

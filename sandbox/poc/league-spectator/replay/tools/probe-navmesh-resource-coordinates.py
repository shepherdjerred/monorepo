"""Original Regions Fade identity controls for explicit texture resource rows.

This is backend-coordinate conformance, not a native Metal GPU comparison.
Metal's positive upper-left viewport and texture row-zero convention require
one clip-Y inversion when row-zero bytes use a lower-left GLES framebuffer.
"""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import struct
import sys

import numpy as np
from navmesh_resource_coordinates import POLICY, adapt_navmesh_resource_vertex

spec = importlib.util.spec_from_file_location('nav_resource_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('angle', type=Path)
    a = p.parse_args()
    inputs = {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = adapter.sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Coordinate input drift')
        inputs[str(path)] = digest
        return data

    tools = Path(__file__).resolve().parent
    raw(__file__)
    for m in tuple(sys.modules.values()):
        path = getattr(m, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(tools):
            raw(path)
    folder = a.cache / 'public/latest-shared-shaders-navmask-v29'
    manifest = json.loads(raw(folder / 'package.json'))
    stages = []
    for digest in ['ea6fba36ce6d661beb55e8b2aa4856753a04bb6a8862b022387d7a027288b22a',
                   '98a98b9fb3b0f8ac1e60d1d2c1d986f6e5f245bc4f6c2d8d1c3b2ff0462ab3e5']:
        refs = [r for r in manifest['translations'] if r['dxbcSha256'] == digest]
        if len(refs) != 1:
            raise ValueError('Exact original POST_EFFECT/Fade shader required')
        data = raw(folder / refs[0]['file'])
        if adapter.sha(data) != refs[0]['sha256']:
            raise ValueError('Prepared stage changed')
        stages.append(json.loads(data))
    original = stages[0]['glsl']
    adapted = adapt_navmesh_resource_vertex(original)
    d = adapter.Draw(a.angle)
    controls = []
    try:
        # Asymmetric in both axes and every channel. CURRENT == TARGET makes
        # original Fade an exact identity without replacing its pixel shader.
        for width, height in [(4, 3), (7, 5), (1, 4), (5, 1)]:
            pixels = np.array([[(17 + x * 31 + y * 47 + c * 53) % 256 for c in range(4)]
                               for y in range(height) for x in range(width)], dtype=np.uint8).reshape(height, width, 4)
            source = d.texture(pixels, 'clamp', 'nearest')
            output = d.texture(np.zeros_like(pixels), 'clamp', 'nearest')
            d.gl.glBindFramebuffer(0x8d40, d.framebuffer)
            d.gl.glFramebufferTexture2D(0x8d40, 0x8ce0, 0xde1, output, 0)
            if d.gl.glCheckFramebufferStatus(0x8d40) != 0x8cd5:
                raise ValueError('Owned coordinate target incomplete')
            for inverted in [False, True]:
                vertex = {**stages[0], 'glsl': adapted if inverted else original}
                program = d.program(vertex, stages[1])
                d.gl.glUseProgram(program)
                block = d.gl.glGetUniformBlockIndex(program, b'Globals_ps')
                if block == 0xffffffff:
                    raise ValueError('Original Fade parameter block missing')
                handle = d.buffer(0x8a11, struct.pack('<4f', 0, 0, 0, 1.1))
                d.gl.glUniformBlockBinding(program, block, 0)
                d.gl.glBindBufferBase(0x8a11, 0, handle)
                for unit, name in enumerate([b'SAMPLER_NAV_GRID_CURRENT_TX', b'SAMPLER_NAV_GRID_TARGET_TX']):
                    location = d.gl.glGetUniformLocation(program, name)
                    if location < 0:
                        raise ValueError('Original Fade texture missing')
                    d.gl.glActiveTexture(0x84c0 + unit)
                    d.gl.glBindTexture(0xde1, source)
                    d.gl.glUniform1i(location, unit)
                d.buffer(0x8892, struct.pack('<6f', 0, 0, 2, 0, 0, 2))
                location = d.gl.glGetAttribLocation(program, b'a_POSITION')
                d.gl.glEnableVertexAttribArray(location)
                d.gl.glVertexAttribPointer(location, 2, 0x1406, False, 8, None)
                d.buffer(0x8893, struct.pack('<3H', 0, 1, 2))
                for flag in [0x0be2, 0x0b44, 0x0b71, 0x0b90]:
                    d.gl.glDisable(flag)
                d.gl.glViewport(0, 0, width, height)
                d.gl.glDrawElements(4, 3, 0x1403, None)
                result = C.create_string_buffer(width * height * 4)
                d.gl.glReadPixels(0, 0, width, height, 0x1908, 0x1401, result)
                if d.gl.glGetError():
                    raise ValueError('Coordinate GPU error')
                expected = pixels.tobytes() if inverted else pixels[::-1].tobytes()
                if result.raw != expected:
                    raise ValueError('Original Fade resource-row mapping differs')
                controls.append({'width': width, 'height': height, 'clipYNegated': inverted,
                                 'sourceHex': pixels.tobytes().hex(), 'outputHex': result.raw.hex(),
                                 'resourceRowsPreserved': result.raw == pixels.tobytes()})
                d.gl.glDeleteProgram(program)
    finally:
        d.close()
    for path, digest in inputs.items():
        if adapter.sha(Path(path).read_bytes()) != digest:
            raise ValueError('Coordinate source changed')
    report = {'schema': 1, 'kind': 'regions-resource-row-gles-conformance', 'inputs': inputs,
              'policy': POLICY,
              'originalVertexSha256': adapter.sha(original.encode()),
              'adaptedVertexSha256': adapter.sha(adapted.encode()), 'controls': controls,
              'scope': {'originalFadeShaderExecuted': True, 'nativeMetalGpuComparison': False,
                        'nativeSceneInputsRecovered': False, 'runtimeAdmissionChanged': False}}
    output = a.cache / 'research/navmesh-resource-coordinates.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls)}))


if __name__ == '__main__':
    main()

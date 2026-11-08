"""Explicit SCB/static-mesh GLES host adapter, without a game draw callback.

Uniforms, texture payloads, inactive-buffer controls and pipeline state are
caller-owned inputs. This adapter neither recovers nor invents game resources.
"""
import ctypes as C
import importlib.util
from pathlib import Path

import numpy as np

_spec = importlib.util.spec_from_file_location(
    'static_mesh_draw_base', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(adapter)


class StaticMeshDraw(adapter.Draw):
    def __init__(self, directory):
        super().__init__(directory)
        self.fn(self.gl, 'glBindSampler', None, C.c_uint, C.c_uint)

    def uint_texture(self, words):
        if not isinstance(words, bytes) or not words or len(words) % 4:
            raise ValueError('Explicit uint data-texture words required')
        width = len(words) // 4
        if width > 4096:
            raise ValueError('Bounded diagnostic uint data texture required')
        handle = C.c_uint()
        self.gl.glGenTextures(1, C.byref(handle))
        self.gl.glBindTexture(0x0de1, handle)
        payload = C.create_string_buffer(words)
        # Each translated DXBC scalar load fetches one uint texel's x lane.
        self.gl.glTexImage2D(0x0de1, 0, 0x8236, width, 1, 0,
                             0x8d94, 0x1405, payload)
        for key, value in [(0x2802, 0x812f), (0x2803, 0x812f),
                           (0x2801, 0x2600), (0x2800, 0x2600)]:
            self.gl.glTexParameteri(0x0de1, key, value)
        self.textures.append(handle)
        if self.gl.glGetError():
            raise ValueError('Diagnostic integer texture upload failed')
        return handle.value

    def draw_mesh(self, program, stages, vertices, indices, uniform_blocks,
                  textures, data_textures, apply_pipeline, *, clear=True,
                  readback=True):
        if (not isinstance(vertices, bytes) or not vertices or
                len(vertices) % 36 or not isinstance(indices, bytes) or
                len(indices) % 2 or not callable(apply_pipeline)):
            raise ValueError('Explicit original SCB geometry and pipeline required')
        count = len(vertices) // 36
        index_values = np.frombuffer(indices, dtype='<u2')
        if count > 65535 or np.any(index_values >= count):
            raise ValueError('Static mesh indices exceed the supplied vertices')
        blocks = {(v['stage'], v['name']): v for v in uniform_blocks}
        if len(blocks) != len(uniform_blocks):
            raise ValueError('Duplicate static mesh uniform ownership')
        units = [v['unit'] for v in [*textures.values(), *data_textures.values()]]
        if len(units) != len(set(units)) or any(type(u) is not int or u < 0 for u in units):
            raise ValueError('Distinct explicit static mesh texture units required')
        self.gl.glUseProgram(program)
        used_blocks, used_textures, used_data = set(), set(), set()
        block_bindings, observations = set(), []
        for side, stage in zip(['vertex', 'pixel'], stages, strict=True):
            buffers = {t['name']: t for t in stage['sidecar']['textures']
                       if t['dimension'] == 'buffer'}
            for block in stage['sidecar']['blocks']:
                if block['name'] in buffers or not any(
                        m['used'] for m in block['members']):
                    continue
                key = side, block['glslName']
                supplied = blocks.get(key)
                if supplied is None or len(supplied['bytes']) != block['size']:
                    raise ValueError('Complete reflected static mesh block required: ' + str(key))
                binding = supplied['binding']
                if binding in block_bindings:
                    raise ValueError('Duplicate static mesh buffer binding')
                block_bindings.add(binding)
                location = self.gl.glGetUniformBlockIndex(
                    program, block['glslName'].encode())
                if location == 0xffffffff:
                    raise ValueError('Static mesh uniform absent from linked shader')
                handle = self.buffer(0x8a11, supplied['bytes'])
                self.gl.glUniformBlockBinding(program, location, binding)
                self.gl.glBindBufferBase(0x8a11, binding, handle)
                used_blocks.add(key)
                observations.append({'stage': side, 'name': block['glslName'],
                                     'binding': binding, 'bytes': len(supplied['bytes']),
                                     'sha256': adapter.sha(supplied['bytes'])})
            for texture in stage['sidecar']['textures']:
                if texture['dimension'] == 'buffer':
                    supplied = data_textures.get(texture['name'])
                    names = [texture['name']]
                    used_data.add(texture['name'])
                elif texture['dimension'] == 'texture2d':
                    supplied = textures.get(texture['name'])
                    names = [s['glslName'] for s in texture['samplers']]
                    used_textures.add(texture['name'])
                else:
                    raise ValueError('Unsupported explicit static mesh texture dimension')
                if supplied is None:
                    raise ValueError('Explicit static mesh texture input required: ' + texture['name'])
                for name in names:
                    location = self.gl.glGetUniformLocation(program, name.encode())
                    if location < 0:
                        raise ValueError('Static mesh sampler absent from linked shader: ' + name)
                    self.gl.glActiveTexture(0x84c0 + supplied['unit'])
                    self.gl.glBindTexture(0x0de1, supplied['handle'])
                    self.gl.glBindSampler(supplied['unit'], supplied['sampler'])
                    self.gl.glUniform1i(location, supplied['unit'])
        if used_blocks != set(blocks) or used_textures != set(textures) or used_data != set(data_textures):
            raise ValueError('Unused/unowned static mesh binding inputs')
        self.buffer(0x8892, vertices)
        layout = {
            ('POSITION', 0): (3, 0x1406, 0, 0, 7),
            ('NORMAL', 0): (3, 0x1406, 0, 12, 7),
            ('COLOR', 0): (4, 0x1401, 1, 24, 15),
            ('TEXCOORD', 0): (2, 0x1406, 0, 28, 3),
        }
        for attribute in stages[0]['sidecar']['attributes']:
            field = layout.get((attribute['semantic'], attribute['index']))
            if field is None or attribute['mask'] != field[4]:
                raise ValueError('Unproven static mesh vertex attribute')
            location = self.gl.glGetAttribLocation(program, attribute['glslName'].encode())
            if location < 0:
                raise ValueError('Reflected static mesh attribute absent')
            self.gl.glEnableVertexAttribArray(location)
            self.gl.glVertexAttribPointer(location, *field[:3], 36, C.c_void_p(field[3]))
        self.buffer(0x8893, indices)
        self.gl.glViewport(0, 0, 512, 512)
        pipeline = apply_pipeline()
        if clear:
            self.gl.glClearColor(0.025, 0.035, 0.055, 1)
            self.gl.glClear(0x4000)
        self.gl.glDrawElements(4, len(indices) // 2, 0x1403, None)
        if not readback:
            error = self.gl.glGetError()
            if error:
                raise ValueError(f'Static mesh diagnostic GL error: {error:04x}')
            return None, {'uniformBlocks': observations, 'pipeline': pipeline}
        self.gl.glFinish()
        output = (C.c_ubyte * (512 * 512 * 4))()
        self.gl.glReadPixels(0, 0, 512, 512, 0x1908, 0x1401, output)
        error = self.gl.glGetError()
        if error:
            raise ValueError(f'Static mesh diagnostic GL error: {error:04x}')
        pixels = np.frombuffer(output, dtype=np.uint8).reshape(512, 512, 4)[::-1].copy()
        return pixels, {'uniformBlocks': observations, 'pipeline': pipeline}

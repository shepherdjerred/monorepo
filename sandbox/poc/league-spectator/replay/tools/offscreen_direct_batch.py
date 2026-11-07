"""Exact reflected direct vertex layout with an explicit frame-clear boundary.

This extends the existing offscreen host adapter to submit multiple actual draw
packets to one framebuffer. It does not execute or replace any game callback.
"""
import ctypes as C
import importlib.util
from pathlib import Path
import struct
import math
import numpy as np

spec = importlib.util.spec_from_file_location('direct_batch_base', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class DirectBatchDraw(adapter.Draw):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.fn(self.gl,'glPolygonOffset',None,C.c_float,C.c_float)

    def draw(self, program, stages, vertices, indices, values, texture_values,
             blend=(0x0302, 1), *, clear=True, readback=True, depth_bias=None):
        if type(clear) is not bool or type(readback) is not bool:
            raise ValueError('Explicit offscreen frame clear/readback boundaries required')
        self.gl.glUseProgram(program)
        block_index, buffers = 0, []
        for stage in stages:
            for block in stage['sidecar']['blocks']:
                data = bytearray(block['size'])
                for member in block['members']:
                    if not member['used']:
                        continue
                    key = block['glslName'] + '.' + member['name']
                    if key not in values or len(values[key]) * 4 != member['size']:
                        raise ValueError('Unprovided reflected batch uniform: ' + key)
                    code = {'float': 'f', 'uint': 'I', 'int': 'i', 'bool': 'I'}[member['scalar']]
                    struct.pack_into('<' + code * len(values[key]), data, member['offset'], *values[key])
                location = self.gl.glGetUniformBlockIndex(program, block['glslName'].encode())
                if location == 0xffffffff:
                    raise ValueError('Reflected batch block absent from linked shader')
                handle = self.buffer(0x8a11, bytes(data))
                self.gl.glUniformBlockBinding(program, location, block_index)
                self.gl.glBindBufferBase(0x8a11, block_index, handle)
                buffers.append({'name': block['glslName'], 'sha256': adapter.sha(data), 'bytes': len(data)})
                block_index += 1
        texture_index = 0
        for stage in stages:
            for texture in stage['sidecar']['textures']:
                if texture['dimension'] != 'texture2d' or texture['name'] not in texture_values:
                    raise ValueError('Unprovided reflected batch texture')
                for sampler in texture['samplers']:
                    location = self.gl.glGetUniformLocation(program, sampler['glslName'].encode())
                    if location < 0:
                        raise ValueError('Reflected batch sampler absent from linked shader')
                    self.gl.glActiveTexture(0x84c0 + texture_index)
                    self.gl.glBindTexture(0x0de1, texture_values[texture['name']])
                    self.gl.glUniform1i(location, texture_index)
                    texture_index += 1
        self.buffer(0x8892, vertices)
        layout = {'POSITION': (3, 0x1406, 0, 0), 'COLOR': (4, 0x1401, 1, 12),
                  'TEXCOORD': (4, 0x140b, 0, 16), 'TEXCOORD1': (2, 0x140b, 0, 24)}
        for attribute in stages[0]['sidecar']['attributes']:
            key = attribute['semantic'] + (str(attribute['index']) if attribute['index'] else '')
            if key not in layout:
                raise ValueError('Unprovided reflected batch vertex semantic: ' + key)
            size, kind, normalize, offset = layout[key]
            location = self.gl.glGetAttribLocation(program, attribute['glslName'].encode())
            if location < 0:
                raise ValueError('Reflected batch attribute absent from linked shader')
            self.gl.glEnableVertexAttribArray(location)
            self.gl.glVertexAttribPointer(location, size, kind, normalize, 28, C.c_void_p(offset))
        self.buffer(0x8893, indices)
        self.gl.glViewport(0, 0, 512, 512)
        self.gl.glDisable(0x0b44)
        self.gl.glDisable(0x0b71)
        # Polygon offset is draw state. Always disable it for an unbiased draw,
        # including after another component used a biased material.
        if depth_bias is None:
            self.gl.glDisable(0x8037)
        else:
            if not isinstance(depth_bias,(list,tuple)) or len(depth_bias)!=2 or not all(type(v) in [int,float] and math.isfinite(v) for v in depth_bias):
                raise ValueError('Explicit finite slope/constant depth bias required')
            self.gl.glEnable(0x8037)
            self.gl.glPolygonOffset(*depth_bias)
        self.gl.glEnable(0x0be2)
        self.gl.glBlendFunc(*blend)
        if clear:
            self.gl.glClearColor(0.025, 0.035, 0.055, 1)
            self.gl.glClear(0x4000)
        self.gl.glDrawElements(4, len(indices) // 2, 0x1403, None)
        rgba = None
        if readback:
            self.gl.glFinish()
            output = (C.c_ubyte * (512 * 512 * 4))()
            self.gl.glReadPixels(0, 0, 512, 512, 0x1908, 0x1401, output)
            rgba = np.frombuffer(output, dtype=np.uint8).reshape(512, 512, 4)[::-1].copy()
        error = self.gl.glGetError()
        if error:
            raise ValueError(f'Offscreen batch GL error: {error:04x}')
        return rgba, buffers

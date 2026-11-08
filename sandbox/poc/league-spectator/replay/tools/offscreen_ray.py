"""Explicit native 28-byte Ray packets with caller-owned reflected resources."""
import ctypes as C
import numpy as np

from offscreen_static_mesh import StaticMeshDraw, adapter


class RayDraw(StaticMeshDraw):
    def draw_ray(self, program, stages, vertices, indices, uniform_blocks,
                 textures, apply_pipeline, *, clear=True, readback=True):
        if (type(clear) is not bool or type(readback) is not bool or
                not isinstance(vertices, bytes) or not vertices or
                len(vertices) % 112 or not isinstance(indices, bytes) or
                len(indices) != len(vertices) // 112 * 12 or
                not callable(apply_pipeline)):
            raise ValueError('Explicit native Ray quad packets and pipeline required')
        count = len(vertices) // 28
        if count > 65535 or np.any(np.frombuffer(indices, dtype='<u2') >= count):
            raise ValueError('Ray indices exceed the supplied vertices')
        blocks = {(b['stage'], b['name']): b for b in uniform_blocks}
        if len(blocks) != len(uniform_blocks):
            raise ValueError('Duplicate Ray uniform ownership')
        units = [t['unit'] for t in textures.values()]
        if len(set(units)) != len(units) or any(type(u) is not int or u < 0 for u in units):
            raise ValueError('Distinct Ray texture units required')
        self.gl.glUseProgram(program)
        used_blocks, used_textures, bindings, observations = set(), set(), set(), []
        for side, stage in zip(['vertex', 'pixel'], stages, strict=True):
            for block in stage['sidecar']['blocks']:
                if not any(m['used'] for m in block['members']):
                    continue
                key = side, block['glslName']
                supplied = blocks.get(key)
                if supplied is None or len(supplied['bytes']) != block['size']:
                    raise ValueError('Complete reflected Ray block required: ' + str(key))
                binding = supplied['binding']
                if type(binding) is not int or binding < 0 or binding in bindings:
                    raise ValueError('Distinct Ray buffer bindings required')
                location = self.gl.glGetUniformBlockIndex(program, block['glslName'].encode())
                if location == 0xffffffff:
                    raise ValueError('Reflected Ray uniform absent from linked shader')
                handle = self.buffer(0x8a11, supplied['bytes'])
                self.gl.glUniformBlockBinding(program, location, binding)
                self.gl.glBindBufferBase(0x8a11, binding, handle)
                bindings.add(binding)
                used_blocks.add(key)
                observations.append({'stage': side, 'name': key[1], 'binding': binding,
                                     'bytes': len(supplied['bytes']),
                                     'sha256': adapter.sha(supplied['bytes'])})
            for texture in stage['sidecar']['textures']:
                supplied = textures.get(texture['name'])
                if texture['dimension'] != 'texture2d' or supplied is None:
                    raise ValueError('Explicit reflected Ray texture required: ' + texture['name'])
                for sampler in texture['samplers']:
                    location = self.gl.glGetUniformLocation(program, sampler['glslName'].encode())
                    if location < 0:
                        raise ValueError('Reflected Ray sampler absent from linked shader')
                    self.gl.glActiveTexture(0x84c0 + supplied['unit'])
                    self.gl.glBindTexture(0x0de1, supplied['handle'])
                    self.gl.glBindSampler(supplied['unit'], supplied['sampler'])
                    self.gl.glUniform1i(location, supplied['unit'])
                used_textures.add(texture['name'])
        if used_blocks != set(blocks) or used_textures != set(textures):
            raise ValueError('Unused or unowned Ray reflected resources')
        self.buffer(0x8892, vertices)
        layout = {('POSITION', 0): (3, 0x1406, 0, 0, 7),
                  ('COLOR', 0): (4, 0x1401, 1, 12, 15),
                  ('TEXCOORD', 0): (3, 0x140b, 0, 16, 7),
                  ('TEXCOORD', 1): (2, 0x140b, 0, 24, 3)}
        for attribute in stages[0]['sidecar']['attributes']:
            field = layout.get((attribute['semantic'], attribute['index']))
            if field is None or attribute['mask'] != field[4]:
                raise ValueError('Unproven native Ray vertex attribute')
            location = self.gl.glGetAttribLocation(program, attribute['glslName'].encode())
            if location < 0:
                raise ValueError('Reflected Ray attribute absent from linked shader')
            self.gl.glEnableVertexAttribArray(location)
            self.gl.glVertexAttribPointer(location, *field[:3], 28, C.c_void_p(field[3]))
        self.buffer(0x8893, indices)
        self.gl.glViewport(0, 0, 512, 512)
        pipeline = apply_pipeline()
        if clear:
            self.gl.glClearColor(.025, .035, .055, 1)
            self.gl.glClear(0x4000)
        self.gl.glDrawElements(4, len(indices) // 2, 0x1403, None)
        pixels = None
        if readback:
            self.gl.glFinish()
            output = (C.c_ubyte * (512 * 512 * 4))()
            self.gl.glReadPixels(0, 0, 512, 512, 0x1908, 0x1401, output)
            pixels = np.frombuffer(output, dtype=np.uint8).reshape(512, 512, 4)[::-1].copy()
        error = self.gl.glGetError()
        if error:
            raise ValueError(f'Ray diagnostic GL error: {error:04x}')
        return pixels, {'uniformBlocks': observations, 'pipeline': pipeline}

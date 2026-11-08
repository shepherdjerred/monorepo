"""Bounded GLES upload for original SKN vertex requests above the VFX limit.

The existing particle/static-mesh provider retains its one-MiB limit. Larger
requests must come from the original SKN setup call and match an explicitly
supplied exact-build static SKN header, pointer, count and stride.
"""
import ctypes as C
import hashlib
import struct
from unicorn import x86_const as r
from vfx_graphics_native import DEVICE
from vfx_mesh_native import BUFFER_RETURN


def skn_vertex_input(data):
    if not isinstance(data, bytes) or len(data) < 16:
        raise ValueError('Bounded static SKN bytes required')
    magic, major, minor, groups = struct.unpack_from('<IHHI', data)
    if (magic, major, minor) != (0x112233, 4, 1) or not 0 < groups <= 4096:
        raise ValueError('Verified SKN4.1 header required')
    header = 12 + groups * 80
    if header + 60 > len(data):
        raise ValueError('SKN material/header bounds differ')
    flags, indices, vertices, stride, format_ = struct.unpack_from('<5I', data, header)
    if flags or not 0 < vertices <= 65535 or not 0 < indices <= 0x100000 or (stride, format_) != (72, 2):
        raise ValueError('Unadmitted SKN static vertex shape')
    count = vertices * stride
    if header + 60 + indices * 2 + count + 12 != len(data) or data[-12:] != bytes(12):
        raise ValueError('SKN vertex/index spans do not cover source')
    return {'vertices': vertices, 'stride': stride, 'format': format_, 'indices': indices,
            'bytes': count, 'sourceSha256': hashlib.sha256(data).hexdigest()}


def upload_large_static_buffer(backend, data, flags, expected_bytes):
    if not isinstance(data, bytes) or len(data) != expected_bytes or not 0x100000 <= len(data) <= 65535 * 72 or flags != 0:
        raise ValueError('Bounded explicit SKN static buffer required')
    gl = backend.gl
    if gl.glGetError():
        raise ValueError('GLES error precedes SKN vertex upload')
    handle = C.c_uint()
    gl.glGenBuffers(1, C.byref(handle)); backend.buffers.append(handle)
    gl.glBindBuffer(0x8892, handle)
    source = C.create_string_buffer(data)
    gl.glBufferData(0x8892, len(data), source, 0x88e4)
    pointer = gl.glMapBufferRange(0x8892, 0, len(data), 1)
    if not pointer:
        raise ValueError('SKN vertex buffer readback unavailable')
    actual = C.string_at(pointer, len(data))
    if not gl.glUnmapBuffer(0x8892) or gl.glGetError() or actual != data:
        raise ValueError('SKN vertex GPU readback differs')
    record = {'glHandle': handle.value, 'flags': flags, 'bytes': len(data), 'bytesHex': data.hex(),
              'gpuReadbackSha256': hashlib.sha256(actual).hexdigest(), 'gpuBytesVerified': True,
              'provider': 'explicit-static-skn-original-request'}
    backend.buffer_records.append(record)
    return record


class NativeSkinnedVertexBuffers:
    def configure_skinned_vertex_inputs(self, sources):
        if getattr(self, 'skinned_vertex_inputs', None) is not None or not isinstance(sources, list) or not 0 < len(sources) <= 128:
            raise ValueError('One bounded static SKN input configuration required')
        self.skinned_vertex_inputs = [skn_vertex_input(source) for source in sources]
        return list(self.skinned_vertex_inputs)

    def buffer_create(self, uc, address, size, user):
        count = self.u.reg_read(r.UC_X86_REG_RSI)
        if count < 0x100000:
            return super().buffer_create(uc, address, size, user)
        pointer = self.u.reg_read(r.UC_X86_REG_RCX)
        flags = self.u.reg_read(r.UC_X86_REG_RDX)
        stack = self.u.reg_read(r.UC_X86_REG_RSP)
        mesh = self.u.reg_read(r.UC_X86_REG_RBX)
        if (self.q(stack) != self.base + 0x185ad06 or self.u.reg_read(r.UC_X86_REG_RDI) != DEVICE or
                self.pending_mesh_buffer is not None or not self.library_pointer(mesh, 0x44)):
            raise ValueError('Unowned original SKN vertex-buffer request')
        vertices, stride = self.u32(mesh + 0x38), self.u32(mesh + 0x3c)
        matches = [row for row in getattr(self, 'skinned_vertex_inputs', [])
                   if row['vertices'] == vertices and row['stride'] == stride and row['format'] == self.u32(mesh + 0x40)]
        if (not matches or count != vertices * stride or pointer != self.q(mesh + 0x10) or
                not self.library_pointer(pointer, count) or flags != 0):
            raise ValueError('Original SKN buffer differs from admitted static source shape')
        gpu = upload_large_static_buffer(self.mesh_backend, bytes(self.u.mem_read(pointer, count)), flags, count)
        gpu.update(sknSourceSha256=[row['sourceSha256'] for row in matches],
                   originalSknSetupReturnRva=0x185ad06, vertices=vertices, stride=stride,
                   nativeMesh=mesh)
        header = self.allocate(0x48, 0xa5)
        self.pending_mesh_buffer = {'gpu': gpu, 'header': header, 'stack': stack,
                                    'returnRva': 0x185ad06, 'sourcePointer': pointer,
                                    'sknSourceSha256': [row['sourceSha256'] for row in matches]}
        frame = stack - 0x10
        self.put(frame, 'Q', BUFFER_RETURN)
        for reg, value in [(r.UC_X86_REG_RDI, header), (r.UC_X86_REG_RSI, count), (r.UC_X86_REG_RDX, flags),
                           (r.UC_X86_REG_RSP, frame), (r.UC_X86_REG_RIP, self.base + 0x1917a40)]:
            self.u.reg_write(reg, value)

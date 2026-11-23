"""Real GLES storage for original null-source dynamic-buffer allocations.

Capacity is checked on the device. Its initial bytes are undefined: neither
zero-filled CPU data nor byte-equivalence is claimed before a native upload.
"""
import ctypes as C


class GraphicsDynamicBufferDevice:
    def __init__(self, device):
        self.device, self.gl = device, device.gl
        self.buffers, self.records = [], []
        device.fn(self.gl, 'glGetBufferParameteriv', None, C.c_uint, C.c_uint, C.POINTER(C.c_int))

    def create_uninitialized(self, count, flags, *, kind='vertex'):
        if (type(count) is not int or not 0 < count <= 8*1024*1024 or flags not in [1, 3] or
                kind not in ['vertex', 'index'] or sum(row['bytes'] for row in self.records)+count > 32*1024*1024):
            raise ValueError('Bounded dynamic GPU byte capacity required')
        if self.gl.glGetError():
            raise ValueError('GLES has an error before dynamic buffer allocation')
        handle = C.c_uint()
        self.gl.glGenBuffers(1, C.byref(handle))
        if not handle.value:
            raise ValueError('GLES dynamic buffer allocation returned no object')
        self.buffers.append(handle)
        self.gl.glBindBuffer(0x8892, handle)
        self.gl.glBufferData(0x8892, count, None, 0x88e8)
        actual = C.c_int()
        self.gl.glGetBufferParameteriv(0x8892, 0x8764, C.byref(actual))
        if self.gl.glGetError() or actual.value != count:
            raise ValueError('Actual GLES dynamic buffer capacity differs')
        record = {'glHandle': handle.value, 'flags': flags, 'bytes': count,
                  'kind': 'dynamic-uninitialized-'+kind, 'deviceCapacityVerified': True,
                  'nativeInitialSourcePointer': 0, 'initialBytesStatus': 'undefined-null-source',
                  'gpuBytesVerified': False, 'nativeWritesUploaded': False}
        self.records.append(record)
        return record

    def close(self):
        for handle in self.buffers:
            self.gl.glDeleteBuffers(1, C.byref(handle))
        self.buffers.clear()

"""Real GLES buffers and owned vertex-layout objects for native mesh setup."""
import ctypes as C
import hashlib


def sha(data):return hashlib.sha256(data).hexdigest()


class GraphicsMeshDevice:
    def __init__(self,device):
        self.device=device;self.gl=device.gl;self.buffers=[];self.vaos=[]
        device.fn(self.gl,'glMapBufferRange',C.c_void_p,C.c_uint,C.c_ssize_t,C.c_ssize_t,C.c_uint)
        device.fn(self.gl,'glUnmapBuffer',C.c_ubyte,C.c_uint)
        self.buffer_records=[];self.layout_records=[]

    def create_buffer(self,data,flags):
        if not isinstance(data,bytes) or not 0<len(data)<0x100000 or flags!=0:
            raise ValueError('Unadmitted native static vertex-buffer request')
        if self.gl.glGetError():raise ValueError('GLES has an error before native mesh buffer creation')
        handle=C.c_uint();self.gl.glGenBuffers(1,C.byref(handle));self.buffers.append(handle)
        self.gl.glBindBuffer(0x8892,handle);source=C.create_string_buffer(data)
        self.gl.glBufferData(0x8892,len(data),source,0x88e4)
        pointer=self.gl.glMapBufferRange(0x8892,0,len(data),1)
        if not pointer:raise ValueError('Native mesh buffer GPU readback is unavailable')
        actual=C.string_at(pointer,len(data));unmapped=self.gl.glUnmapBuffer(0x8892)
        if not unmapped or self.gl.glGetError() or actual!=data:
            raise ValueError('Native mesh GPU buffer differs from original vertex writer')
        record={'glHandle':handle.value,'flags':flags,'bytes':len(data),'bytesHex':data.hex(),
            'gpuReadbackSha256':sha(actual),'gpuBytesVerified':True}
        self.buffer_records.append(record);return record

    def create_layout(self,descriptor,count):
        if not 0<count<=16 or len(descriptor)!=count*8:raise ValueError('Unadmitted native vertex-layout descriptor')
        handle=C.c_uint();self.gl.glGenVertexArrays(1,C.byref(handle));self.vaos.append(handle)
        self.gl.glBindVertexArray(handle)
        if self.gl.glGetError():raise ValueError('Native mesh vertex-array allocation failed')
        record={'glHandle':handle.value,'descriptorHex':descriptor.hex(),'attributeCount':count,
            'bindings':[],'shaderAttributeLocationsBound':False}
        self.layout_records.append(record);return record

    def close(self):
        for handle in self.vaos:self.gl.glDeleteVertexArrays(1,C.byref(handle))
        for handle in self.buffers:self.gl.glDeleteBuffers(1,C.byref(handle))
        self.vaos.clear();self.buffers.clear()

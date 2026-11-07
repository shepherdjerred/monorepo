"""Real offscreen GLES uploads for the ported native texture-device interface.

Only the recovered BGRA8_UNORM and R32_FLOAT formats are admitted. No browser,
desktop, League process, driver emulation or successful-resource stub is used.
"""
import ctypes as C
import importlib.util
from pathlib import Path
import struct

spec=importlib.util.spec_from_file_location('native_texture_draw',Path(__file__).with_name('render-particle-shader.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


class GraphicsTextureDevice(adapter.Draw):
    def __init__(self,directory):
        super().__init__(directory)
        requestable=self.gl.glGetString(0x93a8)
        if not requestable or b'GL_EXT_color_buffer_float' not in requestable.split():
            raise ValueError('ANGLE cannot expose the float readback capability')
        address=self.egl.eglGetProcAddress(b'glRequestExtensionANGLE')
        if not address:raise ValueError('ANGLE extension request API is absent')
        C.WINFUNCTYPE(None,C.c_char_p)(address)(b'GL_EXT_color_buffer_float')
        if b'GL_EXT_color_buffer_float' not in self.gl.glGetString(0x1f03).split() or self.gl.glGetError():
            raise ValueError('ANGLE float readback extension was not enabled')
        self.fn(self.gl,'glTexImage3D',None,C.c_uint,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p)
        self.fn(self.gl,'glFramebufferTextureLayer',None,C.c_uint,C.c_uint,C.c_uint,C.c_int,C.c_int)
        self.uploads=[]

    @staticmethod
    def canonical(native_format,pixels):
        if native_format==2:
            if len(pixels)%4:raise ValueError('BGRA input width differs')
            rgba=bytearray(pixels)
            rgba[0::4],rgba[2::4]=pixels[2::4],pixels[0::4]
            return bytes(rgba)
        if native_format==0x15:
            if len(pixels)%4:raise ValueError('R32F input width differs')
            return pixels
        raise ValueError('Unadmitted native graphics format')

    def create(self,request):
        kind=request['kind'];fmt=request['nativeFormat'];levels=request['levels']
        targets={'2d':0x0de1,'array':0x8c1a,'cube':0x8513}
        if kind not in targets or fmt not in [2,0x15] or not levels:
            raise ValueError('Unadmitted graphics texture request')
        width,height=request['width'],request['height'];layers=request['layers']
        if not all(type(v) is int and 0<v<=4096 for v in [width,height,layers]) or len(levels)>13:
            raise ValueError('Graphics dimensions exceed owned bounds')
        if kind=='cube' and (width!=height or layers!=6):raise ValueError('Invalid native cube dimensions')
        if kind=='2d' and layers!=1:raise ValueError('Invalid native 2D layer count')
        if self.gl.glGetError():raise ValueError('GLES already has an error before texture upload')
        handle=C.c_uint();self.gl.glGenTextures(1,C.byref(handle));self.textures.append(handle)
        target=targets[kind];self.gl.glBindTexture(target,handle)
        self.gl.glTexParameteri(target,0x2801,0x2600 if len(levels)==1 else 0x2700)
        self.gl.glTexParameteri(target,0x2800,0x2600)
        for axis in [0x2802,0x2803,0x8072]:self.gl.glTexParameteri(target,axis,0x812f)
        self.gl.glTexParameteri(target,0x813d,len(levels)-1)
        internal,external,pixel_type=(0x8058,0x1908,0x1401) if fmt==2 else (0x822e,0x1903,0x1406)
        canonical=[]
        for mip,planes in enumerate(levels):
            w,h=max(1,width>>mip),max(1,height>>mip)
            if len(planes)!=layers or any(len(p)!=w*h*4 for p in planes):
                raise ValueError('Native texture data does not cover every mip/layer')
            converted=[self.canonical(fmt,p) for p in planes];canonical.append(converted)
            if kind=='array':
                data=C.create_string_buffer(b''.join(converted))
                self.gl.glTexImage3D(target,mip,internal,w,h,layers,0,external,pixel_type,data)
            else:
                for face,pixels in enumerate(converted):
                    data=C.create_string_buffer(pixels)
                    self.gl.glTexImage2D(0x8515+face if kind=='cube' else target,mip,internal,w,h,0,external,pixel_type,data)
        if self.gl.glGetError():raise ValueError('Native texture GLES upload failed')
        readbacks=[]
        self.gl.glBindFramebuffer(0x8d40,self.framebuffer)
        for mip,planes in enumerate(canonical):
            w,h=max(1,width>>mip),max(1,height>>mip)
            for layer,expected in enumerate(planes):
                if kind=='array':self.gl.glFramebufferTextureLayer(0x8d40,0x8ce0,handle,mip,layer)
                else:self.gl.glFramebufferTexture2D(0x8d40,0x8ce0,0x8515+layer if kind=='cube' else target,handle,mip)
                if self.gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5:
                    raise ValueError('Native texture readback framebuffer is incomplete')
                actual=C.create_string_buffer(w*h*(4 if fmt==2 else 16))
                self.gl.glReadPixels(0,0,w,h,0x1908,0x1401 if fmt==2 else 0x1406,actual)
                if self.gl.glGetError():raise ValueError('Native texture GLES readback failed')
                data=actual.raw
                if fmt==0x15:
                    values=struct.unpack('<'+'f'*(w*h*4),data)
                    if any(values[i:i+4][1:]!=(0.0,0.0,1.0) for i in range(0,len(values),4)):
                        raise ValueError('Native R32F readback channels differ')
                    data=struct.pack('<'+'f'*(w*h),*values[0::4])
                if data!=expected:raise ValueError('Native texture GPU bytes differ from uploaded source')
                readbacks.append({'mip':mip,'layer':layer,'bytes':len(data),'sha256':adapter.sha(data)})
        record={'kind':kind,'nativeFormat':fmt,'width':width,'height':height,'layers':layers,
            'mips':len(levels),'glHandle':handle.value,'nativeSourceSha256':adapter.sha(b''.join(p for level in levels for p in level)),
            'readbacks':readbacks,'gpuBytesVerified':True}
        self.uploads.append(record)
        return record

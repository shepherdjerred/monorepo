"""Exact native format24 / Metal125 RGBA32Float uploads with full GPU readback.

The original format table selects four32-bit float channels. No normalized-byte
substitute or color conversion is used. Other native formats remain unadmitted.
Reference: https://developer.apple.com/documentation/metal/mtlpixelformat/rgba32float
"""
import ctypes as C
import hashlib
import struct


def digest(data):return hashlib.sha256(data).hexdigest()


class GraphicsFloat4TextureDevice:
    def __init__(self,device,image):
        self.device,self.gl=device,device.gl
        if struct.unpack_from('<Q',image,0x20ee060+24*8)[0]!=125:raise ValueError('Exact original RGBA32Float format mapping differs')
        self.records=[]

    def create(self,request):
        kind,fmt,levels=request['kind'],request['nativeFormat'],request['levels']
        width,height,layers=request['width'],request['height'],request['layers']
        if fmt!=24 or kind not in ['2d','array','cube'] or not 1<=len(levels)<=13 or not all(type(value) is int and 0<value<=4096 for value in [width,height,layers]):raise ValueError('Exact bounded native float4 texture request required')
        if kind=='2d' and layers!=1 or kind=='cube' and (width!=height or layers!=6):raise ValueError('Native float4 texture layer/dimension mismatch')
        gl=self.gl
        if gl.glGetError():raise ValueError('GLES has an error before original float4 upload')
        handle=C.c_uint();gl.glGenTextures(1,C.byref(handle));self.device.textures.append(handle)
        target={'2d':0x0de1,'array':0x8c1a,'cube':0x8513}[kind]
        gl.glBindTexture(target,handle);gl.glTexParameteri(target,0x2801,0x2600 if len(levels)==1 else 0x2700);gl.glTexParameteri(target,0x2800,0x2600)
        for axis in [0x2802,0x2803,0x8072]:gl.glTexParameteri(target,axis,0x812f)
        gl.glTexParameteri(target,0x813d,len(levels)-1)
        for mip,planes in enumerate(levels):
            w,h=max(1,width>>mip),max(1,height>>mip)
            if len(planes)!=layers or any(len(data)!=w*h*16 for data in planes):raise ValueError('Original float4 mip/face/layer bytes incomplete')
            if kind=='array':
                data=C.create_string_buffer(b''.join(planes));gl.glTexImage3D(target,mip,0x8814,w,h,layers,0,0x1908,0x1406,data)
            else:
                for face,pixels in enumerate(planes):
                    data=C.create_string_buffer(pixels);gl.glTexImage2D(0x8515+face if kind=='cube' else target,mip,0x8814,w,h,0,0x1908,0x1406,data)
        if gl.glGetError():raise ValueError('Original float4 GLES upload failed')
        readbacks=[];gl.glBindFramebuffer(0x8d40,self.device.framebuffer)
        for mip,planes in enumerate(levels):
            w,h=max(1,width>>mip),max(1,height>>mip)
            for layer,expected in enumerate(planes):
                if kind=='array':gl.glFramebufferTextureLayer(0x8d40,0x8ce0,handle,mip,layer)
                else:gl.glFramebufferTexture2D(0x8d40,0x8ce0,0x8515+layer if kind=='cube' else target,handle,mip)
                if gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5:raise ValueError('Original float4 readback framebuffer incomplete')
                actual=C.create_string_buffer(w*h*16);gl.glReadPixels(0,0,w,h,0x1908,0x1406,actual)
                if gl.glGetError() or actual.raw!=expected:raise ValueError('Original float4 GPU readback bytes differ')
                readbacks.append({'mip':mip,'layer':layer,'bytes':len(expected),'sha256':digest(expected)})
        record={'kind':kind,'nativeFormat':24,'metalPixelFormat':125,'storage':'RGBA32Float','width':width,'height':height,'layers':layers,'mips':len(levels),'glHandle':handle.value,'nativeSourceSha256':digest(b''.join(data for level in levels for data in level)),'readbacks':readbacks,'gpuBytesVerified':True}
        self.records.append(record);return record

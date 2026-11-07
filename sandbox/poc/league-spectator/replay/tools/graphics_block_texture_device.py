"""Decode native BC blocks into RGBA8 and verify every GPU face/mip exactly.

This port deliberately uses deterministic software decoding, as the static DDS
preparation path does. It does not claim native GPU block decompression parity.
Encoded source hashes and native format metadata remain separate from storage.
"""
import ctypes as C
import hashlib
import struct
import PIL
from PIL import Image

# Native format -> (exact-build Metal format, bytes/block, Pillow code, mode,
# format name). BC4 must sample (r,0,0,1), rather than a grayscale expansion.
FORMATS = {
    6:(130,8,1,'RGBA','BC1'),
    7:(132,16,2,'RGBA','BC2'),
    8:(134,16,3,'RGBA','BC3'),
    9:(140,8,4,'L','BC4'),
    10:(142,16,5,'RGB','BC5'),
    11:(152,16,7,'RGBA','BC7'),
}


def digest(data):return hashlib.sha256(data).hexdigest()


def decode_plane(fmt,width,height,data):
    if fmt not in FORMATS or not 0<width<=4096 or not 0<height<=4096:
        raise ValueError('Unadmitted BC plane format/dimensions')
    _,block_bytes,bcn,mode,name=FORMATS[fmt]
    if len(data)!=((width+3)//4)*((height+3)//4)*block_bytes:
        raise ValueError('Compressed plane byte count differs')
    image=Image.frombytes(mode,(width,height),data,'bcn',(bcn,name))
    if name=='BC4':
        image=Image.merge('RGBA',(image,Image.new('L',image.size),Image.new('L',image.size),Image.new('L',image.size,255)))
    return image.convert('RGBA').tobytes()


class GraphicsBlockTextureDevice:
    def __init__(self,device,image):
        self.device,self.gl = device,device.gl
        self.records = []
        table = list(struct.unpack_from('<29Q',image,0x20ee060))
        if table != [81,81,80,80,0,0,130,132,134,140,142,152,0,0,0,0,10,1,255,255,252,55,105,115,125,73,65,53,92]:
            raise ValueError('Exact-build native texture/Metal format table differs')
        device.fn(self.gl,'glGetIntegerv',None,C.c_uint,C.POINTER(C.c_int))

    def create(self,request):
        fmt,kind,levels=request['nativeFormat'],request['kind'],request['levels']
        if fmt not in FORMATS or kind not in ['2d','array','cube'] or not 1<=len(levels)<=13:
            raise ValueError('Unadmitted compressed texture shape/format')
        metal,block_bytes,_,_,name=FORMATS[fmt]
        width,height,layers=request['width'],request['height'],request['layers']
        if (not all(type(v) is int and 0<v<=4096 for v in [width,height,layers]) or
                kind=='2d' and layers!=1 or kind=='cube' and (layers!=6 or width!=height)):
            raise ValueError('Compressed texture dimensions exceed owned bounds')
        converted=[]
        for mip,planes in enumerate(levels):
            w,h=max(1,width>>mip),max(1,height>>mip)
            size=((w+3)//4)*((h+3)//4)*block_bytes
            if len(planes)!=layers or any(len(plane)!=size for plane in planes):
                raise ValueError('Compressed texture does not contain every complete face/mip')
            output=[]
            for data in planes:
                rgba=decode_plane(fmt,w,h,data)
                bgra=bytearray(rgba);bgra[0::4],bgra[2::4]=rgba[2::4],rgba[0::4]
                output.append(bytes(bgra))
            converted.append(output)
        gl=self.gl
        def integer(token):
            value=C.c_int();gl.glGetIntegerv(token,C.byref(value));return value.value
        # The shared upload helper owns its readback framebuffer and mutates
        # texture bindings. Restore those to avoid changing native draw state.
        target={'2d':0x0de1,'array':0x8c1a,'cube':0x8513}[kind]
        binding={'2d':0x8069,'array':0x8c1d,'cube':0x8514}[kind]
        saved={'active':integer(0x84e0),'texture':integer(binding),
               'drawFramebuffer':integer(0x8ca6),'readFramebuffer':integer(0x8caa)}
        try:
            gpu=self.device.create({**request,'nativeFormat':2,'levels':converted})
        finally:
            gl.glBindFramebuffer(0x8ca9,saved['drawFramebuffer'])
            gl.glBindFramebuffer(0x8ca8,saved['readFramebuffer'])
            gl.glBindTexture(target,saved['texture']);gl.glActiveTexture(saved['active'])
        if not gpu['gpuBytesVerified']:raise ValueError('Decoded BC texture lacks exact GPU readback')
        readbacks=[{**row,'encodedSha256':digest(levels[row['mip']][row['layer']])} for row in gpu['readbacks']]
        record={**gpu,'nativeFormat':fmt,'metalFormat':metal,'compression':name,'readbacks':readbacks,
                'nativeSourceSha256':digest(b''.join(p for level in levels for p in level)),
                'decodedBgraSourceSha256':gpu['nativeSourceSha256'],'gpuStorageFormat':'RGBA8_UNORM',
                'decoder':{'library':'Pillow','version':PIL.__version__,'codec':'bcn/'+name},
                'compressedBlocksUploadedUnchanged':False,'gpuDecodedPixelsVerified':True,
                'nativeGpuBlockDecompressionVerified':False}
        self.records.append(record)
        return record

    def close(self):pass

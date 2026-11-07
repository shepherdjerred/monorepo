"""Strict legacy BC1 DDS cube import; retain every authored face and mip.

DDS stores each face's full mip chain before the next face. No face is
duplicated, flipped, generated or substituted. Pillow supplies BC1 decoding.
"""
import struct
from PIL import Image

FACE_NAMES=['+X','-X','+Y','-Y','+Z','-Z']


def decode_cube(raw):
    if len(raw)<128 or raw[:4]!=b'DDS ' or struct.unpack_from('<I',raw,4)[0]!=124:
        raise ValueError('Invalid legacy DDS header')
    flags,height,width,linear,depth,mip_count=struct.unpack_from('<6I',raw,8)
    levels=mip_count or 1
    expected_flags=0x81007 | (0x20000 if levels>1 else 0)
    caps,caps2,caps3,caps4,reserved=struct.unpack_from('<5I',raw,108)
    if (flags!=expected_flags or width!=height or not 0<width<=4096 or width&(width-1) or
            depth or not 1<=levels<=width.bit_length() or (mip_count not in [0,1] and levels==1) or
            caps!=(0x1008 | (0x400000 if levels>1 else 0)) or caps2!=0xfe00 or caps3 or caps4 or reserved or
            any(raw[32:76]) or struct.unpack_from('<II',raw,76)!=(32,4) or raw[84:88]!=b'DXT1' or any(raw[88:108])):
        raise ValueError('Unadmitted DDS: require complete square legacy BC1 cube with authored mip chain')
    sizes=[max(1,(max(1,width>>mip)+3)//4)**2*8 for mip in range(levels)]
    if linear!=sizes[0] or len(raw)!=128+6*sum(sizes):
        raise ValueError('DDS does not contain exactly six complete face/mip chains')
    result=[[] for _ in sizes];offset=128
    for face in range(6):
        for mip,size in enumerate(sizes):
            side=max(1,width>>mip);encoded=raw[offset:offset+size]
            rgba=Image.frombytes('RGBA',(side,side),encoded,'bcn',(1,'BC1')).tobytes()
            result[mip].append({'face':face,'mip':mip,'width':side,'height':side,
                'sourceOffset':offset,'sourceBytes':size,'rgba':rgba})
            offset+=size
    return {'kind':'cube','width':width,'height':height,'layers':6,'mips':levels,'levels':result}

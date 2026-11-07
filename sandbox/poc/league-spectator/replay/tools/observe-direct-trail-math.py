"""Original mode1 join fragment and math helpers on explicit owned vectors."""
import argparse
import ctypes
import hashlib
import json
from pathlib import Path
import struct
import unicorn
from unicorn import x86_const as r
from macho import MachImage

def sha(data): return hashlib.sha256(data).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();package=cache/'public/decoder-16.21-macos'
    paths=[package/'profile.json',package/'image.bin',args.client,Path(__file__),Path(__file__).with_name('macho.py')]
    inputs={str(p.resolve()):sha(p.read_bytes()) for p in paths}
    profile=json.loads((package/'profile.json').read_bytes());image=(package/'image.bin').read_bytes()
    source=MachImage(args.client.read_bytes())
    if (profile['clientVersion']!='16.21.829.8620' or profile['protocolDigest']!='20e09df23c66b85e' or
        sha(image)!=profile['decoderImageSha256'] or sha(source.binary)!=profile['sliceSha256'] or
        source.imports.get(0x1fee720)!='_atan2f'):
        raise ValueError('Exact original trail math image required')
    ranges=[(0x17380df,0x1738408),(0x148dfa0,0x148e0ca),(0x1489360,0x1489447),
            (0x148e7d0,0x148e918),(0x148a750,0x148a7ae),(0x20e0090,0x20e0090+14400)]
    for a,b in ranges:
        if image[a:b]!=source.image[a:b]:raise ValueError('Original trail math instructions differ')
    base=profile['imageBase'];u=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
    u.mem_map(base,len(image));u.mem_write(base,image);u.mem_map(0x10000000,0x20000)
    stop,stack,frame,primitive=0x10000000,0x10018008,0x10008000,0x10002000
    a_at,b_at=0x10003000,0x10003100
    initial=u.context_save();f=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
    xmm=lambda values:int.from_bytes(struct.pack('<4f',*(list(values)+[0]*4)[:4]),'little')
    crt=Path('C:/Windows/System32/ucrtbase.dll');inputs[str(crt)]=sha(crt.read_bytes())
    atan2=ctypes.CDLL(str(crt)).atan2f;atan2.argtypes=[ctypes.c_float,ctypes.c_float];atan2.restype=ctypes.c_float
    atan_calls=[]
    def external(uc,address,size,user):
        values=[struct.unpack('<f',(uc.reg_read(reg)&0xffffffff).to_bytes(4,'little'))[0]
                for reg in [r.UC_X86_REG_XMM0,r.UC_X86_REG_XMM1]]
        result=atan2(*values);atan_calls.append({'inputs':values,'result':result})
        uc.reg_write(r.UC_X86_REG_XMM0,xmm([result]));sp=uc.reg_read(r.UC_X86_REG_RSP)
        uc.reg_write(r.UC_X86_REG_RIP,struct.unpack('<Q',uc.mem_read(sp,8))[0]);uc.reg_write(r.UC_X86_REG_RSP,sp+8)
    u.hook_add(unicorn.UC_HOOK_CODE,external,begin=base+0x1fee720,end=base+0x1fee720)
    def call(entry,registers,end=None):
        u.context_restore(initial);u.mem_write(stack,struct.pack('<Q',stop));u.reg_write(r.UC_X86_REG_RSP,stack)
        for reg,value in registers.items():u.reg_write(reg,value)
        expected=base+end if end else stop
        u.emu_start(base+entry,expected,count=10000)
        if u.reg_read(r.UC_X86_REG_RIP)!=expected:raise ValueError('Trail math escaped bounded original instructions')
    trig=[]
    for angle in [-360,-359.95,-180.05,-.1,-.05,0,.05,.1,13.37,89.999,90,359.99,360]:
        outputs=[]
        for entry in [0x1489360,0x14893d0]:
            call(entry,{r.UC_X86_REG_XMM0:xmm([angle])});outputs.append((u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff).to_bytes(4,'little').hex())
        trig.append({'angle':f(angle),'sinHex':outputs[0],'cosHex':outputs[1]})
    pairs=[([1,0,0],[1,0,0]),([1,0,0],[-1,0,0]),([1,0,0],[0,1,0]),
           ([1,2,3],[-1,1,2]),([.3,-.2,.9],[.1,.5,-.7])]
    angles=[]
    for a,b in pairs:
        u.mem_write(a_at,struct.pack('<3f',*a));u.mem_write(b_at,struct.pack('<3f',*b))
        call(0x148dfa0,{r.UC_X86_REG_RDI:a_at,r.UC_X86_REG_RSI:b_at})
        angles.append({'a':a,'b':b,'angleHex':(u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff).to_bytes(4,'little').hex()})
    joins=[]
    for a,b in pairs+[([0,0,0],[1,2,3]),([1,2,3],[0,0,0])]:
        for length in [0,.1,10]:
            for first in [False,True]:
                width,previous_width=2.,1.25
                u.mem_write(frame-0x50,struct.pack('<3f',*a));u.mem_write(frame-0x38,struct.pack('<3f',*b))
                u.mem_write(frame-0xac,struct.pack('<f',length));u.mem_write(frame-0x9c,struct.pack('<f',previous_width))
                u.mem_write(frame-0x29,b'\x01');u.mem_write(primitive+0x30,b'\x01')
                call(0x17380df,{r.UC_X86_REG_RBP:frame,r.UC_X86_REG_R9:primitive,r.UC_X86_REG_R13:int(first),
                    r.UC_X86_REG_XMM8:int.from_bytes(bytes.fromhex('00000080')*4,'little'),
                    r.UC_X86_REG_XMM9:xmm([width]),r.UC_X86_REG_XMM1:xmm([b[0]]),
                    r.UC_X86_REG_XMM0:xmm([b[1],b[2]]),r.UC_X86_REG_XMM2:xmm([b[2]])},0x1738408)
                joins.append({'previousOffset':a,'currentOffset':b,'width':width,'previousWidth':previous_width,
                    'segmentLength':f(length),'first':first,'offsetHex':bytes(u.mem_read(frame-0x38,12)).hex()})
    report={'schema':1,'kind':'original-direct-trail-mode1-math-controls','build':profile['clientVersion'],
        'protocol':profile['protocolDigest'],'inputs':inputs,'ranges':[{'rva':a,'bytes':b-a,'sha256':sha(image[a:b])} for a,b in ranges],
        'trig':trig,'angles':angles,'joins':joins,'atan2Calls':atan_calls,
        'scope':{'originalWholeMode1JoinFragment':True,'originalAngleAndTrigHelpers':True,
            'suppliedOwnedVectors':True,'windowsAtan2FloatAdapter':True,'originalMacosLibmCaptured':False,
            'wholeTrailWriter':False,'actualMatchCoverage':False}}
    output=cache/'research/direct-trail-math-native.json';output.write_text(json.dumps(report,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(output),'trig':len(trig),'angles':len(angles),'joins':len(joins)}))

if __name__=='__main__':main()

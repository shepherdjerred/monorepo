"""Owned-input execution of original navmesh fade/blur parameter fragments."""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn import x86_const as r

BASE, DATA = 0x100000000, 0x10000000
def sha(data): return hashlib.sha256(data).hexdigest()
def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve(); inputs = {}
    def raw(path):
        path = Path(path).resolve(); data = path.read_bytes(); inputs[str(path)] = sha(data); return data
    raw(__file__)
    profile = json.loads(raw(cache / 'public/decoder-16.21-macos/profile.json'))
    image = raw(cache / 'public/decoder-16.21-macos/image.bin')
    if sha(image) != profile['decoderImageSha256']: raise ValueError('Pinned original image required')
    u = Uc(UC_ARCH_X86, UC_MODE_64)
    u.mem_map(BASE, (len(image) + 4095) & ~4095); u.mem_write(BASE, image)
    u.mem_map(DATA, 0x10000)
    manager, texture, frame = DATA + 0x1000, DATA + 0x2000, DATA + 0xf000
    def put(address, fmt, *values): u.mem_write(address, struct.pack('<' + fmt, *values))
    def run(start, end): u.emu_start(BASE + start, BASE + end, count=100)
    def vector(address):
        data = bytes(u.mem_read(address,16)); return {'hex': data.hex(), 'values': list(struct.unpack('<4f',data))}
    ranges = [(0x7400e3,0x7400f7), (0x740cef,0x740d1f), (0x7414ba,0x7414ee), (0x741565,0x741585)]
    u.reg_write(r.UC_X86_REG_RBX,manager); run(*ranges[0])
    defaults = list(struct.unpack('<3f',u.mem_read(manager+0x18,12)))
    if [struct.pack('<f',v).hex() for v in defaults] != ['dee3633e','0807c73e','d2adba3f']:
        raise ValueError('Original manager defaults differ')
    fades = []
    for now,last in [(0,0),(1,0),(0,1),(.1,0),(10000.1,10000),(1e6+.1,1e6),(-10,-11),(1e-20,0),(.123456789,.111111111)]:
        u.reg_write(r.UC_X86_REG_RBX,manager); u.reg_write(r.UC_X86_REG_RBP,frame)
        u.reg_write(r.UC_X86_REG_XMM0,int.from_bytes(struct.pack('<f',now),'little')); put(manager+0x10,'f',last)
        run(*ranges[1]); fades.append({'now':now,'lastUpdate':last,'parameters':vector(frame-0x40)})
    blurs = []
    for width,height in [(1,1),(256,512),(512,256),(16777217,0xffffffff),(0xffffffff,16777217)]:
        for center,side,radius in [defaults,[.5,.25,1],[1,0,0],[-.5,2,-3],[1e-10,1e10,.123456789]]:
            put(texture+0x28,'II',width,height); put(manager+0x18,'fff',center,side,radius)
            u.reg_write(r.UC_X86_REG_RDI,manager); u.reg_write(r.UC_X86_REG_RDX,texture);u.reg_write(r.UC_X86_REG_RBP,frame)
            run(*ranges[2]); horizontal=vector(frame-0x58)
            u.reg_write(r.UC_X86_REG_RBX,manager); run(*ranges[3]); vertical=vector(frame-0x48)
            if not all(math.isfinite(v) for v in horizontal['values']+vertical['values']): raise ValueError('Finite native controls required')
            blurs.append({'width':width,'height':height,'manager':{'centerWeight':center,'sideWeight':side,'radius':radius},
                          'horizontal':horizontal,'vertical':vertical})
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest: raise ValueError('Native navmesh filter input changed')
    result = {'schema':1,'kind':'original-navmesh-filter-parameter-fragments','build':profile['clientVersion'],
              'protocol':profile['protocolDigest'],'decoderImageSha256':profile['decoderImageSha256'],'inputs':inputs,
              'originalBlocks':[{'rva':a,'size':z-a,'sha256':sha(image[a:z])} for a,z in ranges],
              'defaults':{'centerWeight':defaults[0],'sideWeight':defaults[1],'radius':defaults[2]},'fades':fades,'blurs':blurs,
              'scope':{'originalInstructionBytes':True,'ownedExplicitClockManagerTextureDimensions':True,
                       'wholeProducerExecuted':False,'shaderSamplingExecuted':False,'r8QuantizationExecuted':False,'gpuSubmitted':False}}
    output=cache/'research/navmesh-filter-math-native.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'fades':len(fades),'blurs':len(blurs)}))
if __name__ == '__main__':main()

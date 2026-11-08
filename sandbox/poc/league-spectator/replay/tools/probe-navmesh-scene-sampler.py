"""Original nav shared-texture publication arguments and backend sampler prefix.

The supplied GPU pointer is an opaque control: no decoded scene dispatch or
texture publication readiness is claimed. Original setter instructions execute;
the backend prefix stops before Metal allocation and its resulting descriptor
is independently created/queried on GLES.
"""
import argparse
import ctypes as C
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import cdtb.binfile as binfile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn import x86_const as r
from graphics_material_bindings import GraphicsMaterialBindings

spec=importlib.util.spec_from_file_location('nav_sampler_device',Path(__file__).with_name('render-particle-shader.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
BASE,DATA=0x100000000,0x10000000
def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('angle',type=Path)
    args=p.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Sampler input changed')
        inputs[str(path)]=digest;return data
    profile=json.loads(raw(cache/'public/decoder-16.21-macos/profile.json'))
    image=raw(cache/'public/decoder-16.21-macos/image.bin')
    if sha(image)!=profile['decoderImageSha256']:raise ValueError('Exact original image required')
    index=json.loads(raw(cache/'research/global-asset-inputs/index.json'))
    sources=[s for s in index['jobs'] if s['path']=='assets/shaders/shareddata.bin']
    if len(sources)!=1:raise ValueError('Unique installed shared definition required')
    source=sources[0];data=raw(source['source'])
    if sha(data)!=source['sha256']:raise ValueError('Installed shared BIN changed')
    for name in ['binfields','bintypes','binentries','binhashes','binhashes_xxh3','binpaths']:
        getattr(binfile,'hashfile_'+name).hashes={}
    definitions=binfile.BinFile(io.BytesIO(data))
    roots=[root for root in definitions.entries if root.path.h==0x85390927]
    if len(roots)!=1:raise ValueError('Original shared-data root required')
    textures=[f.value for f in roots[0].fields if f.name.h==0x99108c85]
    if len(textures)!=1:raise ValueError('Original shared textures vector required')
    nav=[t for t in textures[0].values if any(f.name.h==0x8d39bde6 and f.value=='NAVMESH_MASK_TEXTURE' for f in t.fields)]
    if len(nav)!=1 or nav[0].type.h!=0x3745189b or any(f.name.h==0x5d26f54f for f in nav[0].fields):
        raise ValueError('Exact original NAVMESH texture without authored SAMPLER link required')
    ranges=[(0x19172a0,0x19172da),(0x745c18,0x745c42),(0x1917340,0x19173d3),
            (0x19172f0,0x19172f6),(0x192c752,0x192c77d),(0x1921878,0x19218a7)]
    u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(BASE,(len(image)+4095)&~4095);u.mem_write(BASE,image);u.mem_map(DATA,0x10000)
    obj,texture,stack,stop=DATA+0x1000,DATA+0x2000,DATA+0xf008,DATA
    def put(at,fmt,*values):u.mem_write(at,struct.pack('<'+fmt,*values))
    def call(at,regs,stack_args=()):
        put(stack,'Q',stop)
        for i,value in enumerate(stack_args):put(stack+8+i*8,'Q',value)
        u.reg_write(r.UC_X86_REG_RSP,stack)
        for reg,value in regs.items():u.reg_write(reg,value)
        u.emu_start(BASE+at,stop,count=1000)
        if u.reg_read(r.UC_X86_REG_RIP)!=stop:raise ValueError('Original control did not return')
    device=adapter.Draw(args.angle);backend=GraphicsMaterialBindings(device,None);controls=[]
    try:
        for changed in [False,True]:
            for pointer in [texture,texture+0x40]:
                u.mem_write(obj,b'\xa5'*0x48)
                call(0x19172a0,{r.UC_X86_REG_RDI:obj,r.UC_X86_REG_ESI:0,r.UC_X86_REG_EDX:0x12345678,r.UC_X86_REG_ECX:0xffffffff})
                if changed:
                    call(0x1917340,{r.UC_X86_REG_RDI:obj,r.UC_X86_REG_RSI:texture+0x80,
                         r.UC_X86_REG_EDX:2,r.UC_X86_REG_ECX:0,r.UC_X86_REG_R8D:2,r.UC_X86_REG_R9D:0xff112233},[0,4])
                before=bytes(u.mem_read(obj,0x38))
                u.reg_write(r.UC_X86_REG_RSP,stack-0x80);u.reg_write(r.UC_X86_REG_RBX,obj);u.reg_write(r.UC_X86_REG_RAX,pointer)
                u.emu_start(BASE+0x745c18,BASE+0x745c42,count=1000)
                if u.reg_read(r.UC_X86_REG_RIP)!=BASE+0x745c42:raise ValueError('Original publication callsite did not return')
                after=bytes(u.mem_read(obj,0x38))
                if (struct.unpack_from('<Q',after,8)[0]!=pointer or after[0x10:0x15].hex()!='0101000101' or
                        after[0x18:0x1c]!=bytes(4) or after[0x15:0x18]!=b'\xa5'*3 or
                        struct.unpack_from('<Q',after,0x28)[0]!=0):
                    raise ValueError(f'Original publication texture/sampler fields differ: {after.hex()}')
                # The platform-independent fields above are exactly those read
                # by the Metal backend. Execute its unchanged argument prefix,
                # stopping before the Metal resource allocator at191ff70.
                u.reg_write(r.UC_X86_REG_RSP,stack-0x80);u.reg_write(r.UC_X86_REG_RBX,obj)
                u.emu_start(BASE+0x192c752,BASE+0x191ff70,count=100)
                if u.reg_read(r.UC_X86_REG_RIP)!=BASE+0x191ff70:raise ValueError('Original sampler backend prefix did not reach allocator')
                registers=[u.reg_read(reg) for reg in [r.UC_X86_REG_ESI,r.UC_X86_REG_EDX,r.UC_X86_REG_ECX,r.UC_X86_REG_R8D,r.UC_X86_REG_R9D]]
                sp=u.reg_read(r.UC_X86_REG_RSP);arguments=list(struct.unpack('<4Q',u.mem_read(sp+8,32)))
                if registers!=[1,1,1,1,0] or arguments!=[1,0,1,1]:raise ValueError('Original specialized nav sampler arguments differ')
                descriptor=bytes(registers[:3])+b'\0'+struct.pack('<I',arguments[1])+bytes([registers[3],registers[4],arguments[0],arguments[3]])+bytes(4)
                gpu=backend.sampler(descriptor)
                controls.append({'changedViaOriginalSetter':changed,'suppliedOpaqueTexturePointer':pointer,
                    'beforeHex':before.hex(),'afterHex':after.hex(),'samplerArguments':registers+arguments,
                    'descriptorHex':descriptor.hex(),'gpuSampler':{k:v for k,v in gpu.items() if k!='glHandle'}})
    finally:backend.close();device.close()
    tools=Path(__file__).resolve().parent
    for module in tuple(sys.modules.values()):
        file=getattr(module,'__file__',None)
        if file and Path(file).suffix=='.py' and Path(file).resolve().is_relative_to(tools):raw(file)
    raw(__file__)
    raw(adapter.__file__);raw(adapter.adapter.__file__);raw(binfile.__file__)
    for name in ['libEGL.dll','libGLESv2.dll']:raw(args.angle/name)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Sampler source drift')
    output=cache/'research/navmesh-scene-sampler-native.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-nav-scene-sampler-publication-prefix',
        'build':profile['clientVersion'],'protocol':profile['protocolDigest'],'inputs':inputs,
        'originalBlocks':[{'rva':a,'size':b-a,'sha256':sha(image[a:b])} for a,b in ranges],
        'authoredNavTexture':{'typeHash':nav[0].type.h,'fieldHashes':[f.name.h for f in nav[0].fields],
                             'sharedSamplerLinkPresent':False,'sourceSha256':source['sha256']},
        'controls':controls,'scope':{'originalPublicationCallsiteArgumentsExecuted':True,
          'originalCpuSetterExecuted':True,'originalBackendSamplerArgumentPrefixExecuted':True,
          'glesSamplerCreatedAndQueried':True,'fullMetalSamplerAllocatorExecuted':False,
          'opaqueTextureControlNotOwnedSceneOutput':True,'decodedSceneDispatchExecuted':False,
          'runtimeAdmissionChanged':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'controls':len(controls),'descriptorHex':controls[0]['descriptorHex']}))


if __name__=='__main__':main()

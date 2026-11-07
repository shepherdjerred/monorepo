"""Prepare isolated original UCRT float kernels and their SysV/Win64 ABI shims.

The cold file image runs inside Unicorn. No Windows imports or loader are
provided. Retained samples compare the kernel/trampoline outputs with the exact
native math DLL used by the parent-frame reference, including signed zero.
"""
import argparse
import ctypes as C
import json
from pathlib import Path
import random
import struct
import capstone
from capstone.x86_const import X86_REG_RIP
import pefile
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import sha
from math_isa import collect_instruction, execute_instruction

NAMES=['sinf','cosf','acosf','atan2f','fmodf','powf','expf','sqrtf','modff']
TRAMPOLINE=0x30000000


def f32(x):return struct.unpack('<f',struct.pack('<f',x))[0]
def bits(x):return struct.pack('<f',x)
def call_code(address):return b'\x48\xb8'+struct.pack('<Q',address)+b'\xff\xd0'


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);args=p.parse_args();cache=args.cache.resolve()
    dll=Path('C:/Windows/System32/ucrtbase.dll');source=dll.read_bytes();native_raw=(cache/'research/parent-frames-native.json').read_bytes();native=json.loads(native_raw)
    if sha(source)!=native['mathProvider']['sha256']:raise ValueError('Native parent math reference DLL changed')
    pe=pefile.PE(data=source);base=pe.OPTIONAL_HEADER.ImageBase;size=pe.OPTIONAL_HEADER.SizeOfImage
    if pe.FILE_HEADER.Machine!=0x8664 or base!=0x180000000 or size%4096:raise ValueError('Unsupported original math image layout')
    image=pe.get_memory_mapped_image()
    if len(image)!=size:raise ValueError('Original math image does not cover its declared mapped size')
    exports={e.name.decode():e for e in pe.DIRECTORY_ENTRY_EXPORT.symbols if e.name}
    crt=C.CDLL(str(dll));entries={};code=bytearray(b'\xcc'*4096)
    dis=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);dis.detail=True;dis.skipdata=True
    entry=exports['sinf'].address;first=next(dis.disasm(image[entry:entry+16],entry))
    if first.mnemonic!='cmp' or first.operands[0].type!=capstone.CS_OP_MEM or first.operands[0].mem.base!=X86_REG_RIP:
        raise ValueError('Original float math dispatch policy must be identified explicitly')
    dispatch=first.address+first.size+first.operands[0].mem.disp
    if not 0x138000<=dispatch<len(image)-4:raise ValueError('Math dispatch policy is outside original data')
    policy=int.from_bytes(C.string_at(crt._handle+dispatch,4),'little')
    if policy not in [0,1,2,3]:raise ValueError('Unknown original math dispatch policy')
    file_policy=struct.unpack_from('<I',image,dispatch)[0];mapped=bytearray(image);struct.pack_into('<I',mapped,dispatch,policy);image=bytes(mapped)
    fma_instructions={}
    for section in pe.sections:
        if not section.Characteristics&0x20000000:continue
        start=section.VirtualAddress;end=start+section.Misc_VirtualSize
        for ins in dis.disasm(image[start:end],start):
            instruction=collect_instruction(dis,ins)
            if instruction is not None:fma_instructions[ins.address]=instruction
    source_image=bytes(image);lowered=bytearray(image)
    for instruction in fma_instructions.values():
        at=instruction['rva']
        replacement=b'\xcc'+b'\x90'*(instruction['bytes']-1)
        instruction['loweredHex']=replacement.hex();lowered[at:at+len(replacement)]=replacement
    image=bytes(lowered)
    for index,name in enumerate([*NAMES,'sincosf']):
        offset=index*128
        if name=='sincosf':
            frame=0x48
            body=(b'\x48\x83\xec\x48'+b'\xf3\x0f\x11\x44\x24\x20'+call_code(base+exports['sinf'].address)+
                b'\xf3\x0f\x11\x44\x24\x24'+b'\xf3\x0f\x10\x44\x24\x20'+call_code(base+exports['cosf'].address)+
                b'\xf3\x0f\x10\x4c\x24\x24'+b'\x0f\x14\xc8'+b'\x0f\x28\xc1')
            key='___sincosf_stret';width=2
        else:
            e=exports[name]
            if e.forwarder or C.cast(getattr(crt,name),C.c_void_p).value-crt._handle!=e.address:
                raise ValueError('Original math export is forwarded or differs from native reference')
            frame=0x28;body=b'\x48\x83\xec\x28'+(b'\x48\x89\xfa' if name=='modff' else b'')+call_code(base+e.address)
            key='_'+name;width=1
        return_offset=offset+len(body);body+=b'\x48\x83\xc4'+bytes([frame])+b'\xc3'
        if len(body)>128:raise ValueError('Math ABI trampoline exceeds its owned slot')
        code[offset:offset+len(body)]=body;entries[key]={'offset':offset,'bytes':len(body),'returnOffset':return_offset,
            'stackBytes':frame,'resultWidth':width,'exportRvas':[exports[n].address for n in ['sinf','cosf']] if name=='sincosf' else [exports[name].address]}
    regions=[]
    for section in pe.sections:
        if section.Characteristics&0x20000000:
            regions.append({'rva':section.VirtualAddress,'bytes':(section.Misc_VirtualSize+4095)&~4095})
    u=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64);u.mem_map(base,size);u.mem_write(base,image);u.mem_protect(base,size,unicorn.UC_PROT_READ)
    for region in regions:u.mem_protect(base+region['rva'],region['bytes'],unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC)
    u.mem_map(TRAMPOLINE,4096);u.mem_write(TRAMPOLINE,bytes(code));u.mem_protect(TRAMPOLINE,4096,unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC)
    u.mem_map(0x31000000,0x10000);initial=u.context_save();blocks={};fma_samples={};fma_count=0;fma_trace=[]
    fma_functions={}
    for width,name,ctype in [(32,'fmaf',C.c_float),(64,'fma',C.c_double)]:
        fn=getattr(crt,name);fn.argtypes=[ctype]*3;fn.restype=ctype;fma_functions[width]=fn
    def fma_adapter(uc,interrupt,user):
        nonlocal fma_count
        address=uc.reg_read(r.UC_X86_REG_RIP)-1;instruction=fma_instructions.get(address-base)
        if interrupt!=3 or instruction is None:raise ValueError(f'Unowned math ISA interrupt {interrupt} at {address:x}')
        if bytes(uc.mem_read(address,instruction['bytes'])).hex()!=instruction['loweredHex']:raise ValueError('Lowered FMA instruction bytes differ')
        if uc.reg_read(r.UC_X86_REG_MXCSR)&0xe040:raise ValueError('FMA requires nearest-even rounding and gradual underflow')
        dest=uc.reg_read(getattr(r,'UC_X86_REG_YMM'+str(instruction['destination'])))
        two=uc.reg_read(getattr(r,'UC_X86_REG_YMM'+str(instruction['source2'])))
        source3=instruction['source3']
        if 'register' in source3:three=uc.reg_read(getattr(r,'UC_X86_REG_YMM'+str(source3['register'])))
        elif 'integerRegister' in source3:three=uc.reg_read(getattr(r,'UC_X86_REG_'+source3['integerRegister'].upper()))
        elif 'immediate' in source3:three=source3['immediate']
        else:
            m=source3['memory'];pointer=(address+instruction['bytes'] if m['base']=='rip' else uc.reg_read(getattr(r,'UC_X86_REG_'+m['base'].upper())) if m['base'] else 0)
            if m['index']:pointer+=uc.reg_read(getattr(r,'UC_X86_REG_'+m['index'].upper()))*m['scale']
            pointer+=m['displacement'];three=int.from_bytes(uc.mem_read(pointer,m['bytes']),'little')
        if instruction['kind']!='fma':
            output=execute_instruction(instruction,dest,two,three,source3.get('bytes',source3.get('memory',{}).get('bytes',8)))
            uc.reg_write(getattr(r,'UC_X86_REG_YMM'+str(instruction['destination'])),output)
            uc.reg_write(r.UC_X86_REG_RIP,address+instruction['bytes']);fma_count+=1
            return
        width=instruction['precision'];mask=(1<<width)-1
        output=dest&((1<<128)-1) if instruction['lanes']==1 else 0
        for lane in range(instruction['lanes']):
            values=[(v>>(lane*width))&mask for v in [dest,two,three]]
            a,b,c={132:(values[0],values[2],values[1]),213:(values[1],values[0],values[2]),231:(values[1],values[2],values[0])}[instruction['order']]
            if instruction['negateProduct']:a^=1<<(width-1)
            if instruction['subtractAddend']:c^=1<<(width-1)
            code='f' if width==32 else 'd';numbers=[struct.unpack('<'+code,v.to_bytes(width//8,'little'))[0] for v in [a,b,c]]
            result=int.from_bytes(struct.pack('<'+code,fma_functions[width](*numbers)),'little')
            fma_samples[(width,a,b,c)]=result;output=(output&~(mask<<(lane*width)))|(result<<(lane*width))
            if len(fma_trace)<100:fma_trace.append({'rva':hex(instruction['rva']),'op':instruction['mnemonic'],'numbers':numbers,'result':struct.unpack('<'+code,result.to_bytes(width//8,'little'))[0]})
        uc.reg_write(getattr(r,'UC_X86_REG_YMM'+str(instruction['destination'])),output)
        uc.reg_write(r.UC_X86_REG_RIP,address+instruction['bytes']);fma_count+=1
    u.hook_add(unicorn.UC_HOOK_INTR,fma_adapter)
    def audit(uc,address,n,user):
        if base<=address<base+size:
            at=address-base
            if bytes(uc.mem_read(address,n))!=image[at:at+n]:raise ValueError('Original math code changed')
            blocks[(at,n)]={'rva':at,'bytes':n,'sha256':sha(image[at:at+n])}
    u.hook_add(unicorn.UC_HOOK_BLOCK,audit);rng=random.Random(0x42ab);samples=[]
    for key,entry in entries.items():
        name='sincosf' if key=='___sincosf_stret' else key[1:];fn=None if name=='sincosf' else getattr(crt,name)
        if fn:
            fn.argtypes=[C.c_float,C.POINTER(C.c_float)] if name=='modff' else [C.c_float]*(2 if name in ['atan2f','fmodf','powf'] else 1);fn.restype=C.c_float
        for i in range(257):
            x,y=rng.uniform(-1000,1000),rng.uniform(.01,100)
            if name=='acosf':x=rng.uniform(-1,1)
            if name=='powf':x=rng.uniform(.01,10);y=rng.uniform(-4,4)
            if name=='expf':x=rng.uniform(-80,80)
            if name=='sqrtf':x=abs(x)
            if i==0:x=5.4547014236450195 if name in ['sinf','cosf','sincosf'] else 0.0
            if i==1:x=-0.0
            if name=='powf' and i in [0,1]:y=2.0
            x,y=f32(x),f32(y);u.context_restore(initial);u.mem_write(0x3100ff08,struct.pack('<Q',0x31000000));u.mem_write(0x31001000,b'\xa5'*4)
            u.reg_write(r.UC_X86_REG_RSP,0x3100ff08);u.reg_write(r.UC_X86_REG_XMM0,int.from_bytes(bits(x),'little'))
            u.reg_write(r.UC_X86_REG_XMM1,int.from_bytes(bits(y),'little'));u.reg_write(r.UC_X86_REG_RDI,0x31001000)
            try:u.emu_start(TRAMPOLINE+entry['offset'],0x31000000,count=100000)
            except unicorn.UcError as error:
                raise ValueError(f'Math execution boundary: {name} sample {i}, x={x}, y={y}, rip={u.reg_read(r.UC_X86_REG_RIP):x}') from error
            if u.reg_read(r.UC_X86_REG_RIP)!=0x31000000 or u.reg_read(r.UC_X86_REG_RSP)!=0x3100ff10:
                raise ValueError('Original math trampoline exceeded its return/instruction bound')
            actual=(u.reg_read(r.UC_X86_REG_XMM0)&((1<<(32*entry['resultWidth']))-1)).to_bytes(4*entry['resultWidth'],'little')
            integer=None
            if name=='sincosf':
                expected=[]
                for n in ['sinf','cosf']:
                    f=getattr(crt,n);f.argtypes=[C.c_float];f.restype=C.c_float;expected.append(f(x))
                expected=b''.join(bits(v) for v in expected)
            elif name=='modff':
                integer=C.c_float();expected=bits(fn(x,C.byref(integer)))
                if bytes(u.mem_read(0x31001000,4))!=bits(integer.value):raise ValueError('Original modff integer output differs')
            else:expected=bits(fn(x,y) if name in ['atan2f','fmodf','powf'] else fn(x))
            if actual!=expected:
                (cache/'research/parent-math-fma-failure.json').write_text(json.dumps({'name':name,'x':x,'actual':actual.hex(),'expected':expected.hex(),'fma':fma_trace},indent=2))
                raise ValueError(f'Original {name} cold-kernel/ABI bytes differ from reference: {x} {y} {actual.hex()} {expected.hex()}')
            samples.append({'name':key,'xBits':bits(x).hex(),'yBits':bits(y).hex(),'expectedHex':expected.hex(),
                'integerHex':bits(integer.value).hex() if integer is not None else None})
    out=cache/'public/latest-parent-math';out.mkdir(exist_ok=True)
    image_file=f'image-{sha(image)}.bin';trampoline_file=f'abi-{sha(bytes(code))}.bin'
    (out/image_file).write_bytes(image);(out/trampoline_file).write_bytes(bytes(code))
    result={'schema':1,'kind':'prepared-original-ucrt-float-kernels','build':native['build'],'protocol':native['protocol'],
        'nativeObservationSha256':sha(native_raw),'source':{'file':str(dll),'sha256':sha(source),'preferredBase':base,'imageBytes':size,
            'coldFileState':True,'osLoaderEmulated':False},'image':{'file':image_file,'bytes':len(image),'sha256':sha(image),'executableRegions':regions},
        'trampolines':{'base':TRAMPOLINE,'file':trampoline_file,'bytes':len(code),'sha256':sha(bytes(code)),'entries':entries},
        'mathDispatch':{'rva':dispatch,'fileValue':file_policy,'referenceValue':policy},
        'isaInstructions':list(fma_instructions.values()),
        'samples':samples,'executedImageBlocks':list(blocks.values()),'sourceImageSha256':sha(source_image),'preparerSha256':sha(Path(__file__).read_bytes()),
        'isaProducerSha256':sha(Path(__file__).with_name('math_isa.py').read_bytes()),
        'counts':{'functions':len(entries),'nativeComparisons':len(samples),'emulatedIsaInstructions':fma_count,'fmaCases':len(fma_samples)},
        'scope':{'originalKernelCode':True,'abiTrampolinesCompared':True,'nativeUcrtCompared':True,'completeFloatDomainCompared':False,
            'referenceMathDispatchSupplied':True,'fusedInstructionIsaAdapter':True,
            'originalFmaInstructionsExecutedInUnicorn':False,'interruptBasedIsaLowering':True,
            'windowsImportsProvided':False,'wasmCompared':False,'originalMacosLibmVerified':False,'browserRun':False}}
    fma_reference={'schema':1,'kind':'native-fused-operation-reference','sourceSha256':sha(source),
        'cases':[{'width':w,'a':str(a),'b':str(b),'c':str(c),'expected':str(v)} for (w,a,b,c),v in fma_samples.items()]}
    fma_raw=json.dumps(fma_reference,indent=2).encode();(cache/'research/parent-math-fma-reference.json').write_bytes(fma_raw)
    result['fmaReferenceSha256']=sha(fma_raw)
    encoded=json.dumps(result,indent=2).encode();(out/'package.json').write_bytes(encoded)
    print(json.dumps({'sha256':sha(encoded),'imageSha256':sha(image),'counts':result['counts']}))


if __name__=='__main__':main()

"""Original material-binding CPU update kernels on supplied bounded layouts."""
import argparse
import ctypes
import inspect
import json
from pathlib import Path
from xxhash import xxh32_intdigest
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from game_mode_data_native import NativeGameModeData
from vfx_spawn_native import sha


class Control(NativeGameModeData):
    def __init__(self,*args):
        self.material_memcmp_calls=[]
        self.platform_memcmp=ctypes.CDLL('msvcrt.dll').memcmp
        self.platform_memcmp.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t]
        self.platform_memcmp.restype=ctypes.c_int
        super().__init__(*args)

    def imported(self,uc,address,size,user):
        if self.source.imports[address-self.base]!='_memcmp':
            return super().imported(uc,address,size,user)
        a,b,count=[uc.reg_read(reg)for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
        return_rva=self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
        if return_rva not in [0x19215ed,0x19216dd] or count>1048576 or not self.library_pointer(a,count) or not self.library_pointer(b,count):
            raise ValueError('Bounded original material memcmp caller required')
        left=ctypes.create_string_buffer(bytes(self.u.mem_read(a,count)))
        right=ctypes.create_string_buffer(bytes(self.u.mem_read(b,count)))
        value=self.platform_memcmp(left,right,count)
        self.material_memcmp_calls.append({'returnRva':return_rva,'bytes':count,'result':value})
        uc.reg_write(r.UC_X86_REG_RAX,value&0xffffffffffffffff);self.ret()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client,Control)
    n = fixture.native
    layout, rows, payload, destination, source = [n.allocate(size) for size in [16,48,24,96,64]]
    names = ['Tint', 'tint', 'MaterialParameterLongerThan16Bytes', 'Unknown', '']
    cases = []
    for kernel in [0x1921550,0x1921630]:
        for name in names:
            for count, size in [(0,16),(1,16),(1,32),(2,20),(0xffffffff,16)]:
                text = n.allocate_text(name)
                identity = xxh32_intdigest(name.encode('ascii'),seed=0)
                expected_hash = xxh32_intdigest(b'Tint',seed=0)
                # Duplicate same hash retains the first row. Case-sensitive
                # names with different hashes and missing names must miss.
                declarations = [(expected_hash,8,size),(expected_hash,48,16)]
                for index, row in enumerate(declarations):n.put(rows+index*12,'III',*row)
                n.put(layout,'QII',rows,len(declarations),len(declarations))
                initial = bytes(range(96))
                incoming = bytes(range(160,224))
                n.u.mem_write(destination,initial);n.u.mem_write(source,incoming)
                n.put(payload,'QQII',text,source,count,0)
                matching = next((row for row in declarations if row[0]==identity),None)
                amount = min(count*16,matching[2]) if matching else 0
                expected = bytearray(initial)
                if matching:expected[matching[1]:matching[1]+amount]=incoming[:amount]
                n.call(kernel,{r.UC_X86_REG_RDI:layout,r.UC_X86_REG_RSI:payload,r.UC_X86_REG_RDX:destination})
                changed = n.u.reg_read(r.UC_X86_REG_RAX)&255
                actual = bytes(n.u.mem_read(destination,len(initial)))
                if actual!=expected or changed!=int(actual!=initial):
                    raise ValueError('Original material uniform matching/copy differs')
                n.call(kernel,{r.UC_X86_REG_RDI:layout,r.UC_X86_REG_RSI:payload,r.UC_X86_REG_RDX:destination})
                if n.u.reg_read(r.UC_X86_REG_RAX)&255 or bytes(n.u.mem_read(destination,len(initial)))!=actual:
                    raise ValueError('Identical material uniform update is not a read-only no-op')
                cases.append({'kernelRva':kernel,'name':name,'xxh32':identity,'vectorCount':count,
                              'declarations':[{'hash':h,'offset':offset,'size':size}for h,offset,size in declarations],
                              'initialHex':initial.hex(),'sourceHex':incoming.hex(),'afterHex':actual.hex(),
                              'changed':bool(changed),'repeatChanged':False,'copiedBytes':amount})
    n.call(0x1921630,{r.UC_X86_REG_RDI:layout,r.UC_X86_REG_RSI:payload,r.UC_X86_REG_RDX:0})
    if n.u.reg_read(r.UC_X86_REG_RAX)&255:raise ValueError('Original nullable destination control differs')
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
           *[Path(inspect.getfile(c))for c in type(n).__mro__ if c is not object]}
    sources={str(path.resolve()):sha(path.read_bytes())for path in paths}
    ranges=[(0x1921550,0x1921611),(0x1921630,0x1921702),(0x1923070,0x19230ca),
            (0x17ba260,0x17ba4a5),(0x1499ab0,0x1499ac5),(0x1ac6af0,0x1ac6d32)]
    for start,end in ranges:
        if n.image[start:end]!=n.source.image[start:end]:raise ValueError('Original material kernel instructions differ')
    result={'schema':1,'kind':'original-material-uniform-update-kernel-controls',
            'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
            'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,'sources':sources,'cases':cases,
            'nullableDestinationReturnsFalse':True,
            'platformMemcmpCalls':n.material_memcmp_calls,
            'sourceBlocks':[{'rva':a,'size':b-a,'sha256':sha(n.image[a:b])}for a,b in ranges],
            'scope':{'originalCpuKernelsExecuted':True,'suppliedLayoutsAndPayloads':True,
                     'xxh32SeedZeroCaseSensitive':True,'firstHashMatch':True,'copyClampAndTailPreserved':True,
                     'realGpuUpload':False,'fullMetalMaterialBindingExecuted':False,
                     'actualRecordedMaterialInputsRecovered':False,'browserExecuted':False}}
    for path,digest in {**fixture.inputs,**sources}.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Input drift: '+path)
    output=fixture.cache/'research/material-uniform-update-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'repeatedControls':len(cases),'nullableControls':1}))


if __name__=='__main__':main()

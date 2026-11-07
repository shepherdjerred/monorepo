"""Control sprintf register/stack ABI and the original static name constructor."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from game_mode_data_native import NativeGameModeData
from libc_sprintf_native import NativeLibcSprintf
from vfx_spawn_native import ADDRESSES,sha


class NativeSprintf(NativeLibcSprintf,NativeGameModeData):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path);args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeSprintf);n=fixture.native
    matches=[at for at,name in n.source.imports.items() if name=='_sprintf']
    if len(matches)!=1:raise ValueError('One exact sprintf import required')
    cases=[]
    for label,format_,values,expected in [
        ('hex-width','#%08X',[0x955cc9c0],b'#955CC9C0'),
        ('integer-limits','%u %d',[0xffffffff,0xffffffd6],b'4294967295 -42'),
        ('signed-padding','%+06d %04x',[42,0xab],b'+00042 00ab'),
        ('register-overflow','%u %u %u %u %u %u',[1,2,3,4,5,6],b'1 2 3 4 5 6'),
        ('string-width','%-6s|%s',['abc','tail'],b'abc   |tail'),
        ('embedded-zero','%%:%c:X',[0],b'%:\0:X')]:
        destination=n.allocate(len(expected)+17);n.u.mem_write(destination+len(expected)+1,b'\xa5'*16)
        registers={r.UC_X86_REG_RDI:destination,r.UC_X86_REG_RSI:n.allocate_text(format_),r.UC_X86_REG_RAX:0}
        slots=[r.UC_X86_REG_RDX,r.UC_X86_REG_RCX,r.UC_X86_REG_R8,r.UC_X86_REG_R9]
        for i,value in enumerate(values):
            value=n.allocate_text(value) if isinstance(value,str) else value
            if i<len(slots):registers[slots[i]]=value
            else:n.put(ADDRESSES['stack']+8+(i-len(slots))*8,'Q',value)
        n.call(matches[0],registers)
        if (bytes(n.u.mem_read(destination,len(expected)+1))!=expected+b'\0' or
                n.u.reg_read(r.UC_X86_REG_RAX)!=len(expected) or
                bytes(n.u.mem_read(destination+len(expected)+1,16))!=b'\xa5'*16):
            raise ValueError('Sprintf bytes/count/guard differ: '+label)
        cases.append({'name':label,'passed':True})
    output=n.allocate(16)
    n.call(0x12f0e0,{r.UC_X86_REG_RDI:output,r.UC_X86_REG_RSI:0,r.UC_X86_REG_RDX:0,r.UC_X86_REG_RCX:0})
    if (n.cstring(n.base+0x246cb10)!=b'#955CC9C0' or n.allocations.get(n.q(output))!=0x28 or
            n.allocations.get(n.q(output+8))!=0x20):raise ValueError('Original static name/shared constructor differs')
    cases.append({'name':'original-static-name-constructor','passed':True,'entryRva':0x12f0e0})
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result={'schema':1,'kind':'libc-sprintf-abi-control','build':n.profile['clientVersion'],
            'inputs':fixture.inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
            'decoderImageSha256':sha(n.image),'originalBlocks':list(n.blocks.values()),
            'cases':cases,'calls':n.libc_sprintf_calls,
            'scope':{'platformAbiOnly':True,'originalStaticConstructorExecuted':True,'mainViewerExpanded':False}}
    target=fixture.cache/'research/libc-sprintf-native.json';target.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(target),'cases':len(cases)}))


if __name__=='__main__':main()

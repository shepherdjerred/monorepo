"""Exercise the libc++ boundary and original constructor on owned ABI inputs."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from legacy_effect_native import NativeLegacyEffectInputs
from libcpp_concat_native import LibcppConcat,CONCAT,read_libcpp_string
from vfx_spawn_native import sha
from vfx_object_native import NativeVfxObjects


class NativeStringInputs(LibcppConcat,NativeLegacyEffectInputs):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ['cache','client']:parser.add_argument(key,type=Path)
    args=parser.parse_args();fixture=NativeAIUnitFixture(args.cache,args.client,NativeStringInputs);n=fixture.native
    imports=[at for at,name in n.source.imports.items() if name==CONCAT]
    if len(imports)!=1:raise ValueError('Exact libc++ concatenation import is required')
    cases=[]
    for left,right in [(b'pre',b'fix'),(b'DATA/Characters/',b'Karthus/Skins/Skin10/Resources'),(b'',b''),(b'prefix:',b'a\0b')]:
        source=n.allocate(len(right)+1);n.u.mem_write(source,right+b'\0');rhs=n.allocate(24)
        n.call(0x11fe0,{r.UC_X86_REG_RDI:rhs,r.UC_X86_REG_RSI:source,r.UC_X86_REG_RDX:len(right)})
        prefix=n.allocate(len(left)+1);n.u.mem_write(prefix,left+b'\0')
        result=n.allocate(24,0xa5)
        n.call(imports[0],{r.UC_X86_REG_RDI:result,r.UC_X86_REG_RSI:prefix,r.UC_X86_REG_RDX:rhs})
        actual=read_libcpp_string(n,result)
        if actual!=left+right or n.u.reg_read(r.UC_X86_REG_RAX)!=result:raise ValueError('libc++ concatenation bytes or sret result differ')
        cases.append({'prefixHex':left.hex(),'rightHex':right.hex(),'resultHex':actual.hex(),'sretPointerVerified':True})
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(NativeVfxObjects)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result={'schema':1,'kind':'original-constructor-libcpp-concatenation-control','build':n.profile['clientVersion'],
            'inputs':fixture.inputs,'sources':{file.name:sha(file.read_bytes()) for file in sorted(paths)},
            'decoderImageSha256':sha(n.image),'originalBlocks':list(n.blocks.values()),'cases':cases,
            'calls':n.cpp_concat_calls,'scope':{'platformAbiOnly':True,'gameCallbacksReplaced':False,'mainViewerExpanded':False}}
    output=fixture.cache/'research/libcpp-concat-native.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'allBytesAndSretPointersVerified':True}))


if __name__=='__main__':main()

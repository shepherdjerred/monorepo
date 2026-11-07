"""Observe owned printf-width ABI inputs, truncation and register overflow."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from legacy_effect_native import NativeLegacyEffectInputs
from libc_width_format_native import LibcWidthFormatting
from vfx_object_native import NativeVfxObjects
from vfx_spawn_native import sha


class NativeFormatInputs(LibcWidthFormatting,NativeLegacyEffectInputs):pass


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    args=p.parse_args();fixture=NativeAIUnitFixture(args.cache,args.client,NativeFormatInputs);n=fixture.native
    imports=[at for at,name in n.source.imports.items() if name=='_vsnprintf']
    if len(imports)!=1:raise ValueError('Exact vsnprintf import is required')
    cases=[]
    for format_,values,expected,capacity,gp in [
        (b'Skin%03u*',[10],b'Skin010*',32,0),
        (b'%012u',[0xffffffff],b'004294967295',32,48),
        (b'%+06d',[-42],b'-00042',32,0),
        (b'%-8s:%03u',[b'name',9],b'name    :009',32,40),
        (b'%% %03u',[7],b'% 007',4,0),
        (b'%03u',[12],b'012',0,0)]:
        saved=n.allocate(48);overflow=n.allocate(max(8,len(values)*8));va=n.allocate(24);g=gp;o=overflow
        for value in values:
            if isinstance(value,bytes):value=n.allocate_text(value.decode())
            if g<48:at=saved+g;g+=8
            else:at=o;o+=8
            n.put(at,'Q',value&0xffffffffffffffff)
        n.put(va,'IIQQ',gp,48,overflow,saved)
        destination=n.allocate(max(1,capacity),0xa5) if capacity else 0
        n.call(imports[0],{r.UC_X86_REG_RDI:destination,r.UC_X86_REG_RSI:capacity,
                          r.UC_X86_REG_RDX:n.allocate_text(format_.decode()),r.UC_X86_REG_RCX:va})
        stored=expected[:max(0,capacity-1)]+b'\0' if capacity else b''
        actual=bytes(n.u.mem_read(destination,len(stored))) if stored else b''
        if (actual!=stored or n.u.reg_read(r.UC_X86_REG_RAX)!=len(expected) or
                n.u32(va)!=g or n.q(va+8)!=o or n.q(va+16)!=saved):
            raise ValueError('Width-format bytes/return/va_list consumption differ')
        cases.append({'formatHex':format_.hex(),'capacity':capacity,'gpOffset':gp,'outputHex':actual.hex(),
                      'wouldHaveWritten':len(expected),'bytesAndVaListVerified':True})
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(NativeVfxObjects)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report={'schema':1,'kind':'sysv-libc-width-format-controls','build':n.profile['clientVersion'],
            'inputs':fixture.inputs,'sources':{file.name:sha(file.read_bytes()) for file in sorted(paths)},
            'decoderImageSha256':sha(n.image),'cases':cases,'calls':n.character_format_calls,
            'scope':{'platformAbiOnly':True,'gameCallbacksReplaced':False,'mainViewerExpanded':False}}
    output=fixture.cache/'research/libc-width-format-native.json';output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'allBytesReturnsAndVaListsVerified':True}))


if __name__=='__main__':main()

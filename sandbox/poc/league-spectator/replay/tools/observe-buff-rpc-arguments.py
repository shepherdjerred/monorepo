"""Original BuffManager RPC declaration and recorded argument-prefix controls.

Each callback stops before its first semantic callee. No callback registration,
live world lookup, buff membership or provider value is fabricated here.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
import animation_provider_native as providers
from vfx_spawn_native import sha

# Opcode, original callback LEA, registration call, callback, first call/jump.
DECLARATIONS = [
    (1195,0x83f901,0x83f955,0x8405a0,0x84075c,0x8432b0),
    (327,0x83f9ed,0x83fa49,0x840770,0x840aa0,0x843eb0),
    (1160,0x83fae7,0x83fb43,0x840ab0,0x841368,0x842670),
    (206,0x83fbe1,0x83fc3d,0x841380,0x8416b2,0x8439a0),
    (1067,0x83fcdb,0x83fd37,0x8416c0,0x841798,0x844350),
    (1115,0x83fdb5,0x83fe11,0x8417a0,0x841847,0x82dbd0),
    (19,0x83fe8f,0x83feeb,0x841900,0x841921,0x831df0),
    (718,0x83ff69,0x83ffc5,0x8419a0,0x8419c2,0x845a30),
    (35,0x840043,0x84009f,0x841a00,0x841a11,0x846d80),
    (692,0x84011d,0x840179,0x841a90,0x841b1b,0x83c800),
    (258,0x8401f7,0x840257,0x841b90,0x841b94,0x846d80),
]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','snapshot_bindings','capture','output']:
        parser.add_argument(name,type=Path)
    args=parser.parse_args()
    root=Path(__file__).resolve().parent
    paths={Path(__file__)}
    for value in vars(providers).values():
        if inspect.isfunction(value) or inspect.isclass(value):
            file=Path(inspect.getfile(value)).resolve()
            if file.parent==root: paths.add(file)
    paths.update(Path(inspect.getfile(klass)) for klass in providers.NativeAnimationProvider.__mro__ if klass is not object)
    sources={str(file.resolve()):sha(file.read_bytes()) for file in paths}
    capture_bytes,bindings_bytes=args.capture.read_bytes(),args.snapshot_bindings.read_bytes()
    capture=json.loads(capture_bytes)
    fixture=providers.create_animation_provider_fixture(args.cache,args.client,json.loads(bindings_bytes))
    n=fixture.native
    unit=providers.construct_animation_hero(fixture)
    manager=unit+0x25b8
    if n.q(manager)-n.base != 0x235a270:
        raise ValueError('Original concrete hero buff-manager ABI differs')
    if (capture['kind']!='original-packet-window-capture' or capture['build']!='16.21.829.8620' or
            capture['protocol']!='20e09df23c66b85e' or capture['decoderImageSha256']!=sha(n.image) or
            set(capture['opcodes'])!={row[0] for row in DECLARATIONS} or not 0<len(capture['records'])<=10000):
        raise ValueError('Exact bounded original buff RPC capture required')
    for file,expected in capture['inputs'].items():
        if sha(Path(file).read_bytes())!=expected: raise ValueError('Original RPC capture input changed: '+file)
    declarations=[]
    for opcode,lea,register,start,end,target in DECLARATIONS:
        if (n.image[lea:lea+3]!=bytes.fromhex('488d0d') or lea+7+struct.unpack_from('<i',n.image,lea+3)[0]!=start or
                n.image[register-8]!=0xba or struct.unpack_from('<I',n.image,register-7)[0]!=opcode or
                n.image[register]!=0xe8 or register+5+struct.unpack_from('<i',n.image,register+1)[0]!=0x6b7310 or
                n.image[end] not in [0xe8,0xe9] or end+5+struct.unpack_from('<i',n.image,end+1)[0]!=target):
            raise ValueError('Original buff RPC declaration/semantic boundary differs: '+str(opcode))
        declarations.append({'opcode':opcode,'callbackRva':start,'prefixStopRva':end,'semanticTargetRva':target,
                             'registrationCallRva':register,'callbackDeclarationRva':lea})
    lookup={row['opcode']:row for row in declarations}
    records,counts,boundary,active=[],{},None,None
    try:
        for item in capture['records']:
            active={key:item[key] for key in ['opcode','time','param','transportSequence']}
            definition=lookup[item['opcode']]
            heap,obj=bytes.fromhex(item['heapHex']),bytes.fromhex(item['objectHex'])
            if (len(obj)<16 or len(heap)>0x10000 or not heap.startswith(obj) or
                    struct.unpack_from('<II',obj,8)!=(item['opcode'],item['param'])):
                raise ValueError('Original buff RPC object/arena identity differs')
            n.u.mem_write(0x10200000,heap)
            reached=[False]
            def stop(engine,address,size,user):
                reached[0]=True
                engine.emu_stop()
            hook=n.u.hook_add(unicorn.UC_HOOK_CODE,stop,
                              begin=n.base+definition['prefixStopRva'],end=n.base+definition['prefixStopRva'])
            try:
                n.call(definition['callbackRva'],{r.UC_X86_REG_RDI:manager,r.UC_X86_REG_RSI:0x10200000},definition['prefixStopRva'])
            finally:
                n.u.hook_del(hook)
            if n.u.reg_read(r.UC_X86_REG_RIP)!=n.base+definition['prefixStopRva']:
                raise ValueError('Original callback did not reach its semantic boundary')
            registers={name:n.u.reg_read(reg) for name,reg in [('rdi',r.UC_X86_REG_RDI),('rsi',r.UC_X86_REG_RSI),
                       ('rdx',r.UC_X86_REG_RDX),('rcx',r.UC_X86_REG_RCX),('r8',r.UC_X86_REG_R8),('r9',r.UC_X86_REG_R9)]}
            row=active|{key:item[key] for key in ['stream','chunkId','blockOffset']}|{
                'semanticTargetRva':definition['semanticTargetRva'],'registerArguments':registers,
                'xmmArgumentBits':[n.u.reg_read(reg)&0xffffffff for reg in [r.UC_X86_REG_XMM0,r.UC_X86_REG_XMM1]]}
            if item['opcode']==1160:
                at=registers['rsi']
                if not 0x10000000<=at<=0x10010008-40:
                    raise ValueError('Original buff descriptor escaped its scratch stack')
                row['originalBuffDescriptorHex']=bytes(n.u.mem_read(at,40)).hex()
            records.append(row)
            counts[item['opcode']]=counts.get(item['opcode'],0)+1
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),'active':active,
                  'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    for file,expected in {**sources,**fixture.inputs,**capture['inputs']}.items():
        if sha(Path(file).read_bytes())!=expected: raise ValueError('RPC argument source changed during controls: '+file)
    if args.capture.read_bytes()!=capture_bytes or args.snapshot_bindings.read_bytes()!=bindings_bytes:
        raise ValueError('RPC argument input changed during controls')
    output={'schema':1,'kind':'original-buff-rpc-argument-prefix-controls','build':capture['build'],'protocol':capture['protocol'],
            'decoderImageSha256':sha(n.image),'captureSha256':sha(capture_bytes),'replaySha256':capture['replaySha256'],
            'snapshotBindingsSha256':sha(bindings_bytes),'inputs':fixture.inputs,'sources':sources,
            'declarations':declarations,'records':records,'counts':counts,'boundary':boundary,
            'originalBlocks':list(n.blocks.values()),
            'scope':{'originalConcreteHeroConstructorExecuted':True,'originalCallbackArgumentPrefixesExecuted':boundary is None,
                     'callbackRegistrationExecuted':False,'originalSemanticCallsExecuted':False,
                     'recordedEntityRoutingEstablished':False,'buffMembershipEstablished':False,
                     'liveHomeguardHasBuffProvidersEstablished':False,'nativeGraphStateAdmitted':False}}
    args.output.write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'records':len(records),'counts':counts,'boundary':boundary}))
    if boundary: raise SystemExit(1)


if __name__=='__main__': main()

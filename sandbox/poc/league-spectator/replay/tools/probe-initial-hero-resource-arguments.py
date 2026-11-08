"""Original1049 character/skin arguments before the expensive Hero factory.

Runs the actual arithmetic/move fragment on every initial decoded packet.
Other factory inputs are explicit controls. Original downstream callsites and
the concrete Hero virtual slot are checked statically, not called or patched.
No full handler, asset acquisition, resource stack or world acceptance is claimed.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import sys
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args=p.parse_args()
    cache=args.cache.resolve()
    inputs={}

    def raw(path):
        path=Path(path).resolve()
        data=path.read_bytes()
        digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Input changed: '+str(path))
        inputs[str(path)]=digest
        return data

    paths={Path(__file__).resolve(),args.client.resolve(),
           cache/'public/decoder-16.21-macos/profile.json',
           cache/'public/decoder-16.21-macos/image.bin'}
    paths.update(Path(inspect.getfile(c)).resolve() for c in NativeSpawn.__mro__ if c is not object)
    tools=Path(__file__).resolve().parent
    paths.update(Path(m.__file__).resolve() for m in tuple(sys.modules.values())
                 if getattr(m,'__file__',None) and Path(m.__file__).suffix=='.py'
                 and Path(m.__file__).resolve().is_relative_to(tools))
    for path in paths:raw(path)
    n=NativeSpawn(cache/'public/decoder-16.21-macos',args.client)
    samples=json.loads(raw(cache/'research/initial-heroes-input.json'))
    native=json.loads(raw(cache/'research/initial-heroes-native.json'))
    codecs=json.loads(raw(cache/'public/decoder-16.21-macos/field-codecs.json'))
    if (samples['build']!=n.profile['clientVersion'] or
            native['decoderImageSha256']!=sha(n.image) or
            native['constructorImageSha256']!=n.profile['constructorImageSha256'] or
            sha((cache/'public/decoder-16.21-macos/field-codecs.json').read_bytes())!=n.profile['fieldCodecsSha256'] or
            len(samples['packets'])!=10 or set(samples['packets'])!=set(native['observations'])):
        raise ValueError('Exact ten initial decoded Hero packet controls required')
    codec=codecs['codecs']['heroScalar104']
    if codec['bytes']!=4 or any(len(c)!=256 or set(c)!=set(range(256)) for c in codec['decode']):
        raise ValueError('Pinned initial skin byte permutations required')
    frame,packet=0x100f5000,0x10200000
    cases=[]
    for key,sample in samples['packets'].items():
        observed=native['observations'][key]
        obj,heap=bytes.fromhex(observed['object']),bytes.fromhex(observed['heap'])
        if (sample['opcode']!=1049 or sample['stream']!=2 or sample['time']!=0 or sample['param']!=0 or
                observed['status']!='complete' or len(obj)!=120 or heap[:120]!=obj or
                observed['payloadSha256']!=sha(bytes.fromhex(sample['payloadHex'])) or
                not 120<=len(heap)<=0x100000):
            raise ValueError('Exact original initial packet object/arena required')
        n.u.mem_write(packet,heap)
        n.u.mem_write(frame-0x300,bytes(0x300))
        # These unrelated factory outputs are supplied values; neither affects
        # the final RSI character or EDX skin overwritten inside this fragment.
        n.call(0x6e96d6,{r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RBX:packet,
                         r.UC_X86_REG_R13:obj[0x3c],r.UC_X86_REG_RAX:0},0x6e987e)
        pointer=n.u.reg_read(r.UC_X86_REG_RSI)
        expected_pointer,length=struct.unpack_from('<QI',obj,0x50)
        if pointer!=expected_pointer or not 0<=pointer-packet<=len(heap)-length or not 1<=length<=128:
            raise ValueError('Original resource character escaped decoded source bytes')
        character=bytes(n.u.mem_read(pointer,length)).decode('ascii')
        skin=n.u.reg_read(r.UC_X86_REG_RDX)&0xffffffff
        expected_skin=int.from_bytes(bytes(codec['decode'][i][obj[0x68+i]] for i in range(4)),'little')
        if skin!=expected_skin or not character or any(not(c.isalnum() or c=='_') for c in character):
            raise ValueError('Original resource character/skin differs from decoded packet')
        cases.append({'key':key,'payloadSha256':observed['payloadSha256'],
                      'character':character,'skinId':skin,
                      'nativeCharacterArgumentRegister':'RSI','nativeSkinArgumentRegister':'EDX'})
    calls=[(0x6e987e,0x169900),(0x169960,0xc0e80),(0x169a26,0x13d250),
           (0x13d31a,0xbfc30)]
    for caller,target in calls:
        if n.image[caller]!=0xe8 or caller+5+struct.unpack_from('<i',n.image,caller+1)[0]!=target:
            raise ValueError('Original resource factory callsite differs')
    vtable,slot=0x22f9ac8,0xfd8
    if struct.unpack_from('<Q',n.image,vtable+slot)[0]!=n.base+0x169a00:
        raise ValueError('Original Hero resource initialization virtual route differs')
    # lea r8,[rip+20d7802] and xor ecx,ecx are the original bfc30 inputs.
    empty_rva=0x13d307+7+0x20d7802
    if (n.image[empty_rva]!=0 or n.image[0x13d318:0x13d31a]!=b'\x31\xc9' or
            n.image[0x13d307:0x13d30a]!=b'\x4c\x8d\x05'):
        raise ValueError('Original default resource empty-string/zero inputs differ')
    ranges=[(0x6e96d6,0x6e9883),(0x169911,0x169965),(0x16997d,0x1699ce),
            (0x169a00,0x169a2b),(0x13d250,0x13d31f)]
    for a,b in ranges:
        if n.image[a:b]!=n.source.image[a:b]:raise ValueError('Original source path instructions differ')
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Producer input changed: '+path)
    result={'schema':1,'kind':'original-initial-hero-resource-arguments',
            'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
            'decoderImageSha256':sha(n.image),'inputs':inputs,'cases':cases,
            'originalBlocks':list(n.blocks.values()),
            'staticCallsites':[{'callerRva':a,'calleeRva':b} for a,b in calls],
            'staticBlocks':[{'rva':a,'size':b-a,'sha256':sha(n.image[a:b])} for a,b in ranges],
            'heroVirtualRoute':{'vtableRva':vtable,'slot':slot,'targetRva':0x169a00},
            'defaultSetterArguments':{'zeroECX':True,'emptyR8StringRva':empty_rva},
            'scope':{'actualTenInitialPacketArgumentFragments':True,
                     'downstreamResourceSetterDataflowStaticOnly':True,
                     'unrelatedFactoryArgumentsSupplied':True,'fullHeroFactoryExecuted':False,
                     'actualInitialResourceStackRecovered':False,
                     'originalAssetReadinessEstablished':False,'nativeWorldAcceptance':None,
                     'actualEffectsActivated':False}}
    output=cache/'research/initial-hero-resource-arguments-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'initialPackets':len(cases),'staticCallsites':len(calls)}))


if __name__=='__main__':main()

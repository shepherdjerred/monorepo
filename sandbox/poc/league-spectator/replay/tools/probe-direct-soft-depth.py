"""Observe original camera depth-conversion arithmetic on explicit owned pairs.

This executes an original contiguous producer fragment, not a replacement GPU
upload callback. Actual camera provenance and the scene-depth producer stay open.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import ADDRESSES as A,sha


def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();decoder=cache/'public/decoder-16.21-macos'
    n=NativeVfxRetirement(decoder,args.client);owner=n.allocate(0x300,0xa5);frame=A['stack']-0x100
    epsilon=f32(1e-6)
    if bytes(n.u.mem_read(n.base+0x20eb060,16)).hex()!='bd378635bd3786350000000000000000':raise ValueError('Original depth pair clamp differs')
    cases=[]
    for pair in [[1,10000],[.1,1000],[100,100000],[.001,10],[1e-8,1e-4],[0,0],[-1,100],[100,100],[1000,.1],[10000,1]]:
        pair=list(map(f32,pair));n.put(owner+0xc,'ff',*pair)
        n.u.mem_write(frame-0x30,bytes([0xa5])*0x30)
        n.fragment(0x180fffb,0x181003a,{r.UC_X86_REG_R14:owner,r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x40})
        actual=bytes(n.u.mem_read(frame-0x20,16));near,far=[max(x,epsilon) for x in pair]
        expected=struct.pack('<4f',f32(1/near),f32(-f32(far-near)/f32(near*far)),0,0)
        if actual!=expected:raise ValueError('Original depth conversion differs from explicit float32 expression')
        if bytes(n.u.mem_read(frame-0x30,16))!=bytes([0xa5])*16:raise ValueError('Original depth output exceeded owned fragment frame')
        cases.append({'inputPair':pair,'outputHex':actual.hex(),'output':list(struct.unpack('<4f',actual)),
                      'suppliedPositiveIncreasingPair':0<pair[0]<pair[1],
                      'suppliedPositiveDecreasingPair':0<pair[1]<pair[0]})
    sources={Path(__file__)};sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
    paths={args.client,decoder/'profile.json',decoder/'image.bin',*sources}
    inputs={str(p.resolve()):sha(p.read_bytes()) for p in paths}
    blocks=[]
    for start,end in [(0x180fffb,0x181003a),(0x181003a,0x1810059),(0x16e2f80,0x16e2ffc)]:
        if n.image[start:end]!=n.source.image[start:end]:raise ValueError('Depth original producer bytes differ')
        blocks.append({'rva':start,'size':end-start,'sha256':sha(n.image[start:end])})
    result={'schema':1,'kind':'native-soft-depth-conversion-producer-controls','build':n.profile['clientVersion'],
        'protocol':n.profile['protocolDigest'],'cases':cases,'originalBlocks':blocks,'inputs':inputs,
        'producer':{'arithmeticFragment':[0x180fffb,0x181003a],'sourceFloatPairOffsets':[0xc,0x10],'positiveClampFloat32':epsilon,
                    'parameter':'cDepthConversionParams','shaderBlock':'PerFramePixelCB_ps','shaderOffset':80,'shaderBytes':16,
                    'arithmetic':'[f32(1/a), f32(-f32(b-a)/f32(a*b)), +0, +0], with a/b=max(float32(input),epsilon)',
                    'subsequentOriginalUploadRva':0x1916e10},
        'scope':{'originalArithmeticExecuted':True,'suppliedOwnedCameraPair':True,'fullCameraConstructorExecuted':False,
                 'actualViewerCameraPairRecovered':False,'originalNearFarSemanticMappingRecovered':False,'originalUploadExecuted':False,'sceneDepthProducerRecovered':False,
                 'sceneDepthTextureSubstituted':False,'runtimeAdmissionChanged':False}}
    output=cache/'research/direct-soft-depth-native.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'exactFloat32':True}))


if __name__=='__main__':main()

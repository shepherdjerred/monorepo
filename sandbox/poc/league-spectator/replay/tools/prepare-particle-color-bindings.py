"""Prepare authored color-texture bindings using the original slot-1 sampler code.

Complete post-loaded graphs are unchanged. This observes the sampler prefix and
the material's texture-name table; texture acquisition and GPU submission remain
separate. No game callback is replaced with a successful resource result.
"""
import argparse
import inspect
import json
from pathlib import Path

from unicorn import x86_const as r
from trail_material_native import NativeTrailMaterial
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:parser.add_argument(name,type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public'
    inputs={}
    def raw(path):
        data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    def read(path):return json.loads(raw(path))
    decoder=assets/'decoder-16.21-macos';profile=read(decoder/'profile.json')
    image=raw(decoder/'image.bin');effects=read(assets/'latest-effects/manifest.json')
    quads=read(decoder/'vfx-bound-quads.json');trails=read(assets/'latest-trail-particles/package.json')
    if (sha(image)!=profile['decoderImageSha256'] or
            inputs[str((decoder/'vfx-bound-quads.json').resolve())]!=profile['vfxBoundQuadsSha256'] or
            any(p['build']!=profile['clientVersion'] or p['protocol']!=profile['protocolDigest']
                for p in [effects,quads,trails])):
        raise ValueError('Particle color build/package identity differs')
    entries=[];blocks={};records={};observed=0;native=None
    for directory,meta in [(decoder,quads),(assets/'latest-trail-particles',trails)]:
        for ref in meta['templates']:
            if ref['effectId'] not in records:
                definition=effects['definitions'][ref['effectId']]
                data=raw(assets/'latest-effects'/definition['file'])
                if sha(data)!=definition['sha256']:raise ValueError('Color source definition changed')
                records[ref['effectId']]=json.loads(data)
            record=records[ref['effectId']]
            emitter=record['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
            path=emitter.get('particleColorTexture')
            if not path:continue
            if not isinstance(path,str):raise ValueError('Non-string authored color texture')
            if ref['sourceDefinitionSha256']!=effects['definitions'][ref['effectId']]['sha256']:
                raise ValueError('Color graph/definition identity differs')
            graph_raw=raw(directory/ref['file'])
            if sha(graph_raw)!=ref['sha256']:raise ValueError('Particle color graph changed')
            graph=json.loads(graph_raw)
            if observed%40==0:native=NativeTrailMaterial(decoder,args.client)
            if ref['primitiveKind']=='camera-trail':native.prepare_trail_material(graph)
            else:native.prepare_material(graph)
            # The native material binds the string at emitter+0xa8 to slot 1
            # (0x16dec64..0x16dec8d). Check the entire supplied string.
            pointer=native.q(A['definition']+0xa8);length=native.u32(A['definition']+0xb0)
            if length!=len(path.encode()) or bytes(native.u.mem_read(pointer,length))!=path.encode():
                raise ValueError('Original color texture string differs from authored definition')
            native.call(0x16e3910,{r.UC_X86_REG_RDI:A['link'],r.UC_X86_REG_RCX:1},0x16e3a53)
            frame=native.u.reg_read(r.UC_X86_REG_RBP)
            sampler=bytes(native.u.mem_read(frame-0x40,5))
            if sampler[:3]!=b'\x01\x01\x01' or sampler[3]!=sampler[4] or sampler[3] not in [0,1]:
                raise ValueError('Unadmitted original color sampler descriptor')
            table=0x23ef550
            if native.cstring(native.q(native.base+table+8))!=b'PARTICLE_COLOR_TEXTURE':
                raise ValueError('Original slot-1 shader name differs')
            asset=effects['assets'].get(path.lower())
            if not asset or asset['kind']!='texture' or asset['status']!='prepared':
                raise ValueError('Authored color texture was not prepared')
            if sha(raw(assets/'latest-effects'/asset['file']))!=asset['sha256']:
                raise ValueError('Prepared color texture changed')
            native.finish();blocks.update(native.material_blocks)
            entries.append({'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],
                'graphSha256':ref['sha256'],'sourceDefinitionSha256':ref['sourceDefinitionSha256'],
                'primitiveKind':ref['primitiveKind'],'authoredPath':path,'nativeSlot':1,
                'nativeName':'PARTICLE_COLOR_TEXTURE','descriptorHex':sampler.hex(),
                'asset':{k:asset[k] for k in ['file','sha256','sourceSha256','width','height']}})
            observed+=1
            if observed%100==0:print(json.dumps({'colorBindings':observed}),flush=True)
    if not entries:raise ValueError('No authored particle color bindings observed')
    # Keep call-site and name-table identity even though resource acquisition
    # after the observed sampler prefix is intentionally not executed.
    source_blocks=[{'startRva':a,'endRva':b,'sha256':sha(image[a:b])} for a,b in
        [(0x16dec64,0x16dec92),(0x16e3910,0x16e3a53),(0x23ef550,0x23ef550+11*8)]]
    paths={Path(inspect.getfile(c)) for c in NativeTrailMaterial.__mro__ if c is not object}
    paths.update([Path(__file__),Path(__file__).with_name('macho.py')])
    result={'schema':1,'kind':'native-authored-particle-color-bindings',
        'build':effects['build'],'protocol':effects['protocol'],'inputs':inputs,
        'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
        'decoderImageSha256':sha(image),'sourceBlocks':source_blocks,
        'originalBlocks':list(blocks.values()),'entries':entries,
        'counts':{'emitters':len(entries),'uniqueTextures':len({e['asset']['sha256'] for e in entries}),
            'quadEmitters':sum(e['primitiveKind']!='camera-trail' for e in entries),
            'trailEmitters':sum(e['primitiveKind']=='camera-trail' for e in entries)},
        'scope':{'completeAssetBytesUnchanged':True,'originalSamplerPrefixExecuted':True,
            'textureAcquisitionExecuted':False,'nativeFactoryExecuted':False,
            'gpuSubmitted':False,'browserRun':False,'referenceCompared':False}}
    directory=assets/'latest-particle-color';directory.mkdir(exist_ok=True)
    encoded=json.dumps(result,indent=2).encode();(directory/'package.json').write_bytes(encoded)
    print(json.dumps({'sha256':sha(encoded),**result['counts']}))


if __name__=='__main__':main()

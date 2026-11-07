"""Bounded original random sprite-frame controls on complete authored quads.

No runtime/compiler or live material package is changed. The field reader alone
varies the random-start boolean; all other authored fields retain their order.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import ADDRESSES as A,name_hash,sha


class SpriteQuad(NativeLoadedQuad):
    def __init__(self,*args):
        super().__init__(*args);self.random_trace=[];self.trace_active=False
        for at in [0x175a860,0x175a865]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.capture_random,begin=self.base+at,end=self.base+at)
    def capture_random(self,uc,address,size,user):
        if self.trace_active:self.random_trace.append({'rva':address-self.base,'rngHex':bytes(uc.mem_read(A['stream']+8,12)).hex(),
            'xmm0LowBits':uc.reg_read(r.UC_X86_REG_XMM0)&0xffffffff})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';decoder=assets/'decoder-16.21-macos';inputs={}
    def raw(path):
        data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    def read(path):return json.loads(raw(path))
    manifest=read(assets/'latest-effects/manifest.json');profile=read(decoder/'profile.json');inventory=read(decoder/'vfx-assets.json')
    if inputs[str((decoder/'vfx-assets.json').resolve())]!=profile['vfxAssetsSha256'] or inventory['effectsManifestSha256']!=inputs[str((assets/'latest-effects/manifest.json').resolve())]:
        raise ValueError('Exact profile-pinned authored field inventory required')
    loader=NativeVfxPostload(decoder,args.client);n=SpriteQuad(decoder,args.client)
    flag_hash=name_hash('isRandomStartFrame');properties=loader.type_catalog['09cde442']['properties']
    field=next(p for p in properties if p['hash']==flag_hash)
    if (field['offset'],field['type'],field['mask'])!=(0x2d0,0x87,0x20):raise ValueError('Original random-start registration differs')
    selected=[];cases=[];scalar_cases=[]
    for effect_id,index in [('champions/hecarim/0/5cd20cfc',4),('champions/hecarim/0/5bfcb9d4',1)]:
        ref=manifest['definitions'][effect_id];definition=read(assets/'latest-effects'/ref['file'])
        if inputs[str((assets/'latest-effects'/ref['file']).resolve())]!=ref['sha256']:raise ValueError('Prepared authored definition differs')
        source=definition['definition']['complexEmitterDefinitionData'][index]
        if source['isRandomStartFrame']!=1 or source['numFrames']!=4 or any(k in source for k in ['startFrame','frameRate','birthFrameRate','texDiv']):
            raise ValueError('Bounded four-frame/default-clock authored shape differs')
        meta=inventory['emitters'][f'{effect_id}:{index}']
        if meta['definitionSha256']!=ref['sha256']:raise ValueError('Authored field inventory identity differs')
        blob=raw(cache/'research/latest-effects/bins'/f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob)!=meta['rawSourceSha256']:raise ValueError('Original BIN source differs')
        fields=[]
        for f in meta['fields']:
            data=blob[f['offset']:f['offset']+f['bytes']]
            if sha(data)!=f['sha256']:raise ValueError('Original serialized field differs')
            fields.append((f['hash'],data))
        if sum(h==flag_hash for h,_ in fields)!=1:raise ValueError('One authored random-start field required')
        graphs={};defaults=[]
        for variant in ['authored','false']:
            before=loader.load([struct.pack('<IBB',h,0x87,0) if h==flag_hash and variant=='false' else data for h,data in fields]);after=loader.postload()
            if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:raise ValueError('Original typed load/postload unresolved')
            obj=bytes.fromhex(after['objectHex']);flag=bool(obj[0x2d0]&0x20)
            if flag!=(variant=='authored'):raise ValueError('Original typed flag load differs')
            native_defaults={'startFrame':struct.unpack_from('<H',obj,0x260)[0],'numFrames':struct.unpack_from('<H',obj,0x262)[0],
                             'frameRate':struct.unpack_from('<f',obj,0x264)[0],'texDiv':list(struct.unpack_from('<2f',obj,0x8c))}
            if native_defaults!={'startFrame':0,'numFrames':4,'frameRate':0.,'texDiv':[1.,1.]}:raise ValueError('Original sprite constructor/default clock differs')
            defaults.append({'variant':variant,**native_defaults});graphs[variant]=n.prepare_loaded({'phase':'native-postload-callbacks-executed',**after});loader.restore_preload_arena()
        common_heap=(max(g['nextHeap'] for g in graphs.values())+0x1000+15)&~15
        for g in graphs.values():g['nextHeap']=common_heap
        selected.append({'effectId':effect_id,'emitterIndex':index,'source':source,'nativeDefaults':defaults,'commonRuntimeHeap':common_heap})
        for seed in [1,0x12345]:
            for pose in ['identity','changing']:
                for variant,graph in graphs.items():
                    n.reset_quad(graph,seed,0);n.random_trace=[];n.trace_active=True;frames=[];previous=[0,0,0]
                    for tick in range(31):
                        time=tick/60;current=[130*time,3*time,70*time]
                        basis=([0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1] if pose=='changing' and 4<=tick<10 else
                               [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])
                        value={'time':time,'previous':previous,'current':current,'basis':basis,'viewPosition':[0,0,1000],
                               'cameraRight':[1,0,0],'cameraUp':[0,1,0],'viewAxis':[0,0,1]}
                        frames.append({'input':value,'output':n.frame_quad(value)});previous=current
                    n.trace_active=False
                    if not any(f['output']['state']['births'] for f in frames):raise ValueError('Sprite control requires actual birth')
                    if frames[-1]['output']['state']['vectors']['life']['count']:raise ValueError('Sprite control must cover final retirement')
                    cases.append({'effectId':effect_id,'emitterIndex':index,'primitiveKind':'loaded','seedHex':f'{seed:016x}','pose':pose,
                                  'variant':variant,'randomTrace':n.random_trace,'frames':frames})
    # Exact controller+shared native half conversion around wrap/rounding edges.
    for variant,graph in graphs.items():
        n.reset_quad(graph,1,0)
        motion=n.allocate(0x24,0);attributes=n.allocate(0x2c,0xa5);packed=n.allocate(0x10,0xa5);frame=A['stack']-0x200
        for chance in [0.,-0.,.1,.25,.3,.5,.75,1-2**-24,1.]:
            chance=struct.unpack('<f',struct.pack('<f',chance))[0]
            n.put(motion+0x1c,'ff',0,chance);n.put(frame-0x58,'Q',0)
            n.call(0x175f697,{r.UC_X86_REG_RBP:frame,r.UC_X86_REG_R12:A['definition'],r.UC_X86_REG_R14:motion,
                             r.UC_X86_REG_R15:0,r.UC_X86_REG_R13:attributes,r.UC_X86_REG_RBX:0,r.UC_X86_REG_XMM2:0},0x175f6ec)
            frame_bits=struct.unpack('<I',bytes(n.u.mem_read(attributes,4)))[0]
            n.call(0x1731fb0,{r.UC_X86_REG_RDI:packed,r.UC_X86_REG_XMM0:frame_bits,r.UC_X86_REG_XMM1:0,
                             r.UC_X86_REG_XMM2:0,r.UC_X86_REG_XMM3:0})
            if bytes(n.u.mem_read(packed+8,8))!=bytes([0xa5])*8:raise ValueError('Original half writer exceeded owned output')
            scalar_cases.append({'variant':variant,'chanceBits':struct.unpack('<I',struct.pack('<f',chance))[0],
                                 'frameBits':frame_bits,'packedHalfHex':bytes(n.u.mem_read(packed,8)).hex(),
                                 'rngHex':bytes(n.u.mem_read(A['stream']+8,12)).hex()})
    paths={Path(__file__)}
    for obj in [loader,n]:paths.update(Path(inspect.getfile(c)) for c in type(obj).__mro__ if c is not object)
    blocks={**loader.blocks,**n.blocks}
    output={'schema':1,'kind':'native-four-frame-random-start-quad-controls','build':profile['clientVersion'],'protocol':profile['protocolDigest'],
            'selected':selected,'cases':cases,'scalarCases':scalar_cases,'registration':field,'inputs':inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
            'originalBlocks':list(blocks.values()),'scope':{'completeAuthoredEmitterPreserved':True,'onlyOriginalTypedRandomStartBooleanVaried':True,
            'authoredFieldOrderPreserved':True,'suppliedClockSeedPoseAndMotion':True,'nativeMatchRandomOrderRecovered':False,
            'groundMaterialPrepared':False,'gpuSubmitted':False,'runtimeAdmissionChanged':False}}
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Sprite input drift')
    path=cache/'research/direct-quad-sprite-native.json';path.write_text(json.dumps(output,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(path),'components':len(selected),'cases':len(cases),'frames':sum(len(c['frames']) for c in cases)}))


if __name__=='__main__':main()

"""Complete typed Legacy-offset emitters and original offset sampler controls."""
import argparse, importlib.util, inspect, json, math, struct, sys
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha, ADDRESSES as A

helper_path=Path(__file__).with_name('probe-direct-zero-position.py')
spec=importlib.util.spec_from_file_location('legacy_offset_controls',helper_path);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('client',type=Path);a=p.parse_args()
    cache=a.cache.resolve();assets=cache/'public';decoder=assets/'decoder-16.21-macos';tools=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Legacy native input drift')
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    paths={Path(__file__),a.client,helper_path}
    for cls in [NativeVfxPostload,NativeLoadedQuad]:paths.update(Path(inspect.getfile(c)) for c in cls.__mro__ if c is not object)
    paths.update(Path(m.__file__) for m in tuple(sys.modules.values()) if getattr(m,'__file__',None) and Path(m.__file__).suffix=='.py' and Path(m.__file__).resolve().is_relative_to(tools))
    for path in paths:raw(path)
    profile=read(decoder/'profile.json');image=raw(decoder/'image.bin');manifest_bytes=raw(assets/'latest-effects/manifest.json');manifest=json.loads(manifest_bytes)
    inventory_bytes=raw(decoder/'vfx-assets.json');inventory=json.loads(inventory_bytes)
    if sha(image)!=profile['decoderImageSha256'] or sha(inventory_bytes)!=profile['vfxAssetsSha256'] or inventory['effectsManifestSha256']!=sha(manifest_bytes):raise ValueError('Exact static field inventory required')
    loader=NativeVfxPostload(decoder,a.client);n=NativeLoadedQuad(decoder,a.client);cases=[];selected=[];leaves=[];shape_calls=[];typed_controls=[]
    def shape_input(uc,address,size,user):
        at=n.u.reg_read(r.UC_X86_REG_RSI)
        shape_calls.append({'clock':struct.unpack('<f',n.u.mem_read(at+0xc,4))[0],'inputHex':bytes(n.u.mem_read(at,0x20)).hex()})
    n.u.hook_add(unicorn.UC_HOOK_CODE,shape_input,begin=n.base+0x170a850,end=n.base+0x170a850)
    effect_id='champions/vladimir/39/9fbafd14';ref=manifest['definitions'][effect_id];encoded=raw(assets/'latest-effects'/ref['file'])
    if sha(encoded)!=ref['sha256']:raise ValueError('Original definition bytes differ')
    definition=json.loads(encoded)['definition']
    for index in [3,6,10]:
        source=definition['complexEmitterDefinitionData'][index];shape=source.get('SpawnShape',{})
        if shape.get('__type')!='VfxShapeLegacy' or set(shape)!={'__type','emitOffset'}:raise ValueError('Exact Legacy offset-only source required')
        meta=inventory['emitters'][f'{effect_id}:{index}']
        if meta['definitionSha256']!=ref['sha256'] or meta['status']!='loaded-fields':raise ValueError('Typed source span identity differs')
        blob=raw(cache/'research/latest-effects/bins'/f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob)!=meta['rawSourceSha256']:raise ValueError('Source BIN differs')
        fields=[]
        for row in meta['fields']:
            field=blob[row['offset']:row['offset']+row['bytes']]
            if sha(field)!=row['sha256']:raise ValueError('Typed field differs')
            fields.append(field)
        before=loader.load(fields);after=loader.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:raise ValueError('Complete original postload required')
        graph=n.prepare_loaded({'phase':'native-postload-callbacks-executed',**after})
        selected.append({'effectId':effect_id,'emitterIndex':index,'sourceDefinitionSha256':ref['sha256'],'source':source})
        for clock in [-1,0,.01,.125,.34999999,.5,.699999988079071,.7,.8,1,2,100]:
            n.reset_quad(graph,0x12345,0);shape_at=n.q(A['definition']+0x238);vtable=n.q(shape_at)
            if n.q(vtable+0x28)!=n.base+0x170a850:raise ValueError('Original Legacy sampler entry differs')
            at=0x100e8000;n.u.mem_write(at,bytes(0x20));n.put(at+0xc,'f',clock);shape_calls.clear()
            rng_before=bytes(n.u.mem_read(A['stream']+8,12)).hex()
            n.call(0x170a850,{r.UC_X86_REG_RDI:shape_at,r.UC_X86_REG_RSI:at})
            output=bytes(n.u.mem_read(at,0x20));rng_after=bytes(n.u.mem_read(A['stream']+8,12)).hex()
            if rng_before!=rng_after or struct.unpack_from('<I',output,0x18)[0]!=0:raise ValueError('Offset-only sampler must not create angles or consume RNG')
            leaves.append({'effectId':effect_id,'emitterIndex':index,'clock':clock,'outputHex':output.hex(),'offset':list(struct.unpack_from('<3f',output)),
                           'rngBeforeHex':rng_before,'rngAfterHex':rng_after,'calls':list(shape_calls)})
        for seed in [1,0x12345]:
            for pose in ['identity','changing']:
                n.reset_quad(graph,seed,0);frames=[];previous=[0,0,0]
                for tick in range(31):
                    time=tick/60;current=[23+time*130,-11+time*3,81+time*70]
                    basis=([0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1] if pose=='changing' and (tick//8)%2 else [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])
                    value={'time':time,'previous':previous,'current':current,'basis':basis,'viewPosition':[300,900,1200]};shape_calls.clear()
                    output=helper.comparable(n.frame_quad(value));calls=list(shape_calls)
                    if len(calls)!=len(output['state']['births']):raise ValueError('Every original birth must have one shape sampler call')
                    frames.append({'input':value,'output':output,'shapeCalls':calls});previous=current
                births=sum(len(fr['output']['state']['births']) for fr in frames);visible=sum(helper.visible_geometry(fr['output']) for fr in frames)
                if not births or not visible:raise ValueError('Actual visible birth/geometry required')
                cases.append({'effectId':effect_id,'emitterIndex':index,'primitiveKind':'loaded','seedHex':f'{seed:016x}','pose':pose,
                              'frames':frames,'observedBirths':births,'positiveAreaColoredFrames':visible})
        loader.restore_preload_arena()
        if index==3:
            old_constant=struct.pack('<3f',0,-100,-40);old_curve=struct.pack('<6f',0,-100,-0.0,0,-150,-0.0)
            shape_fields=[(i,data) for i,data in enumerate(fields) if struct.unpack_from('<I',data)[0]==0x3bf0b4ed]
            if len(shape_fields)!=1:raise ValueError('Unique original Legacy shape field required')
            shape_i,shape_field=shape_fields[0]
            if shape_field.count(old_constant)!=1 or shape_field.count(old_curve)!=1:raise ValueError('Exact original constant/curve raw spans required')
            controls=[([2,-3,-4],[[5,6,7],[10,12,14]]),([-2,3,4],[[5,6,7],[10,12,14]]),([0,0,0],[[5,6,7],[10,12,14]]),
                      ([2,-3,-4],[[0,0,0],[1,2,3]]),([2,-3,-4],[[-0.0,-0.0,-0.0],[1,2,3]])]
            for control_index,(constant,curve) in enumerate(controls):
                new_shape=shape_field.replace(old_constant,struct.pack('<3f',*constant)).replace(old_curve,struct.pack('<6f',*(curve[0]+curve[1])))
                control_fields=[new_shape if i==shape_i else data for i,data in enumerate(fields)]
                control_before=loader.load(control_fields);control_after=loader.postload()
                if control_before['ignored'] or control_before['mismatched'] or control_after['pendingLinkFixups'] or control_after['mathCalls']:raise ValueError('Typed controlled shape failed')
                control_graph=n.prepare_loaded({'phase':'native-postload-callbacks-executed',**control_after})
                for clock in [-1,0,.25,.699999988079071,1,2]:
                    n.reset_quad(control_graph,0x12345,0);shape_at=n.q(A['definition']+0x238);at=0x100e8000
                    n.u.mem_write(at,bytes(0x20));n.put(at+0xc,'f',clock);shape_calls.clear();rng_before=bytes(n.u.mem_read(A['stream']+8,12)).hex()
                    n.call(0x170a850,{r.UC_X86_REG_RDI:shape_at,r.UC_X86_REG_RSI:at});output=bytes(n.u.mem_read(at,0x20));rng_after=bytes(n.u.mem_read(A['stream']+8,12)).hex()
                    if rng_before!=rng_after:raise ValueError('Typed nonrandom shape consumed RNG')
                    typed_controls.append({'control':control_index,'constant':constant,'curve':curve,'times':[0,.699999988079071],'clock':clock,
                                           'outputHex':output.hex(),'offset':list(struct.unpack_from('<3f',output)),'rngBeforeHex':rng_before,'rngAfterHex':rng_after})
                loader.restore_preload_arena()
            selected[-1]['rawCurveVectorHex']=old_curve.hex()
            selected[-1]['preparedCurveVectorHex']=struct.pack('<6f',*(shape['emitOffset']['dynamics']['values'][0]+shape['emitOffset']['dynamics']['values'][1])).hex()
        print(json.dumps({'effectId':effect_id,'emitterIndex':index,'cases':4,'frames':124}),flush=True)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Original Legacy observation input changed')
    result={'schema':1,'kind':'original-legacy-offset-complete-emitter-controls','build':profile['clientVersion'],'protocol':profile['protocolDigest'],
            'decoderImageSha256':profile['decoderImageSha256'],'inputs':inputs,'selected':selected,'leaves':leaves,'typedControls':typed_controls,'cases':cases,
            'originalBlocks':list({**loader.blocks,**n.blocks}.values()),'scope':{'completeUnchangedTypedSourceAndOrder':True,
             'suppliedClockSeedWorldAndCamera':True,'offsetOnlyLegacyShape':True,'randomShapeProbabilitiesSupported':False,'rotationAnglesSupported':False,
             'nativeWorldAcceptance':None,'gpuSubmitted':False,'runtimeAdmissionChanged':False}}
    out=cache/'research/direct-legacy-offset-native.json';out.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(out),'cases':len(cases),'frames':sum(len(c['frames']) for c in cases),'leaves':len(leaves)}))
if __name__=='__main__':main()

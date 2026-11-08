"""Unchanged typed emitter constructors/postload and actual absent birth defaults."""
import argparse, inspect, json, math, struct, sys
from pathlib import Path
from vfx_postload_native import NativeVfxPostload
from vfx_camera_quad_native import NativeCameraQuad
from vfx_spawn_native import sha, name_hash

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('client',type=Path);a=p.parse_args()
    cache=a.cache.resolve();assets=cache/'public';decoder=assets/'decoder-16.21-macos';inputs={};tools=Path(__file__).resolve().parent
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Default input drift')
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    paths={Path(__file__),a.client}
    for cls in [NativeVfxPostload,NativeCameraQuad]:paths.update(Path(inspect.getfile(c)) for c in cls.__mro__ if c is not object)
    paths.update(Path(m.__file__) for m in tuple(sys.modules.values()) if getattr(m,'__file__',None) and Path(m.__file__).suffix=='.py' and Path(m.__file__).resolve().is_relative_to(tools))
    for path in paths:raw(path)
    profile=read(decoder/'profile.json');image=raw(decoder/'image.bin');manifest_bytes=raw(assets/'latest-effects/manifest.json');manifest=json.loads(manifest_bytes)
    inventory_bytes=raw(decoder/'vfx-assets.json');inventory=json.loads(inventory_bytes)
    if sha(image)!=profile['decoderImageSha256'] or sha(inventory_bytes)!=profile['vfxAssetsSha256'] or inventory['effectsManifestSha256']!=sha(manifest_bytes):raise ValueError('Exact static inputs required')
    loader=NativeVfxPostload(decoder,a.client);n=NativeCameraQuad(decoder,a.client);cases=[]
    registration={key:next(row for row in loader.type_catalog['09cde442']['properties'] if row['hash']==name_hash(key)) for key in ['birthScale0','particleLifetime','bindWeight']}
    constructor_only=loader.load([])
    loader.postload()
    loader.restore_preload_arena()
    explicit_zero=(struct.pack('<IBIIH',name_hash('birthScale0'),131,0x68dc32b6,19,1)+
                   struct.pack('<IBfff',name_hash('constantValue'),12,0,0,0))
    for effect_id in ['champions/gangplank/14/b00ffab6','champions/jinx/2/8a5418b7','champions/vladimir/39/fe3c9b09']:
        index=0;ref=manifest['definitions'][effect_id];encoded=raw(assets/'latest-effects'/ref['file'])
        if sha(encoded)!=ref['sha256']:raise ValueError('Exact definition required')
        source=json.loads(encoded)['definition']['complexEmitterDefinitionData'][index]
        if any(key in source for key in registration):raise ValueError('Actual absent-default fixtures required')
        meta=inventory['emitters'][f'{effect_id}:{index}']
        if meta['definitionSha256']!=ref['sha256'] or meta['status']!='loaded-fields':raise ValueError('Typed span identity differs')
        blob=raw(cache/'research/latest-effects/bins'/f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob)!=meta['rawSourceSha256']:raise ValueError('Original BIN differs')
        fields=[]
        for row in meta['fields']:
            data=blob[row['offset']:row['offset']+row['bytes']]
            if sha(data)!=row['sha256']:raise ValueError('Typed span differs')
            fields.append(data)
        before=loader.load(fields);after=loader.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:raise ValueError('Complete typed postload required')
        graph=n.prepare_camera({'phase':'native-postload-callbacks-executed',**after});n.reset_quad(graph,0x12345,0)
        frames=[];previous=[0,0,0]
        for tick in range(3):
            time=tick/60;current=[time*130,time*3,time*70];value={'time':time,'previous':previous,'current':current,
                'basis':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],'viewPosition':[0,1000,0],
                'cameraRight':[1,0,0],'cameraUp':[0,1,0],'viewAxis':[0,0,1]}
            frames.append({'input':value,'output':n.frame_camera(value)});previous=current
        births=[birth for frame in frames for birth in frame['output']['state']['births']]
        if not births:raise ValueError('Actual native births required')
        cases.append({'effectId':effect_id,'emitterIndex':index,'sourceDefinitionSha256':ref['sha256'],'source':source,
                      'before':before,'after':after,'frames':frames,'firstBirthScale':list(struct.unpack('<55f',bytes.fromhex(births[0]['birthHex']))[26:29])})
        loader.restore_preload_arena()
        zero_before=loader.load([*fields,explicit_zero]);zero_after=loader.postload()
        if zero_before['ignored'] or zero_before['mismatched'] or zero_after['pendingLinkFixups'] or zero_after['mathCalls']:raise ValueError('Complete typed explicit-zero postload required')
        graph=n.prepare_camera({'phase':'native-postload-callbacks-executed',**zero_after});n.reset_quad(graph,0x12345,0)
        zero_frames=[];previous=[0,0,0]
        for tick in range(3):
            time=tick/60;current=[time*130,time*3,time*70];value={'time':time,'previous':previous,'current':current,
                'basis':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],'viewPosition':[0,1000,0],
                'cameraRight':[1,0,0],'cameraUp':[0,1,0],'viewAxis':[0,0,1]}
            zero_frames.append({'input':value,'output':n.frame_camera(value)});previous=current
        zero_births=[birth for frame in zero_frames for birth in frame['output']['state']['births']]
        if not zero_births:raise ValueError('Typed explicit-zero birth required')
        cases[-1]['explicitZero']={'fieldHex':explicit_zero.hex(),'before':zero_before,'after':zero_after,'frames':zero_frames,
            'firstBirthScale':list(struct.unpack('<55f',bytes.fromhex(zero_births[0]['birthHex']))[26:29])}
        loader.restore_preload_arena()
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Input changed during native default probe')
    result={'schema':1,'kind':'original-typed-emitter-absent-default-controls','build':profile['clientVersion'],'protocol':profile['protocolDigest'],
            'decoderImageSha256':profile['decoderImageSha256'],'inputs':inputs,'registration':registration,'constructorOnly':constructor_only,'cases':cases,
            'originalBlocks':list({**loader.blocks,**n.blocks}.values()),'scope':{'unchangedAuthoredFieldsAndSerializedOrder':True,'originalTypedPostloadAndCameraWriter':True,
                'ownedClockSeedAndWorldInputs':True,'gpuSubmitted':False,'nativeWorldAcceptance':None}}
    out=cache/'research/direct-emitter-defaults-native.json';out.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(out),'scales':{c['effectId']:c['firstBirthScale'] for c in cases}}))
if __name__=='__main__':main()

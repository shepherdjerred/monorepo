"""Original authored soft-particle material gates and geometry controls.

Depth intersection is deliberately not implemented by this control. The exact
existing prepared graphics environment selects a depth-independent permutation.
"""
import argparse
import inspect
import json
from pathlib import Path

from vfx_postload_native import NativeVfxPostload
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import sha,name_hash


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';decoder=assets/'decoder-16.21-macos';inputs={}
    def raw(path):
        data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    def read(path):return json.loads(raw(path))
    manifest=read(assets/'latest-effects/manifest.json');profile=read(decoder/'profile.json')
    inventory=read(decoder/'vfx-assets.json');bound=read(decoder/'vfx-bound-quads.json')
    if (inputs[str((decoder/'vfx-assets.json').resolve())]!=profile['vfxAssetsSha256'] or
            inventory['effectsManifestSha256']!=inputs[str((assets/'latest-effects/manifest.json').resolve())] or
            inputs[str((decoder/'vfx-bound-quads.json').resolve())]!=profile['vfxBoundQuadsSha256']):
        raise ValueError('Profile-pinned source inventory required')
    effect_id='champions/ornn/0/08a1d916';index=8;ref=manifest['definitions'][effect_id]
    definition=read(assets/'latest-effects'/ref['file'])
    if inputs[str((assets/'latest-effects'/ref['file']).resolve())]!=ref['sha256']:raise ValueError('Authored definition differs')
    source=definition['definition']['complexEmitterDefinitionData'][index]
    if source['softParticleParams']!={'deltaIn':100,'__type':'VfxSoftParticleDefinitionData'}:raise ValueError('Bounded soft fixture differs')
    meta=inventory['emitters'][f'{effect_id}:{index}']
    if meta['definitionSha256']!=ref['sha256']:raise ValueError('Emitter inventory differs')
    blob=raw(cache/'research/latest-effects/bins'/f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
    if sha(blob)!=meta['rawSourceSha256']:raise ValueError('Raw BIN differs')
    fields=[]
    for f in meta['fields']:
        data=blob[f['offset']:f['offset']+f['bytes']]
        if sha(data)!=f['sha256']:raise ValueError('Raw emitter field span differs')
        fields.append((f['hash'],data))
    soft_hash=name_hash('softParticleParams')
    if sum(h==soft_hash for h,_ in fields)!=1:raise ValueError('One authored soft field required')
    loader=NativeVfxPostload(decoder,args.client);n=NativeLoadedQuad(decoder,args.client);material=NativeVfxMaterial(decoder,args.client)
    graphs={};postload=[];cases=[]
    for variant in ['authored','absent']:
        before=loader.load([data for h,data in fields if variant=='authored' or h!=soft_hash]);after=loader.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
            raise ValueError('Original full typed load/postload unresolved')
        graphs[variant]=n.prepare_loaded({'phase':'native-postload-callbacks-executed',**after})
        postload.append({'variant':variant,'softPointerBytes':after['objectHex'][0x30*2:0x38*2],
                         'fieldOrderPreserved':True,'onlyRemovedField':None if variant=='authored' else soft_hash})
        loader.restore_preload_arena()
    common_heap=(max(g['nextHeap'] for g in graphs.values())+0x1000+15)&~15
    for g in graphs.values():g['nextHeap']=common_heap
    for seed in [1,0x12345]:
        for pose in ['identity','changing']:
            for variant,graph in graphs.items():
                n.reset_quad(graph,seed,0);frames=[];previous=[0,0,0]
                for tick in range(121):
                    time=tick/60;current=[130*time,3*time,70*time]
                    basis=([0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1] if pose=='changing' and 30<=tick<90 else
                           [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])
                    value={'time':time,'previous':previous,'current':current,'basis':basis,'viewPosition':[0,0,1000],
                           'cameraRight':[1,0,0],'cameraUp':[0,1,0],'viewAxis':[0,0,1]}
                    frames.append({'input':value,'output':n.frame_quad(value)});previous=current
                cases.append({'seedHex':f'{seed:016x}','pose':pose,'variant':variant,'primitiveKind':'loaded',
                              'effectId':effect_id,'emitterIndex':index,'frames':frames})
    bound_ref=next(t for t in bound['templates'] if t['effectId']==effect_id and t['emitterIndex']==index)
    material_graph=read(decoder/bound_ref['file'])
    if inputs[str((decoder/bound_ref['file']).resolve())]!=bound_ref['sha256']:raise ValueError('Exact material graph differs')
    material.prepare_material(material_graph);parameters=material.parameters();selections=[]
    for render_pass in [0,1,5]:
        for graphics34b,graphics29c in [(False,0),(False,2),(True,0),(True,1),(True,2)]:
            environment={'pass':render_pass,'featuresEnabled':True,'resourceMask':0,'systemFogMode':1,
                         'graphics34b':graphics34b,'graphics29c':graphics29c}
            selections.append({'environment':environment,'selection':material.select(environment),'renderState':material.render_state(render_pass)})
    material.finish()
    sources={Path(__file__)}
    for obj in [loader,n,material]:sources.update(Path(inspect.getfile(c)) for c in type(obj).__mro__ if c is not object)
    output={'schema':1,'kind':'native-soft-particle-disabled-material-controls','build':profile['clientVersion'],
            'protocol':profile['protocolDigest'],'effectId':effect_id,'emitterIndex':index,'source':source,
            'postload':postload,'commonRuntimeHeap':common_heap,'cases':cases,'parameters':parameters,'selections':selections,
            'inputs':inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
            'originalBlocks':list(material.material_blocks.values()),
            'scope':{'completeAuthoredEmitterComparedWithOnlySoftFieldAbsent':True,'suppliedPoseMotionSeedClock':True,
                     'depthDisabledNativeGraphicsEnvironment':{'graphics34b':False,'graphics29c':0},
                     'actualGraphicsSettingRecovered':False,'sceneDepthTextureRecovered':False,'depthIntersectionImplemented':False,
                     'gpuSubmitted':False,'runtimeAdmissionChanged':False}}
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Soft-particle input drift')
    path=cache/'research/direct-soft-particles-native.json';path.write_text(json.dumps(output,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(path),'cases':len(cases),'frames':sum(len(c['frames']) for c in cases),'materialSelections':len(selections)}))


if __name__=='__main__':main()

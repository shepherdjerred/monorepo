"""Original all-pass eligibility and static material inputs for camera nav quads.

Source emitters remain unchanged. Full original parent GPU acquisition is
cross-checked independently from its existing source-current observations.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import ADDRESSES as A, name_hash, sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path);p.add_argument('client',type=Path)
    p.add_argument('--component',action='append',required=True)
    args=p.parse_args();cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Nav ground native input drift')
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    manifest=read(assets/'latest-effects/manifest.json')
    metadata=read(assets/'decoder-16.21-macos/vfx-bound-quads.json')
    systems=read(assets/'latest-vfx-system-assets/package.json')
    n=NativeVfxMaterial(assets/'decoder-16.21-macos',args.client)
    paths={Path(__file__).resolve(),args.client.resolve(),assets/'decoder-16.21-macos/profile.json',assets/'decoder-16.21-macos/image.bin'}
    paths.update(Path(inspect.getfile(c)).resolve() for c in type(n).__mro__ if c is not object)
    for path in paths:raw(path)
    props={name:next(p for p in n.type_catalog['09cde442']['properties'] if p['hash']==name_hash(name))
           for name in ['isGroundLayer','useNavmeshMask']}
    typed=[]
    for name,prop in props.items():
        if prop['type']!=0x87 or prop['mask']==0:raise ValueError('Original packed navigation/ground flag required')
        for value in [None,0,1]:
            loaded=n.load([] if value is None else [struct.pack('<IBB',prop['hash'],0x87,value)])
            observed=bool(bytes.fromhex(loaded['objectHex'])[prop['offset']]&prop['mask'])
            if observed!=bool(value):raise ValueError('Original typed flag/default differs')
            typed.append({'name':name,'supplied':value,'observed':observed})
    rows=[];seen=set()
    for supplied in args.component:
        effect,index=supplied.rsplit(':',1)
        if not index.isascii() or not index.isdecimal() or supplied in seen:raise ValueError('Unique exact component identities required')
        seen.add(supplied);index=int(index)
        candidates=[ref for ref in metadata['templates'] if ref['effectId']==effect and ref['emitterIndex']==index]
        if len(candidates)!=1:raise ValueError('One complete original quad graph required')
        ref=candidates[0];graph=raw(assets/'decoder-16.21-macos'/ref['file'])
        definition_ref=manifest['definitions'][effect];definition=raw(assets/'latest-effects'/definition_ref['file'])
        if sha(graph)!=ref['sha256'] or sha(definition)!=ref['sourceDefinitionSha256'] or sha(definition)!=definition_ref['sha256']:
            raise ValueError('Original graph/definition identity differs')
        source=json.loads(definition)['definition']['complexEmitterDefinitionData'][index]
        if source.get('primitive',{}).get('__type') not in [None,'VfxPrimitiveCameraQuad'] or any(source.get(k) not in [1,True] for k in props):
            raise ValueError('Authored camera navigation ground quad required')
        system_ref=systems['systems'][effect];system=raw(assets/'latest-vfx-system-assets'/system_ref['file'])
        if sha(system)!=system_ref['sha256']:raise ValueError('Complete system source differs')
        fog=bytes.fromhex(json.loads(system)['objectHex'])[0xc0]
        if fog not in [0,1]:raise ValueError('Original root fog mode outside verified values')
        n.prepare_material(json.loads(graph))
        if any(not n.u.mem_read(A['definition']+prop['offset'],1)[0]&prop['mask'] for prop in props.values()):
            raise ValueError('Complete graph lost original ground/nav flags')
        passes=[]
        for code in range(7):
            environment={'pass':code,'featuresEnabled':True,'resourceMask':1 if source.get('textureMult') else 0,'systemFogMode':fog,'graphics34b':False,'graphics29c':0}
            shader=n.select(environment)
            n.call(0x16dfd80,{r.UC_X86_REG_RDI:A['link'],r.UC_X86_REG_RSI:code})
            passes.append({'environment':environment,'eligible':bool(n.u.reg_read(r.UC_X86_REG_RAX)&255),'shader':shader})
        eligible=[p['environment']['pass'] for p in passes if p['eligible']]
        if len(eligible)!=1:raise ValueError('Original camera navigation requires one exact eligible pass')
        selected_pass=eligible[0]
        selected=n.select(passes[selected_pass]['environment'])
        parameters=n.parameters();samplers=n.samplers();state=n.render_state(selected_pass)
        n.finish()
        rows.append({'effectId':effect,'emitterIndex':index,'sourceDefinitionSha256':definition_ref['sha256'],
            'graphSha256':ref['sha256'],'systemGraphSha256':system_ref['sha256'],'originalRootFogMode':fog,
            'eligiblePass':selected_pass,'passes':passes,'selection':selected,'parameters':parameters,'samplers':samplers,'renderState':state,
            'sourceAndHeapUnchanged':True})
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Original nav ground input changed')
    output=cache/'research/direct-nav-camera-pass-native-v37.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-navigation-camera-all-pass-material-controls',
        'build':manifest['build'],'protocol':manifest['protocol'],'decoderImageSha256':sha(n.image),
        'inputs':inputs,'registration':props,'typedControls':typed,'cases':rows,'originalBlocks':list(n.material_blocks.values()),
        'scope':{'originalAllSevenPassEligibility':True,'originalShaderSelection':True,'originalStaticParametersAndSamplers':True,
            'unchangedCompleteEmitterAssets':True,'gpuResourcesAcquiredHere':False,'runtimeAdmissionChanged':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'components':len(rows),'passEligibilityCases':len(rows)*7,'typedControls':len(typed)}))


if __name__=='__main__':main()

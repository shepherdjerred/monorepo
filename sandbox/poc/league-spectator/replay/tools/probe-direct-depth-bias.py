"""Original typed emitter depth factors to retained native raster bytes.

The unchanged actual camera emitter is kept separate from supplied typed-field
controls. Shader/material environment is explicit, not inferred live state.
"""
import argparse
import copy
import json
from pathlib import Path
import struct
import sys
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import ADDRESSES as A,name_hash,sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Depth bias input changed')
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    n=NativeVfxMaterial(assets/'decoder-16.21-macos',args.client)
    prop=next(p for p in n.type_catalog['09cde442']['properties'] if p['hash']==name_hash('depthBiasFactors'))
    if (prop['offset'],prop['type'],prop['mask'])!=(0x7c,11,0):raise ValueError('Original Vector2 depth factor registration differs')
    profile=read(assets/'decoder-16.21-macos/profile.json')
    metadata_bytes=raw(assets/'decoder-16.21-macos/vfx-bound-quads.json')
    if sha(metadata_bytes)!=profile['vfxBoundQuadsSha256']:raise ValueError('Pinned original complete quad graphs required')
    metadata=json.loads(metadata_bytes);ref=next(r for r in metadata['templates'] if r['effectId']=='champions/karthus/10/ce863744' and r['emitterIndex']==4)
    graph_bytes=raw(assets/'decoder-16.21-macos'/ref['file'])
    if sha(graph_bytes)!=ref['sha256']:raise ValueError('Original camera graph differs')
    graph=json.loads(graph_bytes);manifest=read(assets/'latest-effects/manifest.json');source_ref=manifest['definitions'][ref['effectId']]
    source_bytes=raw(assets/'latest-effects'/source_ref['file'])
    if sha(source_bytes)!=ref['sourceDefinitionSha256'] or sha(source_bytes)!=source_ref['sha256']:raise ValueError('Complete source definition differs')
    source=json.loads(source_bytes)['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
    gpu_bytes=raw(assets/'latest-complete-quad-gpu/package.json');gpu=json.loads(gpu_bytes)
    binding=next(r for r in gpu['emitters'] if r['effectId']==ref['effectId'] and r['emitterIndex']==ref['emitterIndex'])
    if binding['graphSha256']!=ref['sha256'] or source['depthBiasFactors']!=[-1,-60]:raise ValueError('Actual source material identity differs')
    controls=[]
    for supplied in [None,[0.,0.],[-1.,-60.],[-1.,-12.],[1.,4.],[0.,-1.],[-0.,0.],[-0.,-1.]]:
        fields=[] if supplied is None else [struct.pack('<IBff',prop['hash'],prop['type'],*supplied)]
        loaded=n.load(fields);bits=bytes.fromhex(loaded['objectHex'])[prop['offset']:prop['offset']+8]
        controls.append({'supplied':supplied,'originalTypedFactorHex':bits.hex()})
    cases=[]
    for control in [None,*controls]:
        selected=copy.deepcopy(graph)
        if control is not None:
            segment=next(row for row in selected['segments'] if row['address']==A['definition']);data=bytearray.fromhex(segment['bytesHex']);data[prop['offset']:prop['offset']+8]=bytes.fromhex(control['originalTypedFactorHex']);segment['bytesHex']=data.hex()
        n.prepare_material(selected);factor_hex=bytes(n.u.mem_read(A['definition']+prop['offset'],8)).hex();passes=[]
        for pass_code in range(7):
            environment={**binding['environment'],'pass':pass_code};shader=n.select(environment);state=n.render_state(pass_code);data=bytes.fromhex(state['bytesHex'])
            factors=struct.unpack('<ff',bytes.fromhex(factor_hex));enabled=any(v!=0 for v in factors)
            expected=factor_hex if enabled else bytes(8).hex()
            if data[24:32].hex()!=expected or bool(data[4]&8)!=enabled:raise ValueError(f'Original raster factor order or bytes changed: control={control},pass={pass_code},input={factor_hex},output={data.hex()}')
            passes.append({'environment':environment,'shader':shader,'nativeRenderStateHex':state['bytesHex'],'polygonOffsetEnabled':bool(data[4]&8),'polygonOffsetHex':data[24:32].hex()})
        n.finish()
        if control is None and passes[binding['environment']['pass']]['nativeRenderStateHex']!=binding['nativeRenderStateHex']:raise ValueError('Unchanged actual material state differs from installed package')
        cases.append({'kind':'unchanged-actual-source' if control is None else 'supplied-original-typed-field-control','control':control,'factorHex':factor_hex,'passes':passes})
    raw(args.client)
    for name in ['image.bin','vfx-birth.json','vfx-values.json']:raw(assets/'decoder-16.21-macos'/name)
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Depth bias source drift')
    output=cache/'research/direct-depth-bias-native-v35.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-emitter-depth-bias-typed-raster-controls','artifactVersion':35,'build':profile['clientVersion'],'protocol':profile['protocolDigest'],'inputs':inputs,'property':prop,'source':{'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],'sourceDefinitionSha256':ref['sourceDefinitionSha256'],'graphSha256':ref['sha256'],'authoredFactors':source['depthBiasFactors']},'cases':cases,'originalBlocks':list(n.blocks.values()),'scope':{'originalTypedPropertyAndRasterSetter':True,'unchangedActualEmitterIncluded':True,'separateSuppliedFieldControls':True,'gpuSubmissionCompared':False,'activeAdmissionChanged':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'passes':sum(len(c['passes']) for c in cases),'enableFlags':[(c['factorHex'],[p['polygonOffsetEnabled'] for p in c['passes']]) for c in cases]}))


if __name__=='__main__':main()

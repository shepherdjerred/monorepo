"""Compare original vector packing for every observed draw frame and shader.

Non-draw scene values are controlled byte vectors. This proves packing, not
recovered fog, camera or navigation state. Original 191f950 executes unchanged.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
from native_pipeline_description import NativePipelineDescription
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path);p.add_argument('client',type=Path);args=p.parse_args()
    cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    def read(path):return json.loads(raw(path))
    observations=read(cache/'research/parent-draw-parameters-native.json')
    materials=read(assets/'latest-parent-native-materials/package.json')
    if observations['counts']['returningRoots']!=14 or observations['scope']['partialSelection']:
        raise ValueError('Complete original draw cohort required')
    for name,digest in observations['sources'].items():
        if sha(raw(Path(__file__).with_name(name)))!=digest:raise ValueError('Original draw producer changed')
    for path,digest in observations['inputs'].items():
        if sha(raw(Path(path)))!=digest:raise ValueError('Original draw input changed')
    n=NativePipelineDescription(assets/'decoder-16.21-macos',args.client)
    scene={name:struct.pack('<4f',*value).hex() for name,value in {
        'vCamera':[10,20,30,1],'FOG_OF_WAR_PARAMS':[.25,.5,.75,1],
        'NAV_GRID_XFORM':[.125,.25,.5,1],'RENDERTARGET_IS_SRGB':[0,0,0,0]}.items()}
    cases=[]
    for case in observations['cases']:
        for frame in case['frames']:
            for draw in frame['drawParameters']:
                actor=materials['roots'][case['effectId']]['actors'][str(draw['emitterIndex'])]
                rows=[row for row in actor['rows'] if row['hash']==draw['passHash']]
                if len(rows)!=1 or len(rows[0]['variants'])!=1:raise ValueError('Explicit observed material variant required')
                variant=rows[0]['variants'][0]
                for stage in ['vertex','pixel']:
                    shader=read(assets/'latest-shaders'/variant['shaders'][stage]['file'])
                    for block in shader['sidecar']['blocks']:
                        if block['name']=='$Globals' or not any(m['used'] for m in block['members']):continue
                        vectors=[]
                        for member in block['members']:
                            if not member['used']:continue
                            name=member['name'];data=draw['values'].get(name,scene.get(name))
                            if data is None:raise ValueError('Unprovided controlled packing source '+name)
                            vectors.append({'name':name,'count':len(bytes.fromhex(data))//16,'bytesHex':data})
                        expected=n.uniform_bytes(vectors,block)
                        cases.append({'effectId':case['effectId'],'tick':frame['tick'],'emitterIndex':draw['emitterIndex'],
                            'stage':stage,'block':block,'uniforms':vectors,'bytesHex':expected.hex()})
        print(json.dumps({'effectId':case['effectId'],'blocks':len(cases)}),flush=True)
    sources={Path(__file__)}
    sources.update(Path(inspect.getfile(c)) for c in NativePipelineDescription.__mro__ if c is not object)
    result={'schema':1,'kind':'original-parent-frame-uniform-observations','build':observations['build'],
        'protocol':observations['protocol'],'inputs':inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
        'originalBlocks':list(n.blocks.values()),'sceneVectorsHex':scene,'cases':cases,
        'counts':{'roots':len(observations['cases']),'blocks':len(cases)},
        'scope':{'originalPackingExecuted':True,'controlledSceneVectors':True,'replaySceneRecovered':False,'gpuSubmitted':False}}
    path=cache/'research/parent-frame-uniforms-native.json';path.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(path),'counts':result['counts']}))


if __name__=='__main__':main()

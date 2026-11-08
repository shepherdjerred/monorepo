"""Prove only the native depth-disabled material branch and its real raster.

The active soft permutation's required depth inputs are inventoried, never bound
to a fabricated constant texture or guessed projection conversion.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('soft_draw',Path(__file__).with_name('render-particle-shader.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','angle']:parser.add_argument(name,type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        value=path.read_bytes();inputs[str(path.resolve())]=sha(value);return value
    def read(path):return json.loads(raw(path))
    native=read(cache/'research/direct-soft-particles-native.json')
    if (native.get('kind')!='native-soft-particle-disabled-material-controls' or
            native.get('build')!='16.21.829.8620' or native.get('protocol')!='20e09df23c66b85e' or
            native.get('effectId')!='champions/ornn/0/08a1d916' or native.get('emitterIndex')!=8):
        raise ValueError('Exact bounded original soft-particle observation required')
    for path,digest in native['inputs'].items():
        if sha(raw(Path(path)))!=digest:raise ValueError('Native soft input drift')
    for name,digest in native['sources'].items():
        if sha(raw(Path(__file__).with_name(name)))!=digest:raise ValueError('Native soft producer drift')
    profile=read(assets/'decoder-16.21-macos/profile.json');image=raw(assets/'decoder-16.21-macos/image.bin')
    if sha(image)!=profile['decoderImageSha256'] or not native['originalBlocks']:
        raise ValueError('Pinned original soft-material instruction image required')
    for block in native['originalBlocks']:
        if sha(image[block['rva']:block['rva']+block['size']])!=block['sha256']:
            raise ValueError('Original soft-material instruction bytes differ')
    expected={(seed,pose,variant) for seed in ['0000000000000001','0000000000012345'] for pose in ['identity','changing'] for variant in ['authored','absent']}
    cases={(c['seedHex'],c['pose'],c['variant']):c for c in native['cases']}
    if len(cases)!=len(native['cases']) or set(cases)!=expected:raise ValueError('Exact nonempty native control matrix required')
    frames=0;vertices=0;positive=0
    for seed,pose,_ in sorted(k for k in expected if k[2]=='authored'):
        a=cases[(seed,pose,'authored')]['frames'];b=cases[(seed,pose,'absent')]['frames']
        if len(a)!=121 or a!=b:raise ValueError('Soft field affected complete simulation/RNG/geometry')
        if any(f['input']['time']!=tick/60 for tick,f in enumerate(a)):
            raise ValueError('Exact 121-frame original clock schedule required')
        births=sum(len(f['output']['state']['births']) for f in a)
        if not births:raise ValueError('Empty native simulation cannot prove equivalence')
        for f in a:
            geometry=f['output']['geometry'];v=bytes.fromhex(geometry['verticesHex']);idx=bytes.fromhex(geometry['indicesHex'])
            if len(v)%28 or len(idx)%6:raise ValueError('Original geometry layout differs')
            points=np.array([struct.unpack_from('<3f',v,i) for i in range(0,len(v),28)])
            indices=struct.unpack('<'+'H'*(len(idx)//2),idx)
            area=sum(float(np.linalg.norm(np.cross(points[indices[i+1]]-points[indices[i]],points[indices[i+2]]-points[indices[i]])))>0 for i in range(0,len(indices),3))
            positive+=area;vertices+=len(v)//28;frames+=1
    if not positive:raise ValueError('Positive-area native geometry required')
    encoded=lambda value:json.dumps(value,sort_keys=True,separators=(',',':'))
    expected_environments={encoded({'pass':p,'featuresEnabled':True,'resourceMask':0,'systemFogMode':1,
                                    'graphics34b':b,'graphics29c':c})
                           for p in [0,1,5] for b,c in [(False,0),(False,2),(True,0),(True,1),(True,2)]}
    actual_environments=[encoded(row['environment']) for row in native['selections']]
    if len(actual_environments)!=15 or len(set(actual_environments))!=15 or set(actual_environments)!=expected_environments:
        raise ValueError('Exact unique 15-environment material branch matrix required')
    params={p['name']:p for p in native['parameters']}
    for name,expected in [('cSoftParticleParams',[0,1e8,struct.unpack('<f',struct.pack('<f',.01))[0],1e8]),
                          ('cSoftParticleControl',[0,1,0,1])]:
        if name not in params or params[name]['bytesHex']!=struct.pack('<4f',*expected).hex():
            raise ValueError('Original soft-material uniform computation differs')
    for row in native['selections']:
        e=row['environment'];active=e['pass']!=1 and e['graphics34b'] and e['graphics29c']>=2
        if any(d['name']=='SOFT_PARTICLES' for d in row['selection']['defines'])!=active:
            raise ValueError('Original conditional soft selection differs')
    gpu=read(assets/'latest-complete-quad-gpu/package.json')
    matches=[x for x in gpu['emitters'] if (x['effectId'],x['emitterIndex'])==(native['effectId'],native['emitterIndex'])]
    if len(matches)!=1:raise ValueError('One exact prepared material required')
    binding=matches[0];environment={'pass':0,'featuresEnabled':True,'resourceMask':0,'systemFogMode':1,'graphics34b':False,'graphics29c':0}
    if binding['environment']!=environment or any(d['name']=='SOFT_PARTICLES' for d in binding['nativeDefines']):raise ValueError('Exact native depth-disabled environment required')
    baseline=next(r for r in native['selections'] if r['environment']==environment)
    if binding['nativeDefines']!=baseline['selection']['defines'] or binding['nativeRenderStateHex']!=baseline['renderState']['bytesHex']:
        raise ValueError('Prepared material differs from fresh native branch')
    stages=[]
    for stage in ['vertex','pixel']:
        ref=binding['shaders'][stage];path=assets/'latest-shaders'/ref['file'];value=read(path)
        if inputs[str(path.resolve())]!=ref['sha256']:raise ValueError('Prepared shader bytes differ')
        if any(m['used'] and (m['name'].startswith('cSoft') or m['name']=='cDepthConversionParams') for block in value['sidecar']['blocks'] for m in block['members']):
            raise ValueError('Depth-disabled shader unexpectedly consumes soft/depth uniforms')
        if any(t['name']=='sDepthTexture_SharedTexture' for t in value['sidecar']['textures']):raise ValueError('Depth-disabled shader requires depth')
        stages.append(value)
    pairs=read(cache/'research/latest-shaders/pairs.json')
    active=next(p for p in pairs['programs'] if p['family']=='quad' and p['defines']==[{'name':'DISABLE_FOW','value':'1'},{'name':'SOFT_PARTICLES','value':'1'}])
    active_contract=[]
    for stage in ['vertex','pixel']:
        ref=active[stage];path=assets/'latest-shaders'/ref['file'];value=read(path)
        if inputs[str(path.resolve())]!=ref['sha256']:raise ValueError('Active soft shader bytes differ')
        active_contract.append({'stage':stage,'shaderSha256':ref['sha256'],
            'usedUniforms':[{'block':b['glslName'],**m} for b in value['sidecar']['blocks'] for m in b['members'] if m['used']],
            'textures':value['sidecar']['textures']})
    # Select the strongest native alpha frame, with indexed positive geometry.
    sample=max(cases[('0000000000012345','identity','authored')]['frames'],key=lambda f:max(bytes.fromhex(f['output']['geometry']['verticesHex'])[15::28],default=0))
    geometry=sample['output']['geometry'];v=bytes.fromhex(geometry['verticesHex']);idx=bytes.fromhex(geometry['indicesHex'])
    points=np.array([struct.unpack_from('<3f',v,i) for i in range(0,len(v),28)]);low,high=points.min(0),points.max(0);axes=np.argsort(high-low)[-2:];center=(low+high)/2;extent=max((high-low)[axes])*.6
    if not extent>0:raise ValueError('Nondegenerate visual projection required')
    projection=np.zeros((4,4));projection[0,axes[0]]=projection[1,axes[1]]=1/extent;projection[0,3]=-center[axes[0]]/extent;projection[1,3]=-center[axes[1]]/extent;projection[2,3]=.5;projection[3,3]=1
    renderer=adapter.Draw(args.angle);program=None
    try:
        program=renderer.program(*stages);values={};textures={}
        for shader in stages:
            for block in shader['sidecar']['blocks']:
                data=bytes.fromhex(next(b for b in binding['blocks'] if b['glslName']==block['glslName'])['bytesHex'])
                for m in block['members']:
                    if not m['used']:continue
                    value=projection.flatten().tolist() if m['name']=='mProj' else [0,1000,0] if m['name']=='vCamera' else list(struct.unpack_from('<'+{'float':'f','uint':'I','int':'i','bool':'I'}[m['scalar']]*(m['size']//4),data,m['offset']))
                    values[block['glslName']+'.'+m['name']]=value
            for texture in shader['sidecar']['textures']:
                resources=[binding['textures'][s['glslName']] for s in texture['samplers']]
                if not resources or any(x!=resources[0] for x in resources):raise ValueError('Inconsistent exact texture resource')
                resource=resources[0]
                if resource['kind']=='prepared-texture':
                    path=assets/'latest-effects'/resource['file']
                    if sha(raw(path))!=resource['sha256']:raise ValueError('Actual texture bytes differ')
                    pixels=np.array(Image.open(path).convert('RGBA'));address=resource['sampler']['name'];filtering='nearest' if resource['sampler']['pixelated'] else 'linear'
                elif resource['kind'] in ['supplied-white-lookup','supplied-transparent-remap']:
                    pixels=np.full((1,1,4),255 if resource['kind']=='supplied-white-lookup' else 0,dtype=np.uint8);address='clamp';filtering='nearest'
                else:raise ValueError('Unsupported prepared resource; never fabricate depth')
                textures[texture['name']]=renderer.texture(pixels,address,filtering)
        factors=binding['nativeBlendFactors'];mapping={1:1,6:0x302,7:0x303}
        if factors[0]!=factors[1] or factors[2]!=factors[3]:raise ValueError('Separate-alpha blend adapter required')
        rgba,buffers=renderer.draw(program,stages,v,idx,values,textures,blend=(mapping[factors[0]],mapping[factors[2]]))
        visible=int(np.count_nonzero(np.any(np.abs(rgba[:,:,:3].astype(int)-[6,9,14])>2,axis=2)))
        if visible<100:raise ValueError('Actual native component did not produce visible pixels')
    finally:
        if program:renderer.gl.glDeleteProgram(program)
        renderer.close()
    image=cache/'visuals/direct-soft-disabled-native.png';image.parent.mkdir(exist_ok=True);Image.fromarray(rgba).save(image)
    for path in [Path(__file__),Path(adapter.__file__),Path(adapter.adapter.__file__),args.angle/'libEGL.dll',args.angle/'libGLESv2.dll']:raw(path)
    result={'schema':1,'kind':'soft-particle-depth-disabled-partial-proof','inputs':inputs,
        'counts':{'comparedAuthoredFrames':frames,'comparedNativeFramesIncludingAbsent':frames*2,'vertices':vertices,'positiveTriangles':positive,'materialBranches':15},
        'nativeGeometryRngAndCompleteRetainedStateExact':True,'nativeParameters':native['parameters'],'environment':environment,
        'fullSoftShaderInputs':active_contract,'visual':{'path':str(image),'sha256':sha(image.read_bytes()),'nativeTime':sample['input']['time'],'visiblePixels':visible,'uniformBuffers':buffers},
        'scope':{'offscreenNativeGeometryAndPreparedShaderRendered':True,'browserExecuted':False,'actualMatchCoverage':False,
                 'actualGraphicsSettingRecovered':False,'sceneDepthProducerRecovered':False,'depthIntersectionImplemented':False,'runtimeAdmissionChanged':False,
                 'omissions':['soft-particle scene-depth intersection and original graphics-setting provenance; native depth-disabled material branch only']}}
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Soft proof input drift')
    output=cache/'research/direct-soft-particles-comparison.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts'],'visiblePixels':visible,'image':str(image)}))


if __name__=='__main__':main()

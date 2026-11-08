"""Render decoded projectile trails with original translated shaders offscreen."""
import argparse
import importlib.util
import json
import struct
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('trail_draw',Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','angle','output']:
        p.add_argument(name,type=Path)
    p.add_argument('--quad-pools',action='store_true',help='Render shared complete quad-pool composition instead of trails')
    args=p.parse_args()
    cache=args.cache.resolve()
    sources={}
    def raw(path):
        b=path.read_bytes();sources[str(path.resolve())]=adapter.sha(b);return b
    def read(path):return json.loads(raw(path))
    mode='quad-pool' if args.quad_pools else 'trail'
    playback_path=cache/f'research/{mode}-playback.json'
    playback=read(playback_path)
    proof=read(cache/f'research/{mode}-playback-native.json')
    if proof['playbackSha256']!=sources[str(playback_path)] or proof['mismatches']:
        raise ValueError('Trail native playback comparison changed')
    root=Path(__file__).parent.parent
    for name,h in playback['sources'].items():
        if adapter.sha(raw(root/name))!=h:raise ValueError('Trail renderer source changed: '+name)
    gpu=read(cache/('public/latest-complete-quad-gpu/package.json' if args.quad_pools else 'public/latest-trail-particles/gpu.json'))
    for path,h in gpu['inputs'].items():
        if adapter.sha(raw(Path(path)))!=h:raise ValueError('Trail GPU input changed: '+path)
    chosen=[s for s in playback['observations'] if s['trace']['sequence']==playback['traces'][0]['sequence'] and s['age']>0]
    coordinates=[]
    for s in chosen:
        if s['actual']:
            b=bytes.fromhex(s['actual']['geometry']['verticesHex'])
            coordinates.extend([struct.unpack_from('<3f',b,i) for i in range(0,len(b),28)])
    points=np.array(coordinates)
    lo,hi=points.min(axis=0),points.max(axis=0)
    center=(lo+hi)/2
    extent=max(hi[0]-lo[0],hi[2]-lo[2])*0.6
    projection=[1/extent,0,0,-center[0]/extent,0,0,1/extent,-center[2]/extent,
        0,0,0,.5,0,0,0,1]
    renderer=adapter.Draw(args.angle)
    programs,textures,panels,observations={},{},[],[]
    real_clear=renderer.gl.glClear
    try:
        for age in sorted({s['age'] for s in chosen}):
            rgba=np.tile(np.array([6,9,14,255],dtype=np.uint8),(512,512,1))
            renderer.gl.glClearColor(.025,.035,.055,1)
            real_clear(0x4000)
            renderer.gl.glClear=lambda mask:None
            draws=sorted([s for s in chosen if s['age']==age and s['actual']],
                key=lambda s:next(e for e in gpu['emitters'] if e['effectId']==s['ref']['effectId'] and
                    e['emitterIndex']==s['ref']['emitterIndex'])['suppliedSortPass'])
            for s in draws:
                geometry=s['actual']['geometry']
                if not geometry['indicesHex']:continue
                e=next(e for e in gpu['emitters'] if e['effectId']==s['ref']['effectId'] and e['emitterIndex']==s['ref']['emitterIndex'])
                if e['graphSha256']!=s['ref']['sha256']:raise ValueError('Trail material/geometry identity differs')
                key=tuple(e['shaders'][stage]['sha256'] for stage in ['vertex','pixel'])
                if key not in programs:
                    stages=[]
                    for stage in ['vertex','pixel']:
                        ref=e['shaders'][stage];b=raw(cache/'public/latest-shaders'/ref['file'])
                        if adapter.sha(b)!=ref['sha256']:raise ValueError('Trail shader changed')
                        stages.append(json.loads(b))
                    programs[key]=(renderer.program(*stages),stages)
                program,stages=programs[key]
                values={}
                for shader in stages:
                    for block in shader['sidecar']['blocks']:
                        prepared=next(b for b in e['blocks'] if b['glslName']==block['glslName'])
                        data=bytes.fromhex(prepared['bytesHex'])
                        for member in block['members']:
                            if not member['used']:continue
                            if member['name']=='mProj':value=projection
                            elif member['name']=='vCamera':value=playback['camera']['position']
                            else:
                                code={'float':'f','uint':'I','bool':'I','int':'i'}[member['scalar']]
                                value=list(struct.unpack_from('<'+code*(member['size']//4),data,member['offset']))
                            values[block['glslName']+'.'+member['name']]=value
                bound_textures={}
                for shader in stages:
                    for t in shader['sidecar']['textures']:
                        bindings=[e['textures'][sampler['glslName']] for sampler in t['samplers']]
                        if not bindings or any(b!=bindings[0] for b in bindings):raise ValueError('Ambiguous trail texture binding')
                        binding=bindings[0];tk=json.dumps(binding,sort_keys=True)
                        if tk not in textures:
                            if binding['kind']=='prepared-texture':
                                path=cache/'public/latest-effects'/binding['file']
                                if adapter.sha(raw(path))!=binding['sha256']:raise ValueError('Trail texture changed')
                                pixels=np.array(Image.open(path).convert('RGBA'))
                                address=binding['sampler']['name'];filtering='nearest' if binding['sampler']['pixelated'] else 'linear'
                            elif binding['kind'] in ['supplied-white-lookup','supplied-transparent-remap']:
                                pixels=np.full((1,1,4),255 if binding['kind']=='supplied-white-lookup' else 0,dtype=np.uint8)
                                address,filtering='clamp','nearest'
                            else:raise ValueError('Unprovided trail texture')
                            textures[tk]=renderer.texture(pixels,address,filtering)
                        bound_textures[t['name']]=textures[tk]
                factors=e['nativeBlendFactors']
                if factors[0]!=factors[1] or factors[2]!=factors[3]:raise ValueError('Separate trail blend factors not implemented')
                mapping={1:1,6:0x302,7:0x303}
                rgba,buffers=renderer.draw(program,stages,bytes.fromhex(geometry['verticesHex']),
                    bytes.fromhex(geometry['indicesHex']),values,bound_textures,
                    blend=(mapping[factors[0]],mapping[factors[2]]))
                observations.append({'sequence':s['trace']['sequence'],'emitterIndex':e['emitterIndex'],'age':age,
                    'verticesSha256':adapter.sha(bytes.fromhex(geometry['verticesHex'])),
                    'indicesSha256':adapter.sha(bytes.fromhex(geometry['indicesHex'])),
                    'uniformBuffers':buffers,'rgbaSha256':adapter.sha(rgba.tobytes())})
            renderer.gl.glClear=real_clear
            panels.append((age,rgba,len(draws)))
    finally:
        renderer.gl.glClear=real_clear
        for program,_ in programs.values():renderer.gl.glDeleteProgram(program)
        renderer.close()
    fig,axes=plt.subplots(2,3,figsize=(16,11))
    fig.patch.set_facecolor('#101a2a')
    fig.subplots_adjust(top=.82,bottom=.18,left=.04,right=.97,hspace=.18,wspace=.08)
    title='Projectile quad pools' if args.quad_pools else 'Projectile trails'
    fig.text(.04,.95,title+': replay path → native particles → game shaders',fontsize=21,color='#eef5ff',weight='bold')
    fig.text(.04,.905,'Vladimir E · equipped skin 39 · original replay NA1-5665845207 · build 16.21.829.8620',fontsize=12,color='#aec6e5')
    detail='Eight quad layers, including the camera-facing emitter; complete native pools, UVs, textures and materials.' if args.quad_pools else 'Three previously omitted CameraTrail layers; original textures, atlas values, packed colors, UVs and blend factors.'
    fig.text(.04,.865,detail,fontsize=11,color='#9cd9c5')
    for ax,(age,rgba,count) in zip(axes.flat,panels):
        linear=rgba[:,:,:3].astype(np.float64)/255
        display=np.clip(np.where(linear<=.0031308,linear*12.92,
            1.055*linear**(1/2.4)-.055),0,1)
        ax.imshow(display);ax.axis('off');ax.set_title(f'+{age:.2f}s · {count} live layers',color='#eef5ff',fontsize=12)
    fig.text(.04,.125,'Native resimulation agrees with the replay compositor; forward sampling and reverse seeking preserve geometry.',fontsize=11,color='#9cd9c5')
    fig.text(.04,.085,'Supplied activation, stop-time birth suspension, 60 Hz clock, seed, actor basis and fitted camera. Offscreen ANGLE; sRGB display encoding.',fontsize=10,color='#ddc08c')
    fig.text(.04,.045,'Full effect lifecycle, main browser acceptance, game scene resources and reference A/V comparison remain unverified.',fontsize=10,color='#ddc08c')
    fig.savefig(args.output,dpi=110,facecolor=fig.get_facecolor());plt.close(fig)
    result={'schema':1,'kind':f'replay-{mode}-shader-visual','sources':sources,
        'rendererSha256':adapter.sha(Path(__file__).read_bytes()),'imageSha256':adapter.sha(args.output.read_bytes()),
        'context':renderer.info,'samples':observations,'scope':{'nativeGeometryAndMaterialInputs':True,
            'sceneInputsSupplied':True,'offscreenRendered':True,'sRgbDisplayEncoding':True,'browserRendered':False,'referenceCompared':False}}
    args.output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'imageSha256':result['imageSha256'],'draws':len(observations),'programs':len(programs)}))


if __name__=='__main__':main()

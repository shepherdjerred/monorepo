"""Render catalog-selected native particle geometry with authored color lookups.

Offscreen component evidence, not replay activation or matching League footage.
"""
import argparse,importlib.util,json,struct
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec=importlib.util.spec_from_file_location('color_draw',Path(__file__).with_name('render-particle-shader.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','angle','output']:parser.add_argument(name,type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';sources={}
    def raw(path):
        data=path.read_bytes();sources[str(path.resolve())]=adapter.sha(data);return data
    def read(path):return json.loads(raw(path))
    gpu=read(assets/'latest-complete-quad-gpu/package.json')
    proof=read(cache/'research/particle-color-gpu-comparison.json')
    for path,h in proof['inputs'].items():
        if adapter.sha(raw(Path(path)))!=h:raise ValueError('Color GPU comparison input changed')
    native=read(cache/'research/vfx-bound-quads-native.json')
    compared=read(cache/'research/vfx-bound-quads-comparison.json')
    if compared['nativeEvidenceSha256']!=sources[str(cache/'research/vfx-bound-quads-native.json')] or compared['mismatchCount']:
        raise ValueError('Native color geometry comparison differs')
    color=read(assets/'latest-particle-color/package.json')
    by_graph={c['graphSha256']:c for c in native['cases'] if c['mode']==0}
    entries={f"{e['effectId']}:{e['emitterIndex']}":e for e in color['entries']}
    old=read(cache/'research/complete-quad-gpu-before-color.json')
    old_keys={f"{e['effectId']}:{e['emitterIndex']}" for e in old['emitters']}
    candidates=[]
    for e in gpu['emitters']:
        key=f"{e['effectId']}:{e['emitterIndex']}"
        if key in old_keys:continue
        entry=entries[key];case=by_graph.get(e['graphSha256'])
        if not case:continue
        frames=[f for f in case['frames'] if any(abs(f['input']['time']-t)<1e-6 for t in [.1,.3,.5])]
        if len(frames)!=3 or any(not f['output']['geometry']['indicesHex'] for f in frames):continue
        pixels=np.array(Image.open(assets/'latest-effects'/entry['asset']['file']).convert('RGBA'))
        # Select by authored color variation and live geometry, without spell rules.
        score=float(np.ptp(pixels[:,:,:3].astype(float),axis=(0,1)).sum())
        if score>0:candidates.append((score,e,entry,frames))
    candidates.sort(key=lambda c:-c[0]);chosen=[];champions=set()
    for row in candidates:
        champion=row[1]['effectId'].split('/')[1]
        if champion in champions:continue
        chosen.append(row);champions.add(champion)
        if len(chosen)==3:break
    if len(chosen)!=3:raise ValueError('Insufficient varied native color examples')
    renderer=adapter.Draw(args.angle);programs={};textures={};panels=[];observations=[]
    diagnostic_white=renderer.texture(np.full((1,1,4),255,dtype=np.uint8),'clamp','linear')
    try:
        for score,e,entry,frames in chosen:
            shader_key=tuple(e['shaders'][s]['sha256'] for s in ['vertex','pixel'])
            if shader_key not in programs:
                stages=[]
                for s in ['vertex','pixel']:
                    ref=e['shaders'][s];data=raw(assets/'latest-shaders'/ref['file'])
                    if adapter.sha(data)!=ref['sha256']:raise ValueError('Color shader changed')
                    stages.append(json.loads(data))
                programs[shader_key]=(renderer.program(*stages),stages)
            program,stages=programs[shader_key]
            coords=np.concatenate([adapter.positions(bytes.fromhex(f['output']['geometry']['verticesHex'])) for f in frames])
            center=(coords.max(axis=0)+coords.min(axis=0))/2
            _,_,axes=np.linalg.svd(coords-center,full_matrices=False)
            right,up=axes[:2];extent=float(np.max(np.abs((coords-center)@axes[:2].T))*1.15)
            if extent<=0:raise ValueError('Degenerate native color geometry')
            projection=[*(right/extent),-float(center@right)/extent,*(up/extent),-float(center@up)/extent,
                0,0,0,.5,0,0,0,1]
            bound={}
            for stage in stages:
                for t in stage['sidecar']['textures']:
                    bindings=[e['textures'][s['glslName']] for s in t['samplers']]
                    if not bindings or any(b!=bindings[0] for b in bindings):raise ValueError('Ambiguous color texture')
                    binding=bindings[0];key=json.dumps(binding,sort_keys=True)
                    if key not in textures:
                        if binding['kind']=='prepared-texture':
                            path=assets/'latest-effects'/binding['file'];data=raw(path)
                            if adapter.sha(data)!=binding['sha256']:raise ValueError('Color texture changed')
                            pixels=np.array(Image.open(path).convert('RGBA'))
                            address=binding['sampler']['name'];filtering='nearest' if binding['sampler']['pixelated'] else 'linear'
                        elif binding['kind'] in ['supplied-white-lookup','supplied-transparent-remap']:
                            pixels=np.full((1,1,4),255 if binding['kind']=='supplied-white-lookup' else 0,dtype=np.uint8)
                            address,filtering='clamp','nearest'
                        else:raise ValueError('Unprovided color resource')
                        textures[key]=renderer.texture(pixels,address,filtering)
                    bound[t['name']]=textures[key]
            row=[]
            for frame in frames:
                values={}
                for block in e['blocks']:
                    data=bytes.fromhex(block['bytesHex'])
                    matching=[b for s in stages for b in s['sidecar']['blocks'] if b['glslName']==block['glslName']]
                    if not matching:raise ValueError('Prepared color uniform block missing')
                    for member in matching[0]['members']:
                        if not member['used']:continue
                        if member['name']=='mProj':value=projection
                        elif member['name']=='vCamera':value=frame['input']['viewPosition']
                        else:
                            code={'float':'f','uint':'I','bool':'I','int':'i'}[member['scalar']]
                            value=list(struct.unpack_from('<'+code*(member['size']//4),data,member['offset']))
                        values[block['glslName']+'.'+member['name']]=value
                geometry=frame['output']['geometry'];factors=e['nativeBlendFactors'];mapping={1:1,6:0x302,7:0x303}
                if factors[0]!=factors[1] or factors[2]!=factors[3]:raise ValueError('Separate native blends unimplemented')
                rgba,buffers=renderer.draw(program,stages,bytes.fromhex(geometry['verticesHex']),
                    bytes.fromhex(geometry['indicesHex']),values,bound,blend=(mapping[factors[0]],mapping[factors[2]]))
                without_lookup,_=renderer.draw(program,stages,bytes.fromhex(geometry['verticesHex']),
                    bytes.fromhex(geometry['indicesHex']),values,
                    {**bound,'PARTICLE_COLOR_TEXTURE__TX':diagnostic_white},
                    blend=(mapping[factors[0]],mapping[factors[2]]))
                row.append((frame['input']['time'],rgba))
                observations.append({'effectId':e['effectId'],'emitterIndex':e['emitterIndex'],
                    'graphSha256':e['graphSha256'],'time':frame['input']['time'],
                    'nativeSamplerHex':entry['descriptorHex'],'lookupSha256':entry['asset']['sha256'],
                    'verticesSha256':adapter.sha(bytes.fromhex(geometry['verticesHex'])),
                    'indicesSha256':adapter.sha(bytes.fromhex(geometry['indicesHex'])),
                    'uniformBuffers':buffers,'rgbaSha256':adapter.sha(rgba.tobytes()),
                    'diagnosticWhiteLookupRgbaSha256':adapter.sha(without_lookup.tobytes()),
                    'lookupChangedPixels':int(np.count_nonzero(np.any(rgba!=without_lookup,axis=2))),
                    'nonBackgroundPixels':int(np.count_nonzero(np.any(rgba[:,:,:3]!=rgba[0,0,:3],axis=2)))})
            panels.append((e,entry,row))
    finally:
        for program,_ in programs.values():renderer.gl.glDeleteProgram(program)
        renderer.close()
    fig,axes=plt.subplots(3,3,figsize=(15,13));fig.patch.set_facecolor('#101a2a')
    fig.subplots_adjust(left=.05,right=.98,bottom=.13,top=.85,hspace=.24,wspace=.04)
    fig.text(.05,.96,'Shared particle color textures',fontsize=25,color='#eef5ff',weight='bold')
    fig.text(.05,.92,'Original sampler code + authored lookup textures + native geometry + translated game shaders',fontsize=12,color='#b5d0e6')
    fig.text(.05,.885,'551 native sampler bindings; 404 additional GPU-ready emitters across quad and trail families.',fontsize=11,color='#94d4c4')
    for axes_row,(e,entry,row) in zip(axes,panels):
        for ax,(time,rgba) in zip(axes_row,row):
            linear=rgba[:,:,:3].astype(float)/255
            display=np.clip(np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055),0,1)
            ax.imshow(display);ax.axis('off')
            ax.set_title(f"{e['effectId'].split('/')[1].title()} · emitter {e['emitterIndex']} · +{time:.1f}s",color='#eef5ff',fontsize=10)
    fig.text(.05,.085,'Offscreen component examples selected by texture variation and live geometry. Supplied clock, seed and fitted camera.',fontsize=10,color='#dfc08b')
    fig.text(.05,.05,'Replay activation, full scene resources, browser appearance and League reference fidelity remain unverified.',fontsize=10,color='#dfc08b')
    args.output.parent.mkdir(parents=True,exist_ok=True);fig.savefig(args.output,dpi=110,facecolor=fig.get_facecolor());plt.close(fig)
    evidence={'schema':1,'kind':'native-particle-color-visual','sources':sources,
        'rendererSha256':adapter.sha(Path(__file__).read_bytes()),'adapterSha256':adapter.sha(Path(__file__).with_name('render-particle-shader.py').read_bytes()),
        'imageSha256':adapter.sha(args.output.read_bytes()),'samples':observations,'context':renderer.info,
        'scope':{'originalNativeGeometry':True,'authoredColorTextures':True,'originalSamplerPrefixExecuted':True,
            'offscreenRendered':True,'sRgbDisplayEncoding':True,'nativeFactoryExecuted':False,'browserRun':False,'referenceCompared':False}}
    args.output.with_suffix('.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps({'draws':len(observations),'imageSha256':evidence['imageSha256'],
        'examples':[(e['effectId'],e['emitterIndex']) for e,_,_ in panels],
        'nonBackgroundPixels':[s['nonBackgroundPixels'] for s in observations],
        'lookupChangedPixels':[s['lookupChangedPixels'] for s in observations]}))


if __name__=='__main__':main()

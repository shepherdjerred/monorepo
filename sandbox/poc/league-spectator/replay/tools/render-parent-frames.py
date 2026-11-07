"""Render inspected whole-parent geometry with prepared game-shader materials.

Scene inputs and pass order are supplied diagnostic policies. This is not a
League replay frame, browser capture or original scene/material-frame proof.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec=importlib.util.spec_from_file_location('parent_draw',Path(__file__).with_name('render-particle-shader.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('angle',type=Path)
    modes=p.add_mutually_exclusive_group()
    modes.add_argument('--placement',action='store_true',help='Render the separately compared moving-parent cohort')
    modes.add_argument('--missiles',action='store_true',help='Render the compared simultaneous replay missile bursts');args=p.parse_args()
    cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=adapter.sha(b);return b
    def read(path):return json.loads(raw(path))
    observation_path=cache/'research'/('parent-missiles-native.json' if args.missiles else 'parent-placement-native.json' if args.placement else 'parent-frames-native.json');data=read(observation_path)
    proof_path=cache/'research'/('parent-missiles-wasm.json' if args.missiles else 'parent-placement-wasm.json' if args.placement else 'parent-frames-inspection.json');proof=read(proof_path)
    if proof['observationSha256']!=inputs[str(observation_path)] or proof['mismatchCount']:
        raise ValueError('Parent geometry lacks matching cohort inspection')
    if args.placement or args.missiles:
        if args.placement and (proof['kind']!='original-parent-placement-native-wasm-worker-comparison' or proof['counts']['roots']!=10 or
                proof['counts']['forwardFrames']!=600 or proof['counts']['restoredFrames']!=480 or not proof['scope']['realBunModuleWorkers']):
            raise ValueError('Moving parent geometry lacks complete native/WASM worker comparison')
        if args.missiles and (proof['kind']!='simultaneous-replay-parent-native-wasm-comparison' or proof['counts']['parents']!=30 or
                proof['counts']['forwardParentUpdates']!=555 or proof['counts']['restoredParentUpdates']!=375 or not proof['scope']['simultaneousParents']):
            raise ValueError('Replay bursts lack complete simultaneous native/WASM comparison')
        for name,digest in proof['sources'].items():
            if adapter.sha(raw(Path(__file__).parent.parent/name))!=digest:raise ValueError('Moving parent WASM producer changed')
        gpu_reference=read(cache/'research/parent-frames-native.json')
        if gpu_reference['build']!=data['build'] or gpu_reference['protocol']!=data['protocol']:raise ValueError('Moving parent material reference build differs')
    else:
        if proof['checks']['roots']!=10:raise ValueError('Incomplete parent geometry cohort')
        gpu_reference=data
    for name,digest in data['sources'].items():
        if adapter.sha(raw(Path(__file__).with_name(name)))!=digest:raise ValueError('Parent producer source changed')
    packages=[read(assets/'latest-complete-quad-gpu/package.json'),read(assets/'latest-trail-particles/gpu.json')]
    bindings={(e['effectId'],e['emitterIndex']):e for package in packages for e in package['emitters']}
    for package in packages:
        for path,digest in package['inputs'].items():
            if adapter.sha(raw(Path(path)))!=digest:raise ValueError('Parent diagnostic material input changed: '+path)
    effects=read(assets/'latest-effects/manifest.json')
    if args.missiles:
        # Normalize this producer's world frames into the shared draw contract.
        # Keep per-parent identity on every geometry for publication validation.
        normalized=[]
        for case in data['cases']:
            normalized.append({'effectId':case['effectId'],'sourceDefinitionSha256':effects['definitions'][case['effectId']]['sha256'],
                'startTime':case['startTime'],'frames':[{'tick':f['index']+1,'time':f['time'],
                    'age':float(np.float32(f['time']-case['startTime'])),
                    'geometry':[{**g,'sequence':p['sequence']} for p in f['parents'] for g in p['geometry']]} for f in case['frames']]})
        data={**data,'cases':normalized}
    renderer=adapter.Draw(args.angle)
    if renderer.info!=gpu_reference['context']:raise ValueError('Parent diagnostic GPU context differs from material reference')
    for name,digest in gpu_reference['libraries'].items():
        if adapter.sha(raw(args.angle/name))!=digest:raise ValueError('Parent GPU library changed')
    programs={};textures={};panels=[];draws=[];real_clear=renderer.gl.glClear
    try:
        for case_index,case in enumerate(data['cases']):
            frame=min(case['frames'],key=lambda f:abs(f['age']-.1)) if args.missiles else case['frames'][5]
            geometries=frame['geometry'];coordinates=[]
            for g in geometries:
                b=bytes.fromhex(g['verticesHex'])
                coordinates.extend(struct.unpack_from('<3f',b,i) for i in range(0,len(b),28))
            if not coordinates:raise ValueError('Parent selected visual frame has no geometry')
            points=np.asarray(coordinates);lo=points.min(0);hi=points.max(0);center=(lo+hi)/2
            extent=max(hi[0]-lo[0],hi[2]-lo[2])*.6
            if not np.isfinite(extent) or extent<=0:raise ValueError('Parent geometry has no finite top-view extent')
            projection=[1/extent,0,0,-center[0]/extent,0,0,1/extent,-center[2]/extent,0,0,0,.5,0,0,0,1]
            renderer.gl.glClearColor(.025,.035,.055,1);real_clear(0x4000)
            # This existing draw helper clears each standalone sample. A
            # composite pass clears once, then retains earlier layer pixels.
            renderer.gl.glClear=lambda mask:None
            ordered=sorted(geometries,key=lambda g:bindings[(case['effectId'],g['emitterIndex'])]['suppliedSortPass'])
            active=0;rgba=None
            for geometry in ordered:
                if not geometry['indicesHex']:continue
                e=bindings[(case['effectId'],geometry['emitterIndex'])]
                if e['sourceDefinitionSha256']!=case['sourceDefinitionSha256']:raise ValueError('Parent geometry/material authored identity differs')
                key=tuple(e['shaders'][stage]['sha256'] for stage in ['vertex','pixel'])
                if key not in programs:
                    stages=[]
                    for stage in ['vertex','pixel']:
                        ref=e['shaders'][stage];b=raw(assets/'latest-shaders'/ref['file'])
                        if adapter.sha(b)!=ref['sha256']:raise ValueError('Parent diagnostic game shader changed')
                        stages.append(json.loads(b))
                    programs[key]=(renderer.program(*stages),stages)
                program,stages=programs[key];values={}
                for shader in stages:
                    for block in shader['sidecar']['blocks']:
                        prepared=next(b for b in e['blocks'] if b['glslName']==block['glslName']);b=bytes.fromhex(prepared['bytesHex'])
                        for member in block['members']:
                            if not member['used']:continue
                            if member['name']=='mProj':value=projection
                            elif member['name']=='vCamera':value=data['camera']['position']
                            else:
                                code={'float':'f','uint':'I','bool':'I','int':'i'}[member['scalar']]
                                value=list(struct.unpack_from('<'+code*(member['size']//4),b,member['offset']))
                            values[block['glslName']+'.'+member['name']]=value
                bound={}
                for shader in stages:
                    for texture in shader['sidecar']['textures']:
                        choices=[e['textures'][s['glslName']] for s in texture['samplers']]
                        if not choices or any(b!=choices[0] for b in choices):raise ValueError('Ambiguous parent diagnostic texture binding')
                        binding=choices[0];tk=json.dumps(binding,sort_keys=True)
                        if tk not in textures:
                            if binding['kind']=='prepared-texture':
                                path=assets/'latest-effects'/binding['file']
                                if adapter.sha(raw(path))!=binding['sha256']:raise ValueError('Parent game texture changed')
                                pixels=np.array(Image.open(path).convert('RGBA'));address=binding['sampler']['name']
                                filtering='nearest' if binding['sampler']['pixelated'] else 'linear'
                            elif binding['kind'] in ['supplied-white-lookup','supplied-transparent-remap']:
                                pixels=np.full((1,1,4),255 if binding['kind']=='supplied-white-lookup' else 0,dtype=np.uint8);address='clamp';filtering='nearest'
                            else:raise ValueError('Unprovided parent diagnostic texture')
                            textures[tk]=renderer.texture(pixels,address,filtering)
                        bound[texture['name']]=textures[tk]
                factors=e['nativeBlendFactors']
                if factors[0]!=factors[1] or factors[2]!=factors[3]:raise ValueError('Separate parent diagnostic blending requires another draw adapter')
                mapping={1:1,6:0x302,7:0x303}
                rgba,buffers=renderer.draw(program,stages,bytes.fromhex(geometry['verticesHex']),bytes.fromhex(geometry['indicesHex']),values,bound,
                    blend=(mapping[factors[0]],mapping[factors[2]]));active+=1
                draws.append({'effectId':case['effectId'],'caseIndex':case_index,'tick':frame['tick'],'emitterIndex':geometry['emitterIndex'],
                    **({'sequence':geometry['sequence']} if args.missiles else {}),
                    'verticesSha256':adapter.sha(bytes.fromhex(geometry['verticesHex'])),
                    'indicesSha256':adapter.sha(bytes.fromhex(geometry['indicesHex'])),'uniformBuffers':buffers,
                    'rgbaSha256':adapter.sha(rgba.tobytes()),'materialShaderHashes':list(key)})
            renderer.gl.glClear=real_clear
            if rgba is None:raise ValueError('Parent diagnostic produced no draw')
            name=read(assets/'latest-effects'/effects['definitions'][case['effectId']]['file'])['definition']['particleName']
            linear=rgba[:,:,:3].astype(np.float64)/255
            display=np.clip(np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055),0,1)
            age=float(np.float32(frame['time']-case['ownership']['initialTime'])) if args.placement else frame['age']
            panels.append({'effectId':case['effectId'],'name':name,'age':age,'activeLayers':active,
                **({'replayTime':frame['time'],'parents':15} if args.missiles else {}),
                'parentEmitters':len(geometries),'display':display,'projection':projection,'rgbaSha256':adapter.sha(rgba.tobytes())})
    finally:
        renderer.gl.glClear=real_clear
        for program,_ in programs.values():renderer.gl.glDeleteProgram(program)
        renderer.close()
    fig,axes=plt.subplots(1,2,figsize=(14,8),facecolor='#101822') if args.missiles else plt.subplots(2,5,figsize=(18,9),facecolor='#101822')
    for ax,panel in zip(axes.flat,panels):
        ax.imshow(panel['display']);ax.axis('off')
        label=panel['name'] if len(panel['name'])<=34 else panel['name'][:31]+'…'
        caption=f'{panel["replayTime"]:.3f}s · {panel["parents"]} simultaneous parents · {panel["activeLayers"]} draws\n{label}' if args.missiles else f'{panel["effectId"].split("/")[1].title()} · {panel["activeLayers"]}/{panel["parentEmitters"]} active layers\n{label}'
        ax.set_title(caption,color='#e9eef7',fontsize=10)
    title='Decoded replay missile trajectories → simultaneous original particle parents' if args.missiles else 'Moving native effect parents → original object setters → complete particle geometry' if args.placement else 'Complete native effect parents → scheduled pools → original vertex writers'
    subtitle='Two 15-missile bursts · native/WASM geometry compared · translated game shaders' if args.missiles else 'Ten roots · supplied moving/rotating world inputs · geometry compared with live WASM workers' if args.placement else 'Ten champion roots · +0.10 seconds · translated game shaders and prepared texture/material inputs'
    fig.suptitle(title,color='#e9eef7',fontsize=18,y=.98)
    fig.text(.5,.925,subtitle,ha='center',color='#a9bacf',fontsize=11)
    fig.text(.5,.055,'Offscreen diagnostic: supplied seed, clocks, scene inputs, pass order and fitted top-view cameras.',ha='center',color='#d8bd8b',fontsize=10)
    disclaimer='Preview policy supplies activation, stop, zero seeds, job order and flight basis; scene/pass/camera inputs remain diagnostic.' if args.missiles else 'Native reference geometry drawn here; supplied scene/pass inputs; replay attachment mapping and browser acceptance remain open.' if args.placement else 'No League playback, match-lifecycle reconstruction, full scene resources, WASM or browser acceptance is implied.'
    fig.text(.5,.025,disclaimer,ha='center',color='#d8bd8b',fontsize=10)
    fig.subplots_adjust(top=.86,bottom=.11,left=.025,right=.985,hspace=.3,wspace=.09)
    output=assets/'evidence'/('latest-parent-missiles.png' if args.missiles else 'latest-parent-placement.png' if args.placement else 'latest-parent-frames.png');fig.savefig(output,dpi=110,facecolor=fig.get_facecolor());plt.close(fig)
    result={'schema':1,'kind':'simultaneous-replay-parent-shader-diagnostic' if args.missiles else 'moving-native-parent-shader-diagnostic' if args.placement else 'complete-native-parent-shader-diagnostic','build':data['build'],
        'observationSha256':inputs[str(observation_path)],'inspectionSha256':inputs[str(proof_path)],'inputs':inputs,
        'rendererSha256':adapter.sha(Path(__file__).read_bytes()),'imageSha256':adapter.sha(output.read_bytes()),
        'context':renderer.info,'draws':draws,'panels':[{k:v for k,v in p.items() if k!='display'} for p in panels],
        'counts':{'panels':len(panels),'draws':len(draws),'programs':len(programs)},
        'scope':{'completeParentNativeGeometry':True,'translatedGameShaders':True,'preparedMaterialInputs':True,
            'sceneInputsAndPassOrderSupplied':True,'fittedCamera':True,'sRgbDisplayEncoding':True,
            'fullNativeMaterialFrameBindings':False,'matchReplayFrame':False,'wasmExecuted':False,'wasmGeometryCompared':args.placement or args.missiles,'worldInputsSupplied':args.placement,'decodedMissileTrajectories':args.missiles,'browserExecuted':False,'referenceCompared':False}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':result['imageSha256'],'counts':result['counts']}))


if __name__=='__main__':main()

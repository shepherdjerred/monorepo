"""Draw native particle color/erosion samples through translated skin shaders.

The character pose is held at the declared preview pose. Scene/camera/resource
settings, frame times and RNG are controlled inputs, not recovered match values.
"""
import argparse,ctypes as C,importlib.util,json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
from attached_material_native import NativeAttachedMaterial
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('mesh_draw',Path(__file__).with_name('render-attached-materials.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();assets=cache/'public';decoder=assets/'decoder-16.21-macos';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    def read(path):return json.loads(raw(path))
    pools=read(cache/'research/attached-particles-native.json');comparison=read(cache/'research/attached-particles-comparison.json');pool_meta=read(assets/'latest-attached-particles/package.json')
    if comparison['nativeSha256']!=inputs[str((cache/'research/attached-particles-native.json').resolve())]or comparison['counts']['previewDifferences']or comparison['counts']['frames']!=2992:raise ValueError('Attached pool comparison differs')
    geometry=read(cache/'research/attached-material-geometry.json');materials=read(cache/'research/attached-materials-native.json');effects=read(assets/'latest-effects/manifest.json');pairs=read(cache/'research/latest-shaders/pairs.json')
    for path,h in geometry['inputs'].items():
        if sha(raw(Path(path)))!=h:raise ValueError('Supplied pose geometry changed')
    resources=read(assets/'latest-attached-resources/package.json');renderer=module.MeshDraw(a.angle);native=NativeAttachedMaterial(decoder,a.client)
    white=renderer.texture(np.full((1,1,4),255,dtype=np.uint8),'clamp','nearest');transparent=renderer.texture(np.zeros((1,1,4),dtype=np.uint8),'clamp','nearest');uints=renderer.uint_texture()
    times=[.1,1,2,3,4,5];rows=[];samples=[];programs=[]
    try:
        for index in [15,16]:
            entry=next(e for e in materials['emitters']if e['effectId']=='champions/viego/43/4f77a64e'and e['emitterIndex']==index)
            if resources['entries'][entry['key']]['status']!='no-authored-mesh-resource':raise ValueError('Unresolved initial mesh resource')
            case=next(c for c in pools['cases']if c['effectId']==entry['effectId']and c['emitterIndex']==index and c['mode']==0)
            env={'pass':0,'featuresEnabled':True,'resourceMask':0,'systemFogMode':0,'graphics34b':False,'graphics29c':0,'resolvedResourceFlag95':None}
            probe=next(p for p in entry['probes']if p['input']==env);defs=sorted(probe['renderState']['defines'],key=lambda d:d['name'])
            pair=next(p for p in pairs['programs']if p['family']=='attachedMesh'and p['defines']==defs)
            stages=[read(assets/'latest-shaders'/pair[k]['file'])for k in ['vertex','pixel']]
            for k in ['vertex','pixel']:
                if inputs[str((assets/'latest-shaders'/pair[k]['file']).resolve())]!=pair[k]['sha256']:raise ValueError('Sequence shader changed')
            program=renderer.program(*stages);programs.append(program)
            doc=read(assets/'latest-effects'/effects['definitions'][entry['effectId']]['file']);emitter=doc['definition']['complexEmitterDefinitionData'][index]
            mask=next(l['mask']for l in geometry['example']['layers']if l['emitterIndex']==index);parts=[p for p in geometry['parts']if p['mask']&mask]
            textures={'ParticleMeshInstanceInfo_SharedDataBuffer':uints,'PIXEL_COLOR_REMAP_RAMP_SharedTexture':transparent,'FOW_MAP_SharedTexture':white}
            for name,path,layer in [('TEXTURE__TX',emitter['texture'],'base'),('sAlphaErosionTexture__TX',emitter['alphaErosionDefinition']['erosionMapName'],'erosion')]:
                asset=effects['assets'][path.lower()];b=raw(assets/'latest-effects'/asset['file'])
                if sha(b)!=asset['sha256']or asset['status']!='prepared':raise ValueError('Unprepared sequence texture')
                descriptor=bytes.fromhex(next(s['descriptorHex']for s in entry['samplers']if s['layer']==layer))
                if descriptor[:3]!=bytes([descriptor[0]])*3 or descriptor[3]!=descriptor[4]:raise ValueError('Unsupported sequence sampler')
                textures[name]=renderer.texture(np.array(Image.open(assets/'latest-effects'/asset['file']).convert('RGBA')),{0:'repeat',1:'clamp',2:'mirror'}[descriptor[0]],{0:'nearest',1:'linear'}[descriptor[3]])
            graph=read(decoder/entry['graphFile']);native.prepare_attached(graph)
            state=bytes.fromhex(probe['renderState']['bytesHex']);factors={0:0,1:1,6:0x0302,7:0x0303}
            if state[10]!=state[11]or state[12]!=state[13]or state[14]or not state[4]&4:raise ValueError('Unsupported sequence blend state')
            row=[]
            for time in times:
                frame=next(f for f in case['frames']if f['input']['time']==time);draws=frame['drawValues']
                if len(draws)>1:raise ValueError('This sequence diagnostic requires a single attached particle per layer')
                values={'PerFrameVertexCB_vs.mProj':geometry['projectionRows'],'PerFrameVertexCB_vs.vCamera':geometry['cameraPosition'],
                    'PerFrameVertexCB_vs.mCameraForward':geometry['cameraForward'],'PerFrameVertexCB_vs.mCameraUp':geometry['cameraUp'],
                    'PerFrameVertexCB_vs.FOG_OF_WAR_PARAMS':[0,0,0,0],'Globals_vs.vFresnel':[0,0,0,1],
                    'Globals_vs.vParticleUVTransform':[1,0,0,0,0,1,0,0,0,0,1,0],
                    'CharacterPerDrawVertexCB_vs.mWorld':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
                    'VFXDynamicPerParticleInstanceCBVS_vs.USE_INSTANCE_DRAW':[0],'VFXDynamicPerParticleInstanceCBVS_vs.INSTANCE_OFFSET':[0],
                    'VFXDynamicPerParticleInstanceCBVS_vs.INSTANCE_FACING_DATA':[0],'VFXDynamicPerParticleInstanceCBPS_ps.USE_INSTANCE_DRAW':[0],
                    'Globals_ps.DEBUG_RENDERTARGET_IS_SRGB_HANDLED':[0],'PerFramePixelCB_ps.RENDERTARGET_IS_SRGB':[0],'PerFramePixelCB_ps.FOW_EDGE_CONTROL':[0,0,0,0]}
                if draws:
                    draw=draws[0];erosion=native.erosion_parameters(draw['erosionDrive']);params={p['name']:p['value']for p in entry['parameters']+erosion+probe['renderState']['uniforms']}
                    values['Globals_vs.kColorFactor']=draw['colorFactor']['value']
                    for stage in stages:
                        for block in stage['sidecar']['blocks']:
                            if block['name']=='ParticleMeshInstanceInfo_SharedDataBuffer':continue
                            for m in block['members']:
                                key=block['glslName']+'.'+m['name']
                                if m['used']and key not in values and m['name']in params:values[key]=params[m['name']][:m['size']//4]
                    rgba,blocks=renderer.mesh(program,stages,parts,values,textures,(factors[state[10]],factors[state[12]]))
                else:
                    renderer.gl.glClearColor(.025,.035,.055,1);renderer.gl.glClear(0x4000);out=(C.c_ubyte*(512*512*4))();renderer.gl.glReadPixels(0,0,512,512,0x1908,0x1401,out)
                    rgba=np.frombuffer(out,dtype=np.uint8).reshape(512,512,4)[::-1].copy();blocks=[];erosion=[]
                linear=rgba[:,:,:3].astype(np.float64)/255;display=np.clip(np.where(linear<=.0031308,linear*12.92,1.055*np.power(linear,1/2.4)-.055),0,1);row.append(display)
                samples.append({'emitterIndex':index,'time':time,'liveParticles':len(draws),'nativeDrawValues':draws,'nativeErosionParameters':erosion,'rgbaSha256':sha(rgba.tobytes()),'uniformBuffers':blocks,'values':values})
            native.finish();rows.append(row)
    finally:
        for program in programs:renderer.gl.glDeleteProgram(program)
        renderer.close()
    plt.rcParams.update({'text.color':'#e8edf6','figure.facecolor':'#0e1828'})
    fig,axes=plt.subplots(2,6,figsize=(24,11));fig.subplots_adjust(top=.78,bottom=.24,left=.025,right=.985,wspace=.04,hspace=.13)
    fig.text(.03,.95,'Native particle color, erosion and lifetime',fontsize=27,weight='bold')
    fig.text(.03,.895,'Viego skin 43 death layers through translated game shaders · fixed supplied character pose',fontsize=17,color='#b3c6e2')
    for y,row in enumerate(rows):
        for x,(time,display)in enumerate(zip(times,row)):
            axes[y,x].imshow(display);axes[y,x].axis('off');axes[y,x].set_title(f'{"Body"if y==0 else "Hair"} · particle t={time:g}s',fontsize=12,color='#e8edf6')
    fig.text(.03,.18,'Color and erosion inputs come from complete native emitter updates; native per-draw color and erosion math are retained.',fontsize=14)
    fig.text(.03,.135,'Native/WASM pool comparisons: 2,992 frames across 179 prepared emitters, with checkpoint/reset comparisons.',fontsize=13,color='#b3c6e2')
    fig.text(.03,.09,'Supplied seed/frame clock, absent owner, unit scene inputs and fixed pose. Effect activation, owner pose and draw scheduling remain open.',fontsize=12,color='#c5b58f')
    fig.text(.03,.045,'Offscreen ANGLE/D3D11 WARP; depth/culling and League reference pixels unverified. Not integrated into main playback.',fontsize=12,color='#c5b58f')
    dest=assets/'evidence/latest-attached-particle-sequence.png';fig.savefig(dest,dpi=100,facecolor=fig.get_facecolor())
    proof={'schema':1,'kind':'native-attached-particle-sequence-diagnostic','inputs':inputs,'rendererSha256':sha(Path(__file__).read_bytes()),
        'meshDrawAdapterSha256':sha(Path(__file__).with_name('render-attached-materials.py').read_bytes()),'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['attached_material_native.py','vfx_material_native.py','render-particle-shader.py','observe-shader-angle.py']},
        'imageSha256':sha(dest.read_bytes()),'samples':samples,'materialOriginalBlocks':sorted(native.material_blocks.values(),key=lambda b:b['rva']),
        'scope':{'nativePoolSamples':True,'nativeDrawInputCompositionCompared':True,'nativeDynamicErosionParametersExecuted':True,'translatedShaderRenderedOffscreen':True,
            'suppliedFixedCharacterPose':True,'suppliedSceneClockSeedAndAbsentOwner':True,'originalFrameCadenceVerified':False,'recordedSeedRecovered':False,
            'ownerPoseBindingExecuted':False,'effectActivationReconstructed':False,'drawSchedulingReconstructed':False,'browserRun':False,'mainViewerIntegrated':False,'referencePixelsCompared':False}}
    dest.with_suffix('.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps({'imageSha256':proof['imageSha256'],'samples':len(samples)}))


if __name__=='__main__':main()

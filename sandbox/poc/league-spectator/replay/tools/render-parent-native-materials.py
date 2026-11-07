"""Draw captured native material passes with original ray/quad/trail geometry.

Controlled component snapshots, not replay playback. Every root is attempted;
missing scene resources stop the entire root. Explicit fixture inputs provide a
fully visible fog mask, no color remap, a fitted camera and linear render target.
Native authored pipeline and sampler state are applied at the draw instruction.
"""
import argparse
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import struct
import traceback
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from graphics_material_bindings import GraphicsMaterialBindings
from graphics_pipeline_device import GraphicsPipelineDevice
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('particle_draw',Path(__file__).with_name('render-particle-shader.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path);p.add_argument('angle',type=Path)
    p.add_argument('--draw-fixture',action='store_true',help='Use WASM geometry and original per-draw parameter bytes')
    args=p.parse_args();cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    def read(path):return json.loads(raw(path))
    package_path=assets/'latest-parent-native-materials/package.json';package=read(package_path)
    proof_path=cache/'research/parent-native-materials-comparison.json';proof=read(proof_path)
    geometry_path=cache/('research/parent-draw-gallery.json' if args.draw_fixture else 'research/ray-parent-frames-native.json');geometry=read(geometry_path)
    geometry_proof=geometry if args.draw_fixture else read(cache/'research/ray-parent-frames-comparison.json')
    if (proof['mismatchCount'] or proof['packageSha256']!=sha(package_path.read_bytes()) or
            (not args.draw_fixture and (geometry_proof['mismatchCount'] or geometry_proof['observationSha256']!=sha(geometry_path.read_bytes()) or
            geometry['counts']['roots']!=geometry['counts']['returningRoots'])) or
            (args.draw_fixture and (geometry['kind']!='wasm-original-parent-draw-gallery-fixture' or
                geometry['counts']['roots']!=14 or not geometry['scope']['originalDrawPrefixExecuted'] or geometry['scope']['replayPlayback']))):
        raise ValueError('Complete native material and frame comparisons required')
    for report in [proof,geometry_proof]:
        for name,digest in report['sources'].items():
            if sha(raw(Path(__file__).parent.parent/name))!=digest:raise ValueError('Snapshot proof producer changed: '+name)
        for path,digest in report['inputs'].items():
            if sha(raw(Path(path)))!=digest:raise ValueError('Snapshot proof input changed')
    image=raw(assets/'decoder-16.21-macos/image.bin')
    if sha(image)!=package['decoderImageSha256']:raise ValueError('Snapshot decoder image differs')
    renderer=adapter.Draw(args.angle)
    pipelines=GraphicsPipelineDevice(renderer,image)
    samplers=GraphicsMaterialBindings(renderer,None)
    gl=renderer.gl
    messages=[]
    debug_type=C.WINFUNCTYPE(None,C.c_uint,C.c_uint,C.c_uint,C.c_uint,C.c_int,C.c_void_p,C.c_void_p)
    debug_callback=debug_type(lambda source,kind,identity,severity,length,message,user:messages.append(C.string_at(message,length).decode('utf-8')))
    debug_address=renderer.egl.eglGetProcAddress(b'glDebugMessageCallbackKHR')
    if not debug_address:raise ValueError('ANGLE debug callback unavailable for draw validation')
    C.WINFUNCTYPE(None,debug_type,C.c_void_p)(debug_address)(debug_callback,None)
    gl.glEnable(0x92e0);gl.glEnable(0x8242)
    for name,result,types in [('glGenRenderbuffers',None,[C.c_int,C.POINTER(C.c_uint)]),
            ('glGetIntegeri_v',None,[C.c_uint,C.c_uint,C.POINTER(C.c_int)]),
            ('glMapBufferRange',C.c_void_p,[C.c_uint,C.c_ssize_t,C.c_ssize_t,C.c_uint]),
            ('glUnmapBuffer',C.c_ubyte,[C.c_uint]),
            ('glBindRenderbuffer',None,[C.c_uint,C.c_uint]),
            ('glRenderbufferStorage',None,[C.c_uint,C.c_uint,C.c_int,C.c_int]),
            ('glFramebufferRenderbuffer',None,[C.c_uint,C.c_uint,C.c_uint,C.c_uint]),
            ('glDeleteRenderbuffers',None,[C.c_int,C.POINTER(C.c_uint)]),
            ('glClearDepthf',None,[C.c_float]),('glClearStencil',None,[C.c_int]),
            ('glStencilMask',None,[C.c_uint])]:renderer.fn(gl,name,result,*types)
    depth=C.c_uint();gl.glGenRenderbuffers(1,C.byref(depth));gl.glBindRenderbuffer(0x8d41,depth)
    gl.glRenderbufferStorage(0x8d41,0x88f0,512,512)
    gl.glFramebufferRenderbuffer(0x8d40,0x821a,0x8d41,depth)
    if gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5 or gl.glGetError():
        raise ValueError('Native snapshot depth/stencil framebuffer is incomplete')
    # Supplied scene fixture: all samples see white fog visibility and the
    # remap contributes transparent black. These are not recovered match data.
    scene_pixels={'FOW_MAP_SharedTexture':bytes([255]*4),'PIXEL_COLOR_REMAP_RAMP_SharedTexture':bytes(4)}
    scene_handles={k:renderer.texture(np.frombuffer(v,dtype=np.uint8).reshape(1,1,4),'clamp','nearest') for k,v in scene_pixels.items()}
    scene_sampler=samplers.sampler(bytes([1,1,1,0,0,0,0,0,0,0,0,1,0,0,0,0]))
    textures={};sampler_handles={};programs={};pipeline_records={};draws=[];panels=[]
    actual_draw=gl.glDrawElements;actual_clear=gl.glClear;active=None
    def submit(mode,count,kind,pointer):
        if active is None:raise ValueError('Unscoped native material snapshot draw')
        program,variant=active['program'],active['variant']
        key=(program,variant['pipeline']['descriptorHex'])
        if key not in pipeline_records:
            pipeline_records[key]=pipelines.create(bytes.fromhex(variant['pipeline']['descriptorHex']),
                {'linked':True,'glHandle':program})
        record=pipeline_records[key]
        if record['state']!=variant['pipeline']['state']:
            raise ValueError('Snapshot pipeline differs from original native state')
        pipelines.apply(record,stencil_reference=0,blend_color=[0,0,0,0])
        verified=pipelines.inspect(record,stencil_reference=0,blend_color=[0,0,0,0])
        for t in variant['textures']:
            descriptor=t['sampler']['descriptorHex']
            if descriptor not in sampler_handles:sampler_handles[descriptor]=samplers.sampler(bytes.fromhex(descriptor))
            sampler=sampler_handles[descriptor]
            if sampler['parameters']!={int(k):v for k,v in t['sampler']['parameters'].items()}:
                raise ValueError('Snapshot native sampler state differs')
            gl.glActiveTexture(0x84c0+t['unit']);gl.glBindTexture(0x0de1,textures[t['texture']])
            gl.glBindSampler(t['unit'],sampler['glHandle'])
            at=gl.glGetUniformLocation(program,t['glslName'].encode())
            if at<0:raise ValueError('Native snapshot texture sampler is absent')
            gl.glUniform1i(at,t['unit'])
        for t in variant['requiredScene']['textures']:
            gl.glActiveTexture(0x84c0+t['unit']);gl.glBindTexture(0x0de1,scene_handles[t['name']])
            gl.glBindSampler(t['unit'],scene_sampler['glHandle'])
            at=gl.glGetUniformLocation(program,t['glslName'].encode())
            if at<0:raise ValueError('Snapshot scene sampler is absent')
            gl.glUniform1i(at,t['unit'])
        active['queriedPipeline']=verified
        active['uniformReadbacks']=[]
        if gl.glGetError():raise ValueError('GPU state error before frame uniform readback')
        # Read mapping is an intrusive driver operation. Observe the resources
        # immediately after their draw, with no intervening mutation/rebinding.
        actual_draw(mode,count,kind,pointer)
        if gl.glGetError():raise ValueError('GPU draw failed: '+'; '.join(messages[-3:]))
        for block in active.get('uniformBlocks',[]):
            expected=bytes.fromhex(block['bytesHex']);handle=C.c_int()
            gl.glGetIntegeri_v(0x8a28,block['binding'],C.byref(handle))
            if gl.glGetError():raise ValueError('GPU indexed uniform binding query failed')
            if handle.value<=0:raise ValueError('Original frame uniform buffer is not bound at draw')
            gl.glBindBuffer(0x8a11,handle.value);pointer=gl.glMapBufferRange(0x8a11,0,len(expected),1)
            if not pointer:raise ValueError('Original frame uniform GPU readback unavailable')
            actual=C.string_at(pointer,len(expected));unmapped=gl.glUnmapBuffer(0x8a11)
            if not unmapped or actual!=expected:raise ValueError('Original frame uniform GPU bytes differ')
            if gl.glGetError():raise ValueError('GPU uniform mapping/unmapping failed')
            active['uniformReadbacks'].append({'name':block['name'],'binding':block['binding'],
                'bytes':len(actual),'sha256':sha(actual),'phase':'immediately-after-draw'})
    gl.glDrawElements=submit
    try:
        for c in geometry['cases']:
            effect_id=c['effectId'];root=package['roots'][effect_id]
            panel={'effectId':effect_id,'status':'boundary'}
            try:
                if args.draw_fixture and c['status']!='prepared-original-draw-frame':raise ValueError(c['error'])
                # Admission covers every actor before submitting any part.
                if set(root['actors'])!={str(a['emitterIndex']) for a in c['ownership']['actors']}:
                    raise ValueError('Snapshot root material/geometry actor sets differ')
                for actor in root['actors'].values():
                    for row in actor['rows']:
                        if len(row['variants'])!=1:raise ValueError('Snapshot requires an explicit nonzero material variant policy')
                        v=row['variants'][0]
                        for t in v['requiredScene']['textures']:
                            if t['name'] not in scene_handles:raise ValueError('Unprovided scene texture: '+t['name'])
                        if v['requiredScene']['dataBuffers']:raise ValueError('Unprovided scene data buffer')
                        for block in v['requiredScene']['blocks']:
                            for m in block['requiredMembers']:
                                if m['name'] not in ['mProj','vCamera','FOG_OF_WAR_PARAMS','RENDERTARGET_IS_SRGB']:
                                    raise ValueError('Unprovided scene uniform: '+m['name'])
                frame=max(c['frames'],key=lambda f:sum(len(g['indicesHex']) for g in f['geometry']))
                points=[adapter.positions(bytes.fromhex(g['verticesHex'])) for g in frame['geometry'] if g['verticesHex']]
                if not points:raise ValueError('No original particle geometry in supplied sample window')
                points=np.concatenate(points);lo,hi=points.min(axis=0),points.max(axis=0);center=(lo+hi)/2
                scale=max(float(hi[0]-lo[0]),float(hi[2]-lo[2]),1)*.6
                zscale=max(float(hi[1]-lo[1]),1)*2
                projection=c['projectionRows'] if args.draw_fixture else [1/scale,0,0,-float(center[0])/scale,
                    0,0,-1/scale,float(center[2])/scale,
                    0,-1/zscale,0,.5+float(center[1])/zscale,0,0,0,1]
                scene_values={'mProj':projection,'vCamera':geometry['camera']['position'],
                    'FOG_OF_WAR_PARAMS':[0,0,.5,.5],'RENDERTARGET_IS_SRGB':[0]}
                gl.glDepthMask(1);gl.glStencilMask(0xffffffff);gl.glClearDepthf(1);gl.glClearStencil(0)
                gl.glClearColor(.025,.035,.055,1);actual_clear(0x4000|0x100|0x400)
                gl.glClear=lambda mask:None
                commands=[]
                for g in frame['geometry']:
                    for row in root['actors'][str(g['emitterIndex'])]['rows']:
                        code=next(p['code'] for p in package['registeredPasses'] if p['hash']==row['hash'])
                        commands.append((code,g['emitterIndex'],row,g))
                for _,_,row,g in sorted(commands,key=lambda v:(v[0],v[1])):
                    v=row['variants'][0];key=tuple(v['shaders'][s]['sha256'] for s in ['vertex','pixel'])
                    if key not in programs:
                        stages=[]
                        for stage in ['vertex','pixel']:
                            ref=v['shaders'][stage];source=assets/'latest-shaders'/ref['file'];b=raw(source)
                            if sha(b)!=ref['sha256']:raise ValueError('Snapshot translated shader changed')
                            stages.append(json.loads(b))
                        programs[key]=(renderer.program(*stages),stages)
                    program,stages=programs[key]
                    for t in v['textures']:
                        if t['texture'] in textures:continue
                        ref=package['textures'][t['texture']]
                        if (ref['kind'],ref['pixelFormat'],ref['mips'],ref['layers'])!=('2d','RGBA8',1,1):
                            raise ValueError('Snapshot texture needs another exact upload adapter')
                        plane=ref['levels'][0][0];pixels=raw(assets/'latest-parent-native-materials'/plane['file'])
                        if sha(pixels)!=plane['sha256']:raise ValueError('Native snapshot texture pixels changed')
                        textures[t['texture']]=renderer.texture(np.frombuffer(pixels,dtype=np.uint8).reshape(
                            ref['height'],ref['width'],4),'clamp','nearest')
                    values={};constants={b['name']:bytes.fromhex(b['bytesHex']) for b in v['constantBuffers']}
                    frame_blocks=frame['uniformBlocks'][str(g['emitterIndex'])] if args.draw_fixture else []
                    if args.draw_fixture:constants={b['name']:bytes.fromhex(b['bytesHex']) for b in frame_blocks}
                    for shader in stages:
                        for block in shader['sidecar']['blocks']:
                            for m in block['members']:
                                if not m['used']:continue
                                if block['glslName'] in constants:
                                    code={'float':'f','uint':'I','int':'i','bool':'I'}[m['scalar']]
                                    value=list(struct.unpack_from('<'+code*(m['size']//4),constants[block['glslName']],m['offset']))
                                else:value=scene_values[m['name']]
                                values[block['glslName']+'.'+m['name']]=value
                    bound={t['name']:textures[t['texture']] for t in v['textures']}
                    bound.update(scene_handles)
                    active={'program':program,'variant':v,'uniformBlocks':frame_blocks}
                    rgba,cb=renderer.draw(program,stages,bytes.fromhex(g['verticesHex']),bytes.fromhex(g['indicesHex']),values,bound)
                    draws.append({'effectId':effect_id,'emitterIndex':g['emitterIndex'],'kind':g['kind'],
                        'time':frame['time'],'pass':row['name'],'variant':0,'uniformBuffers':cb,
                        'verticesSha256':sha(bytes.fromhex(g['verticesHex'])),'indicesSha256':sha(bytes.fromhex(g['indicesHex'])),
                        'nativePipelineQueried':active['queriedPipeline'],'frameUniformGpuReadbacks':active['uniformReadbacks']})
                gl.glClear=actual_clear;active=None
                panel.update(status='drawn',time=frame['time'],draws=len(commands),
                    changedPixels=int(np.any(rgba[:,:,:3]!=np.array([6,9,14]),axis=2).sum()),
                    projectionRows=projection,pixelsSha256=sha(rgba.tobytes()),display=rgba)
            except Exception as error:
                gl.glClear=actual_clear;active=None
                panel.update(error=str(error),traceback=traceback.format_exc())
            panels.append(panel)
            print(json.dumps({k:v for k,v in panel.items() if k in ['effectId','status','error','draws','changedPixels']}),flush=True)
    finally:
        gl.glDrawElements=actual_draw;gl.glClear=actual_clear
        for program,_ in programs.values():gl.glDeleteProgram(program)
        samplers.close();gl.glDeleteRenderbuffers(1,C.byref(depth));renderer.close()
    fig,axes=plt.subplots(4,4,figsize=(16,17),facecolor='#101923')
    for ax in axes.flat:ax.set_facecolor('#202c3a');ax.set_xticks([]);ax.set_yticks([])
    for ax,panel in zip(axes.flat,panels):
        if panel['status']=='drawn':
            linear=panel['display'][:,:,:3]/255
            display=np.clip(np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055),0,1)
            ax.imshow(display)
            if not panel['changedPixels']:
                ax.text(.5,.5,'Draws submitted; no visible pixels\nat the sampled time',transform=ax.transAxes,
                    ha='center',va='center',color='#b5c6d7',fontsize=10)
        else:ax.text(.5,.5,panel['error'].replace(': ',':\n'),ha='center',va='center',color='#edc98e',wrap=True)
        _,champion,skin,identity=panel['effectId'].split('/')
        ax.set_title(f'{champion} / {identity}',color='#e0e8f3',fontsize=10)
    for ax in list(axes.flat)[len(panels):]:ax.axis('off')
    fig.suptitle('Original draw updates + ray / trail geometry' if args.draw_fixture else 'Original ray / trail geometry + native material passes',color='white',fontsize=20,y=.985)
    fig.text(.5,.957,'Controlled component snapshots: actual shader, texture, constant, pipeline and sampler resources',ha='center',color='#b5c6d7',fontsize=11)
    fig.text(.5,.025,'Explicit visible fog, no color remap, fitted camera and supplied pass order. Missing scene inputs remain explicit.',ha='center',color='#edc98e',fontsize=10)
    fig.text(.5,.011,'Not replay playback or League reference footage. Actual visibility and complete material application remain unresolved.' if args.draw_fixture else 'Not replay playback or League reference footage. Per-frame material updates and actual visibility remain unresolved.',ha='center',color='#edc98e',fontsize=10)
    fig.subplots_adjust(top=.935,bottom=.055,hspace=.16,wspace=.08)
    path=assets/('evidence/latest-parent-draw-parameters.png' if args.draw_fixture else 'evidence/latest-parent-native-materials.png');fig.savefig(path,dpi=100,facecolor=fig.get_facecolor());plt.close(fig)
    result={'schema':1,'kind':'original-parent-draw-parameter-offscreen-snapshots' if args.draw_fixture else 'native-parent-material-offscreen-snapshots','inputs':inputs,
        'sources':{p.name:sha(p.read_bytes()) for p in [Path(__file__),Path(adapter.__file__),
            Path(inspect.getfile(GraphicsMaterialBindings)),Path(inspect.getfile(GraphicsPipelineDevice))]},
        'imageSha256':sha(path.read_bytes()),
        'counts':{'requestedRoots':len(panels),'drawnRoots':sum(p['status']=='drawn' for p in panels),
            'boundaryRoots':sum(p['status']=='boundary' for p in panels),
            'visibleRoots':sum(p.get('changedPixels',0)>0 for p in panels),
            'zeroPixelRoots':sum(p['status']=='drawn' and not p.get('changedPixels',0) for p in panels),
            'draws':len(draws),'programs':len(programs),'frameUniformGpuReadbacks':sum(len(d['frameUniformGpuReadbacks']) for d in draws)},
        'panels':[{k:v for k,v in p.items() if k!='display'} for p in panels],'draws':draws,
        'sceneFixture':{'fog':'white RGBA8 1x1','colorRemap':'transparent RGBA8 1x1','sampler':'nearest clamp',
            'fogParams':[0,0,.5,.5],'renderTargetSrgb':0,'variant':0,'passOrder':'registered code, then original emitter index'},
        'scope':{'actualNativeParentGeometry':True,'actualCapturedMaterialResources':True,
            'gpuDrawSubmitted':True,'offscreenGlesDraw':True,
            'nativePipelineAndSamplerApplied':True,'depthStencilAttachmentProvided':True,'allRootsAttempted':True,
            'missingSceneInputsRejectWholeRoot':True,'controlledSceneFixture':True,
            'perFrameMaterialUpdatesPrepared':False,'replayPlacementReconstructed':False,
            'originalDrawPrefixParametersApplied':args.draw_fixture,'frameUniformGpuReadbackCompared':args.draw_fixture,
            'browserExecuted':False,'referenceCompared':False}}
    path.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(path),'counts':result['counts'],'sha256':result['imageSha256']}))


if __name__=='__main__':main()

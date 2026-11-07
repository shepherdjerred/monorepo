"""Offscreen translated skin-particle shaders over real mesh streams.

The pose palette, camera, white color factor, zero Fresnel, non-instanced draw,
fog inputs, and linear RGBA8 target are supplied diagnostic inputs. The initial
mesh-resource branch is derived from its separately verified native prefix.
This is not reconstructed effect timing or League playback.
"""
import argparse, ctypes as C, importlib.util, json, struct
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec=importlib.util.spec_from_file_location('draw',Path(__file__).with_name('render-particle-shader.py'))
draw=importlib.util.module_from_spec(spec);spec.loader.exec_module(draw)


class MeshDraw(draw.Draw):
    def __init__(self,directory):
        super().__init__(directory)
        self.fn(self.gl,'glVertexAttribIPointer',None,C.c_uint,C.c_int,C.c_uint,C.c_int,C.c_void_p)

    def uint_texture(self):
        h=C.c_uint();self.gl.glGenTextures(1,C.byref(h));self.gl.glBindTexture(0x0de1,h)
        b=C.create_string_buffer(bytes(208))
        self.gl.glTexImage2D(0x0de1,0,0x8236,52,1,0,0x8d94,0x1405,b)
        for k,v in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812f),(0x2803,0x812f)]:self.gl.glTexParameteri(0x0de1,k,v)
        self.textures.append(h);return h

    def mesh(self,program,stages,parts,values,textures,blend):
        self.gl.glUseProgram(program);binding=0;blocks=[];texture_index=0
        buffer_names={t['name'] for s in stages for t in s['sidecar']['textures']if t['dimension']=='buffer'}
        for stage in stages:
            for block in stage['sidecar']['blocks']:
                if block['name'] in buffer_names:continue # Hexshade buffer resource is a uint texture, not a UBO.
                data=bytearray(block['size'])
                for member in block['members']:
                    if not member['used']:continue
                    key=block['glslName']+'.'+member['name']
                    if key=='BonesCB_vs.BONES':value=parts[0]['palette']
                    elif key in values:value=values[key]
                    else:raise ValueError(f'Unprovided attached shader value: {key}')
                    if len(value)*4!=member['size']:raise ValueError(f'Attached uniform width differs: {key}')
                    code={'float':'f','uint':'I','int':'i','bool':'I'}[member['scalar']]
                    struct.pack_into('<'+code*len(value),data,member['offset'],*value)
                location=self.gl.glGetUniformBlockIndex(program,block['glslName'].encode())
                if location==0xffffffff:
                    # Reflected wholly unused blocks can be removed by the linker.
                    if any(m['used']for m in block['members']):raise ValueError('Used attached uniform block absent')
                    continue
                handle=self.buffer(0x8a11,bytes(data));self.gl.glUniformBlockBinding(program,location,binding);self.gl.glBindBufferBase(0x8a11,binding,handle);binding+=1
                blocks.append({'name':block['glslName'],'sha256':draw.sha(data),'bytes':len(data)})
            for texture in stage['sidecar']['textures']:
                if texture['name'] not in textures:raise ValueError(f'Unprovided attached texture: {texture["name"]}')
                samplers=texture['samplers'] if texture['dimension']=='texture2d' else [{'glslName':texture['name']}]
                if texture['dimension'] not in ['texture2d','buffer']:raise ValueError('Unimplemented attached texture dimension')
                for sampler in samplers:
                    location=self.gl.glGetUniformLocation(program,sampler['glslName'].encode())
                    if location<0:raise ValueError('Attached sampler absent')
                    self.gl.glActiveTexture(0x84c0+texture_index);self.gl.glBindTexture(0x0de1,textures[texture['name']]);self.gl.glUniform1i(location,texture_index);texture_index+=1
        self.gl.glViewport(0,0,512,512);self.gl.glDisable(0x0b44);self.gl.glDisable(0x0b71);self.gl.glEnable(0x0be2);self.gl.glBlendFunc(*blend)
        self.gl.glClearColor(.025,.035,.055,1);self.gl.glClear(0x4000)
        layouts={'POSITION':(3,0,False),'BLENDWEIGHT':(4,12,False),'NORMAL':(3,28,False),'BLENDINDICES':(4,40,True),'TEXCOORD':(2,56,False)}
        for part in parts:
            if part['palette']!=parts[0]['palette']:raise ValueError('Diagnostic parts require a shared palette')
            self.buffer(0x8892,bytes.fromhex(part['verticesHex']))
            for attribute in stages[0]['sidecar']['attributes']:
                if attribute['index'] or attribute['semantic'] not in layouts:raise ValueError('Unimplemented attached vertex semantic')
                size,offset,integer=layouts[attribute['semantic']];location=self.gl.glGetAttribLocation(program,attribute['glslName'].encode())
                if location<0:raise ValueError('Used attached attribute absent')
                self.gl.glEnableVertexAttribArray(location)
                if integer:self.gl.glVertexAttribIPointer(location,size,0x1405,64,C.c_void_p(offset))
                else:self.gl.glVertexAttribPointer(location,size,0x1406,0,64,C.c_void_p(offset))
            indices=bytes.fromhex(part['indicesHex']);self.buffer(0x8893,indices);self.gl.glDrawElements(4,len(indices)//4,0x1405,None)
        self.gl.glFinish();out=(C.c_ubyte*(512*512*4))();self.gl.glReadPixels(0,0,512,512,0x1908,0x1401,out)
        error=self.gl.glGetError()
        if error:raise ValueError(f'Attached offscreen GL error {error:04x}')
        return np.frombuffer(out,dtype=np.uint8).reshape(512,512,4)[::-1].copy(),blocks


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','angle']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=draw.sha(b);return b
    def read(path):return json.loads(raw(path))
    native=read(cache/'research/attached-materials-native.json');proof=read(cache/'research/attached-materials-comparison.json');geometry=read(cache/'research/attached-material-geometry.json')
    resources=read(assets/'latest-attached-resources/package.json');resource_proof=read(cache/'research/attached-resources-comparison.json')
    if resource_proof['packageSha256']!=inputs[str((assets/'latest-attached-resources/package.json').resolve())]or resource_proof['counts']['initialSelectionChecks']!=179:raise ValueError('Initial mesh-resource proof differs')
    if proof['nativeSha256']!=inputs[str((cache/'research/attached-materials-native.json').resolve())]or native['scope']['partialCorpus']:raise ValueError('Attached material proof stale')
    for path,h in geometry['inputs'].items():
        if draw.sha(raw(Path(path)))!=h:raise ValueError('Supplied geometry input changed')
    if draw.sha(raw(Path(__file__).with_name('export-attached-material-geometry.mjs')))!=geometry['exporterSha256']:raise ValueError('Geometry exporter changed')
    shaders=read(assets/'latest-shaders/package.json');pairs=read(cache/'research/latest-shaders/pairs.json');effects=read(assets/'latest-effects/manifest.json')
    if pairs['shaderPackageSha256']!=inputs[str((assets/'latest-shaders/package.json').resolve())]:raise ValueError('Shader pairs differ')
    renderer=MeshDraw(a.angle);programs=[];samples=[];panels=[]
    white=renderer.texture(np.full((1,1,4),255,dtype=np.uint8),'clamp','nearest');transparent=renderer.texture(np.zeros((1,1,4),dtype=np.uint8),'clamp','nearest');uints=renderer.uint_texture()
    try:
        for index in [15,16]:
            entry=next(e for e in native['emitters']if e['effectId']=='champions/viego/43/4f77a64e'and e['emitterIndex']==index)
            resource=resources['entries'][entry['key']]
            if resource['status']!='no-authored-mesh-resource' or resource['postloadGraphSha256']!=entry['graphSha256']:raise ValueError('Initial mesh resource requires an unresolved factory')
            probe=next(p for p in entry['probes']if p['input']=={'pass':0,'featuresEnabled':True,'resourceMask':0,'systemFogMode':0,'graphics34b':False,'graphics29c':0,'resolvedResourceFlag95':None})
            final_defs=sorted(probe['renderState']['defines'],key=lambda d:d['name'])
            ref=next(p for p in pairs['programs']if p['family']=='attachedMesh'and p['defines']==final_defs)
            stages=[read(assets/'latest-shaders'/ref[s]['file'])for s in ['vertex','pixel']]
            for s in ['vertex','pixel']:
                if inputs[str((assets/'latest-shaders'/ref[s]['file']).resolve())]!=ref[s]['sha256']:raise ValueError('Attached shader changed')
            program=renderer.program(*stages);programs.append(program)
            doc=read(assets/'latest-effects'/effects['definitions'][entry['effectId']]['file']);emitter=doc['definition']['complexEmitterDefinitionData'][index]
            mask=next(l['mask']for l in geometry['example']['layers']if l['emitterIndex']==index);parts=[p for p in geometry['parts']if p['mask']&mask]
            params={p['name']:p['value']for p in entry['parameters']+entry['erosionParameters']+probe['renderState']['uniforms']}
            values={'PerFrameVertexCB_vs.mProj':geometry['projectionRows'],'PerFrameVertexCB_vs.vCamera':geometry['cameraPosition'],
                'PerFrameVertexCB_vs.mCameraForward':geometry['cameraForward'],'PerFrameVertexCB_vs.mCameraUp':geometry['cameraUp'],
                'PerFrameVertexCB_vs.FOG_OF_WAR_PARAMS':[0,0,0,0],
                'Globals_vs.vFresnel':[0,0,0,1],'Globals_vs.vParticleUVTransform':[1,0,0,0,0,1,0,0,0,0,1,0],
                'Globals_vs.kColorFactor':[1,1,1,1],'CharacterPerDrawVertexCB_vs.mWorld':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
                'VFXDynamicPerParticleInstanceCBVS_vs.USE_INSTANCE_DRAW':[0],'VFXDynamicPerParticleInstanceCBVS_vs.INSTANCE_OFFSET':[0],
                'VFXDynamicPerParticleInstanceCBVS_vs.INSTANCE_FACING_DATA':[0],'VFXDynamicPerParticleInstanceCBPS_ps.USE_INSTANCE_DRAW':[0],
                'Globals_ps.DEBUG_RENDERTARGET_IS_SRGB_HANDLED':[0],'PerFramePixelCB_ps.RENDERTARGET_IS_SRGB':[0],
                'PerFramePixelCB_ps.FOW_EDGE_CONTROL':[0,0,0,0]}
            for stage in stages:
                for block in stage['sidecar']['blocks']:
                    if block['name']=='ParticleMeshInstanceInfo_SharedDataBuffer':continue
                    for m in block['members']:
                        key=block['glslName']+'.'+m['name']
                        if m['used']and key not in values and m['name']in params:values[key]=params[m['name']][:m['size']//4]
            textures={'ParticleMeshInstanceInfo_SharedDataBuffer':uints,'PIXEL_COLOR_REMAP_RAMP_SharedTexture':transparent,'FOW_MAP_SharedTexture':white}
            for name,path,layer in [('TEXTURE__TX',emitter['texture'],'base'),('sAlphaErosionTexture__TX',emitter['alphaErosionDefinition']['erosionMapName'],'erosion')]:
                asset=effects['assets'][path.lower()];b=raw(assets/'latest-effects'/asset['file'])
                if draw.sha(b)!=asset['sha256']or asset['status']!='prepared':raise ValueError('Unprepared attached effect texture')
                descriptor=bytes.fromhex(next(s['descriptorHex']for s in entry['samplers']if s['layer']==layer))
                if descriptor[:3]!=bytes([descriptor[0]])*3 or descriptor[3]!=descriptor[4]:raise ValueError('Unimplemented asymmetric attached sampler')
                address={0:'repeat',1:'clamp',2:'mirror'}[descriptor[0]];filtering={0:'nearest',1:'linear'}[descriptor[3]]
                textures[name]=renderer.texture(np.array(Image.open(assets/'latest-effects'/asset['file']).convert('RGBA')),address,filtering)
            state=bytes.fromhex(probe['renderState']['bytesHex']);factors={0:0,1:1,6:0x0302,7:0x0303}
            if state[10]!=state[11]or state[12]!=state[13]or state[14]!=0 or not state[4]&4:raise ValueError('Unimplemented attached blend state')
            rgba,blocks=renderer.mesh(program,stages,parts,values,textures,(factors[state[10]],factors[state[12]]))
            visible=np.any(rgba[:,:,:3]>np.array([7,9,14]),axis=2)
            if visible.sum()<100:raise ValueError('Attached shader diagnostic has no visible mesh pixels')
            linear=rgba[:,:,:3].astype(np.float64)/255;display=np.clip(np.where(linear<=.0031308,linear*12.92,1.055*np.power(linear,1/2.4)-.055),0,1)
            panels.append(display);samples.append({'emitterIndex':index,'input':probe['input'],'defines':final_defs,'mask':mask,'parts':[p['name']for p in parts],
                'triangles':sum(p['triangleCount']for p in parts),'rgbaSha256':draw.sha(rgba.tobytes()),'visiblePixels':int(visible.sum()),'values':values,'buffers':blocks,'shaderPair':ref,'initialResourceDecision':resource})
    finally:
        for program in programs:renderer.gl.glDeleteProgram(program)
        renderer.close()
    plt.rcParams.update({'text.color':'#e8edf6','figure.facecolor':'#0e1828'})
    fig,axes=plt.subplots(1,2,figsize=(14,9));fig.subplots_adjust(top=.79,bottom=.25,left=.03,right=.97,wspace=.04)
    fig.text(.04,.94,'Attached death layers through translated game shaders',fontsize=22,weight='bold')
    fig.text(.04,.89,'Viego skin 43 · real mesh streams, textures and native material values · supplied shared pose',fontsize=12,color='#b3c6e2')
    for ax,panel,title in zip(axes,panels,['Body / crown / skirt · emitter 15','Hair · emitter 16']):ax.imshow(panel);ax.axis('off');ax.set_title(title,color='#e8edf6',fontsize=14)
    fig.text(.04,.20,'Offscreen shader diagnostic: alpha erosion drive 0.5; white color factor; zero Fresnel; fitted camera.',fontsize=11,color='#c5b58f')
    fig.text(.04,.155,'Initial mesh absence follows original native asset routing; resource mask 0 and the remaining scene inputs are supplied.',fontsize=10,color='#c5b58f')
    fig.text(.04,.11,'Depth/culling, effect lifecycle, original palette binding and main-viewer integration remain unverified.',fontsize=11,color='#c5b58f')
    fig.text(.04,.065,'ANGLE / D3D11 WARP; no browser or League launched. No matching League pixels compared.',fontsize=11,color='#c5b58f')
    output=assets/'evidence/latest-attached-materials.png';fig.savefig(output,dpi=125,facecolor=fig.get_facecolor())
    result={'schema':1,'kind':'attached-material-offscreen-diagnostic','inputs':inputs,'rendererSha256':draw.sha(Path(__file__).read_bytes()),'drawAdapterSha256':draw.sha(Path(__file__).with_name('render-particle-shader.py').read_bytes()),
        'imageSha256':draw.sha(output.read_bytes()),'context':renderer.info,'libraries':{name:draw.sha((a.angle/name).read_bytes())for name in ['libEGL.dll','libGLESv2.dll']},'samples':samples,
        'scope':{'offscreenTranslatedMeshShaderRendered':True,'initialMeshResourceBranchFromNative':True,'suppliedPosePalette':True,'suppliedMaterialEnvironment':True,'suppliedColorAndFresnel':True,'nativeMeshPoseBindingExecuted':False,
            'originalGpuPaletteBindingVerified':False,'effectLifecycleReconstructed':False,'depthCullPassesVerified':False,'browserRun':False,'mainViewerIntegrated':False,'referencePixelsCompared':False,'displayEncoding':'IEC sRGB encoding of linear readback RGB; game postprocess unverified'}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'imageSha256':result['imageSha256'],'samples':len(samples)}))


if __name__=='__main__':main()

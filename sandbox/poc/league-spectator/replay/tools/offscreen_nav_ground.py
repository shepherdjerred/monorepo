"""Shared GLES consumer for source-owned navigation and ground command exports."""
import ctypes as C
import json
from pathlib import Path
import struct
import sys
import numpy as np
from offscreen_ray import RayDraw, adapter
from graphics_material_bindings import GraphicsMaterialBindings
from graphics_pipeline_device import GraphicsPipelineDevice
from navmesh_resource_coordinates import adapt_navmesh_resource_vertex


class OwnedNavGroundReplay:
    def __init__(self, renderer, cache, proof, raw):
        self.d, self.cache, self.proof, self.raw = renderer, Path(cache), proof, raw
        self.read = lambda path: json.loads(raw(path))
        if proof['kind'] != 'owned-three-nav-ground-renderer-command-export':
            raise ValueError('Source-owned ground command export required')
        for path, digest in proof['inputs'].items():
            if adapter.sha(raw(Path(path))) != digest:
                raise ValueError('Ground command input changed: '+path)
        raw(Path(__file__))
        tools=Path(__file__).resolve().parent
        for module in tuple(sys.modules.values()):
            path=getattr(module,'__file__',None)
            if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(tools):raw(Path(path))
        self.frames = {frame['time']: index for index, frame in enumerate(proof['frames'])}
        if len(self.frames) != len(proof['frames']):
            raise ValueError('Unique navigation command frame clocks required')
        self.draws = {(frame['time'],draw['sourceEventId'],draw['generation'],draw['emitterId']): draw
                      for frame in proof['frames'] for draw in frame['draws']}
        if len(self.draws) != sum(len(frame['draws']) for frame in proof['frames']):
            raise ValueError('Unique retained navigation draw identities required')
        native_controls = {}
        for name in ['direct-nav-ground-pass-native.json', 'direct-nav-camera-pass-native-v37.json']:
            encoded = raw(self.cache/'research'/name)
            native_controls[adapter.sha(encoded)] = json.loads(encoded)
        sampler = self.read(self.cache/'research/navmesh-scene-sampler-native.json')
        self.nav_sampler = proof['frames'][0]['navigationSampler']
        if (any(frame['navigationSampler'] != self.nav_sampler for frame in proof['frames']) or
                any(control['descriptorHex'] != self.nav_sampler['descriptorHex'] or
                    control['gpuSampler']['queriedParameters'] != self.nav_sampler['parameters']
                    for control in sampler['controls'])):
            raise ValueError('Owned navigation sampler differs from original native sampler')
        captures = {}
        for name in ['direct-ray-materials-v28/native.json','direct-static-mesh-materials/native.json']:
            path = self.cache/'research'/name
            data = raw(path); captures[adapter.sha(data)] = json.loads(data)
        image = raw(self.cache/'public/decoder-16.21-macos/image.bin')
        self.material_device = GraphicsMaterialBindings(renderer,image)
        self.pipeline_device = GraphicsPipelineDevice(renderer,image)
        for name,result,args in [
            ('glDrawArrays',None,[C.c_uint,C.c_int,C.c_int]),
            ('glTexSubImage2D',None,[C.c_uint,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p]),
            ('glPixelStorei',None,[C.c_uint,C.c_int])]: renderer.fn(renderer.gl,name,result,*args)
        self.output_color = renderer.textures[0].value
        folder = self.cache/'public/latest-shared-shaders-navmask-v29'
        package = self.read(folder/'package.json')
        def stage(digest):
            ref = next(ref for ref in package['translations'] if ref['dxbcSha256']==digest)
            data = raw(folder/ref['file'])
            if adapter.sha(data)!=ref['sha256']:raise ValueError('Exact producer shader required')
            return json.loads(data)
        vertex = stage('ea6fba36ce6d661beb55e8b2aa4856753a04bb6a8862b022387d7a027288b22a')
        vertex['glsl'] = adapt_navmesh_resource_vertex(vertex['glsl'])
        self.producer_programs = {name:renderer.program(vertex,stage(digest)) for name,digest in {
            'fade':'98a98b9fb3b0f8ac1e60d1d2c1d986f6e5f245bc4f6c2d8d1c3b2ff0462ab3e5',
            'blur':'8d191c51e4cecea3adb01c254a8778c487fe835a483699a74456bd029efe18cc'}.items()}
        self.width,self.height = proof['uploads'][0]['width'],proof['uploads'][0]['height']
        self.textures = {}
        for upload in proof['uploads'][:2]:
            data = bytes.fromhex(upload['bytesHex'])
            if any(data) or len(data)!=self.width*self.height:raise ValueError('Exact zero mask history required')
            handle=C.c_uint();renderer.gl.glGenTextures(1,C.byref(handle));renderer.textures.append(handle)
            self.textures[upload['id']]=handle.value;renderer.gl.glBindTexture(0xde1,handle)
            renderer.gl.glPixelStorei(0xcf5,1)
            renderer.gl.glTexImage2D(0xde1,0,0x8229,self.width,self.height,0,0x1903,0x1401,C.create_string_buffer(data))
        for name in ['output','scratch']:
            self.textures[name]=renderer.texture(np.zeros((self.height,self.width,4),dtype=np.uint8),'clamp','nearest')
        self.materials={};self.native_bindings={};self.observations=[];self.last_frame=-1
        for key,bound in proof['materials'].items():
            entry=bound['material'];capture=captures[entry['originalCaptureSha256']]
            actor=next(actor for actor in capture['passes']['actors'] if actor['emitterIndex']==entry['emitterIndex'])
            variant=next(row for row in actor['rows'] if row['name']=='ground_layer')['variants'][0]
            original_pipeline=capture['pipelines'][str(variant['nativePipeline'])]
            if any(entry['pipeline'][name]!=original_pipeline[name] for name in ['state','descriptorHex']):
                raise ValueError('Complete original acquired ground pipeline differs')
            binding=self.native_bindings[key]=capture['bindings'][str(variant['nativeBinding'])]
            native = native_controls[entry['allPassProofSha256']]
            control=next(c for c in native['cases'] if (c['effectId'],c['emitterIndex'])==(entry['effectId'],entry['emitterIndex']))
            if [p['environment']['pass'] for p in control['passes'] if p['eligible']]!=[5]:
                raise ValueError('Original pass5 eligibility differs')
            program=renderer.program(*bound['stages'])
            pipeline=self.pipeline_device.create(bytes.fromhex(entry['pipeline']['descriptorHex']),{'linked':True,'glHandle':program})
            texture_values={};used=set()
            for texture in entry['textures']:
                actual=bound['textures'][texture['name']];data=bytes.fromhex(actual['rgbaHex']);ref=texture['levels'][0][0]
                if len(data)!=ref['bytes'] or adapter.sha(data)!=ref['sha256']:raise ValueError('Authored ground texture/palette bytes differ')
                original=next(t for t in binding['textures'] if t['name']==texture['name'])
                if original['sampler']['descriptorHex']!=texture['sampler']['descriptorHex']:raise ValueError('Original ground sampler differs')
                texture_values[texture['name']]={'handle':renderer.texture(np.frombuffer(data,dtype=np.uint8).reshape(texture['height'],texture['width'],4),'clamp','nearest'),
                    'sampler':self.material_device.sampler(bytes.fromhex(texture['sampler']['descriptorHex']))['glHandle'],'unit':texture['unit']}
                used.add(texture['unit'])
            for name,texture in bound['textures'].items():
                if name in texture_values:continue
                unit=next(i for i in range(16) if i not in used);used.add(unit)
                if name=='NAVMESH_MASK_TEXTURE_SharedTexture':
                    if texture!={'providerResourceId':'output'}:raise ValueError('Actual final owned GPU nav output required')
                    handle,descriptor=self.textures['output'],self.nav_sampler['descriptorHex']
                else:
                    if texture['width']!=1 or texture['height']!=1 or name not in ['FOW_MAP_SharedTexture','PIXEL_COLOR_REMAP_RAMP_SharedTexture']:
                        raise ValueError('Explicit allvision/remap scene policy required')
                    handle=renderer.texture(np.frombuffer(bytes.fromhex(texture['rgbaHex']),dtype=np.uint8).reshape(1,1,4),'clamp','linear')
                    descriptor='01010100000000000100010100000000'
                texture_values[name]={'handle':handle,'sampler':self.material_device.sampler(bytes.fromhex(descriptor))['glHandle'],'unit':unit}
            self.materials[key]=(program,bound['stages'],pipeline,texture_values)
        self.reset()

    def reset(self):
        d=self.d
        for upload in self.proof['uploads'][:2]:
            d.gl.glBindTexture(0xde1,self.textures[upload['id']])
            d.gl.glTexSubImage2D(0xde1,0,0,0,self.width,self.height,0x1903,0x1401,C.create_string_buffer(bytes.fromhex(upload['bytesHex'])))
        source=self.proof['uploads'][2];d.gl.glBindTexture(0xde1,self.textures[source['id']])
        d.gl.glTexSubImage2D(0xde1,0,0,0,self.width,self.height,0x1903,0x1401,C.create_string_buffer(bytes.fromhex(source['bytesHex'])))
        self.last_frame=-1

    def advance(self,time,expected_native=None):
        wanted=self.frames[time]
        if wanted<self.last_frame:self.reset()
        d=self.d
        for index in range(self.last_frame+1,wanted+1):
            frame=self.proof['frames'][index]
            for pass_index,command in enumerate(frame['passes']):
                program=self.producer_programs[command['shader']];d.gl.glUseProgram(program)
                location=d.gl.glGetUniformBlockIndex(program,b'Globals_ps');block=d.buffer(0x8a11,struct.pack('<4f',*command['parameters']))
                d.gl.glUniformBlockBinding(program,location,0);d.gl.glBindBufferBase(0x8a11,0,block)
                names={'current':'SAMPLER_NAV_GRID_CURRENT_TX','target':'SAMPLER_NAV_GRID_TARGET_TX'} if command['shader']=='fade' else {'source':'srcTex_TX'}
                for unit,(role,name) in enumerate(names.items()):
                    d.gl.glActiveTexture(0x84c0+unit);d.gl.glBindSampler(unit,0);d.gl.glBindTexture(0xde1,self.textures[command['textures'][role]])
                    filtering={'clamp-nearest':9728,'clamp-linear':9729}[command['samplers'][role]]
                    for key,value in [(10240,filtering),(10241,filtering),(10242,33071),(10243,33071)]:d.gl.glTexParameteri(0xde1,key,value)
                    d.gl.glUniform1i(d.gl.glGetUniformLocation(program,name.encode()),unit)
                d.gl.glBindFramebuffer(0x8d40,d.framebuffer);d.gl.glFramebufferTexture2D(0x8d40,0x8ce0,0xde1,self.textures[command['target']],0)
                if d.gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5:raise ValueError('Owned producer FBO incomplete')
                d.buffer(0x8892,struct.pack('<6f',0,0,2,0,0,2));location=d.gl.glGetAttribLocation(program,b'a_POSITION')
                d.gl.glEnableVertexAttribArray(location);d.gl.glVertexAttribPointer(location,2,0x1406,False,8,None)
                for flag in [0xbe2,0xb44,0xb71,0xb90,0x8037]:d.gl.glDisable(flag)
                d.gl.glColorMask(True,True,True,True);d.gl.glViewport(0,0,self.width,self.height);d.gl.glDrawArrays(4,0,3)
                if expected_native is not None:
                    data=C.create_string_buffer(self.width*self.height*4);d.gl.glReadPixels(0,0,self.width,self.height,0x1908,0x1401,data)
                    digest=adapter.sha(data.raw)
                    if digest!=expected_native['result']['renderPasses'][index*5+pass_index]['draws'][0]['rgbaSha256']:
                        raise ValueError('Owned producer/native fullRGBA command raster differs')
                    self.observations.append({'time':time,'pass':pass_index,'rgbaSha256':digest,'nativeExact':True})
                if d.gl.glGetError():raise ValueError('Owned nav producer GL error')
            self.last_frame=index
        d.gl.glFramebufferTexture2D(0x8d40,0x8ce0,0xde1,self.output_color,0)

    def draw(self,time,draw,*,clear=True,readback=True):
        self.advance(time)
        bound=self.draws[(time,draw['sourceEventId'],draw['generation'],draw['emitterId'])]
        geometry=draw.get('geometry',{})
        if geometry and (bound['verticesHex']!=geometry['verticesHex'] or bound['indicesHex']!=geometry['indicesHex']):
            raise ValueError('Nav renderer changed retained worker geometry')
        key=bound['materialKey'];program,stages,pipeline,textures=self.materials[key]
        blocks=[{**b,'bytes':bytes.fromhex(b['bytesHex'])} for b in bound['uniformBlocks']]
        for original in self.native_bindings[key]['uniformBuffers']:
            supplied=next(b for b in blocks if (b['stage'],b['name'])==(original['stage'],original['name']))
            if supplied['bytesHex']!=original['bytesHex']:raise ValueError('Complete original static ground UBO differs')
        pixels,observations=RayDraw.draw_ray(self.d,program,stages,bytes.fromhex(bound['verticesHex']),bytes.fromhex(bound['indicesHex']),blocks,textures,
            lambda:self.pipeline_device.apply(pipeline,stencil_reference=0,blend_color=[0,0,0,0]),clear=clear,readback=readback)
        for texture in textures.values():self.d.gl.glBindSampler(texture['unit'],0)
        return pixels,observations

    def close(self):
        self.material_device.close()
        for program in [*self.producer_programs.values(),*[value[0] for value in self.materials.values()]]:
            self.d.gl.glDeleteProgram(program)

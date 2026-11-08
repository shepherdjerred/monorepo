"""Port material constants/textures/samplers to real GLES resources.

The native backend zeroes a constant buffer, then copies matching parameter
vectors up to each reflected member's size (191f560/191f950). Per-frame blocks
and absent textures remain explicit draw-time requirements.
"""
import ctypes as C
import hashlib
import struct


def sha(data):return hashlib.sha256(data).hexdigest()


class GraphicsMaterialBindings:
    def __init__(self,device,shaders):
        self.device=device;self.shaders=shaders;self.gl=device.gl
        u,i,p=C.c_uint,C.c_int,C.c_void_p
        for name,result,args in [
                ('glMapBufferRange',p,[u,C.c_ssize_t,C.c_ssize_t,u]),('glUnmapBuffer',C.c_ubyte,[u]),
                ('glGenSamplers',None,[i,C.POINTER(u)]),('glDeleteSamplers',None,[i,C.POINTER(u)]),
                ('glSamplerParameteri',None,[u,u,i]),('glGetSamplerParameteriv',None,[u,u,C.POINTER(i)]),
                ('glGetIntegerv',None,[u,C.POINTER(i)]),
                ('glBindSampler',None,[u,u])]:device.fn(self.gl,name,result,*args)
        self.buffers=[];self.samplers=[];self.records=[]

    def sampler(self,raw):
        if len(raw)!=16 or any(raw[i] for i in [3,4,5,6,7,12,13,14,15]) or raw[11]!=1:
            raise ValueError('Unadmitted native material sampler: anisotropy/border/reserved fields')
        if any(raw[i]>2 for i in range(3)) or raw[8]>1 or raw[9]>2 or raw[10]>1:
            raise ValueError('Unadmitted native material sampler addressing/filtering')
        min_filter=[[0x2600,0x2601],[0x2700,0x2701],[0x2702,0x2703]][raw[9]][raw[8]]
        parameters={0x2802:[0x2901,0x812f,0x8370][raw[0]],
            0x2803:[0x2901,0x812f,0x8370][raw[1]],0x8072:[0x2901,0x812f,0x8370][raw[2]],
            0x2801:min_filter,0x2800:[0x2600,0x2601][raw[10]]}
        handle=C.c_uint();self.gl.glGenSamplers(1,C.byref(handle));self.samplers.append(handle)
        for token,value in parameters.items():self.gl.glSamplerParameteri(handle,token,value)
        observed={}
        for token in parameters:
            value=C.c_int();self.gl.glGetSamplerParameteriv(handle,token,C.byref(value));observed[token]=value.value
        if self.gl.glGetError() or observed!=parameters:raise ValueError('Native material sampler GPU state differs')
        return {'glHandle':handle.value,'descriptorHex':raw.hex(),'parameters':parameters,'queriedParameters':observed}

    def create(self,request,pipeline,program,texture_resources):
        if self.gl.glGetError():raise ValueError('GLES has an error before material binding creation')
        if program['glHandle']!=pipeline['glProgram']:raise ValueError('Native material pipeline program differs')
        # The original searches the ordered request and copies the first match.
        # Pass-local parameters precede material parameters in that request.
        uniforms={};textures={}
        for value in request['uniforms']:uniforms.setdefault(value['name'],value)
        for value in request['textures']:textures.setdefault(value['name'],value)
        gl=self.gl;gl.glUseProgram(program['glHandle'])
        blocks=[];bound_textures=[];scene_blocks=[];scene_textures=[];material_textures=[];scene_data_buffers=[];binding_index=0;unit=0
        for stage in ['vertex','pixel']:
            translation=self.shaders.shaders[program[stage]]['translation']
            for block in translation['sidecar']['blocks']:
                if not any(m['used'] for m in block['members']):continue
                resources=translation['sidecar']['textures']
                if any(t['name']==block['name'] and t['dimension']=='buffer' for t in resources):
                    # The DXBC sidecar retains the structured element layout.
                    # The existing GLSL adapter exposes this SRV as a uint data
                    # texture, not a uniform block. Its contents are scene data.
                    location=gl.glGetUniformLocation(program['glHandle'],block['name'].encode())
                    if location<0:raise ValueError('Native reflected scene data-buffer sampler is absent')
                    gl.glUniform1i(location,unit)
                    scene_data_buffers.append({'stage':stage,'name':block['name'],'glslName':block['name'],
                        'unit':unit,'elementBytes':block['size'],'members':block['members'],
                        'adapter':'uint-data-texture'})
                    unit+=1;continue
                index=gl.glGetUniformBlockIndex(program['glHandle'],block['glslName'].encode())
                if index==0xffffffff:raise ValueError(f"Native material reflected uniform block is absent: {block['glslName']}")
                gl.glUniformBlockBinding(program['glHandle'],index,binding_index)
                if block['name']!='$Globals':
                    scene_blocks.append({'stage':stage,'name':block['glslName'],'binding':binding_index,
                        'size':block['size'],'requiredMembers':[m for m in block['members'] if m['used']]})
                    binding_index+=1;continue
                data=bytearray(block['size']);copied=[];zeroed=[]
                for member in block['members']:
                    if not member['used']:continue
                    offset,size=member['offset'],member['size']
                    if not 0<=offset<offset+size<=len(data):raise ValueError('Native material uniform layout exceeds block')
                    source=uniforms.get(member['name'])
                    if source is None:
                        zeroed.append(member['name']);continue
                    raw=bytes.fromhex(source['bytesHex'])
                    if len(raw)!=source['count']*16:raise ValueError('Native material parameter byte count differs')
                    count=min(len(raw),size);data[offset:offset+count]=raw[:count]
                    copied.append({'name':member['name'],'offset':offset,'bytes':count,'sourceCount':source['count']})
                handle=C.c_uint();gl.glGenBuffers(1,C.byref(handle));self.buffers.append(handle)
                gl.glBindBuffer(0x8a11,handle);raw=C.create_string_buffer(bytes(data))
                gl.glBufferData(0x8a11,len(data),raw,0x88e8)
                pointer=gl.glMapBufferRange(0x8a11,0,len(data),1)
                if not pointer:raise ValueError('Native material constant-buffer readback is unavailable')
                actual=C.string_at(pointer,len(data));unmapped=gl.glUnmapBuffer(0x8a11)
                if not unmapped or actual!=bytes(data):raise ValueError('Native material constant-buffer GPU bytes differ')
                gl.glBindBufferBase(0x8a11,binding_index,handle)
                blocks.append({'stage':stage,'name':block['glslName'],'binding':binding_index,'glHandle':handle.value,
                    'bytesHex':bytes(data).hex(),'gpuReadbackSha256':sha(actual),'copied':copied,
                    'nativeZeroInitializedMembers':zeroed,'gpuBytesVerified':True})
                binding_index+=1
            for texture in translation['sidecar']['textures']:
                if texture['dimension']=='buffer':
                    if not any(b['stage']==stage and b['name']==texture['name'] for b in scene_data_buffers):
                        raise ValueError('Native scene data buffer lacks its element layout')
                    continue
                name=texture['name'];key=name[:-4] if name.endswith('__TX') else name
                source=textures.get(key)
                for ref in texture['samplers']:
                    location=gl.glGetUniformLocation(program['glHandle'],ref['glslName'].encode())
                    if location<0:raise ValueError('Native material reflected sampler is absent')
                    gl.glUniform1i(location,unit)
                    if source is None:
                        # Original 191fad0/191fcb0 retain a null resource for a
                        # reflected slot absent from the ordered request. They
                        # do not fail material construction or bind a default.
                        # The native absence oracle covers empty/nonmatching
                        # requests. This record is never declared draw-ready.
                        missing=scene_textures if name.endswith('_SharedTexture') else material_textures
                        missing.append({'stage':stage,'name':name,'sampler':ref['sampler'],
                            'glslName':ref['glslName'],'unit':unit,'dimension':texture['dimension'],
                            'nativeResource':None,'reason':'material-input-absent'})
                        unit+=1;continue
                    gpu=texture_resources[source['nativeTexture']]
                    dimensions={'2d':('texture2d',0x0de1,0x8069),'cube':('cube',0x8513,0x8514)}
                    binding=dimensions.get(gpu['kind'])
                    if not binding or texture['dimension']!=binding[0]:
                        raise ValueError('Native material texture dimension/mips require another binding implementation')
                    sampler=self.sampler(bytes.fromhex(source['descriptorHex']))
                    gl.glActiveTexture(0x84c0+unit);gl.glBindTexture(binding[1],gpu['glHandle'])
                    gl.glBindSampler(unit,sampler['glHandle'])
                    queried=C.c_int();gl.glGetIntegerv(binding[2],C.byref(queried))
                    if queried.value!=gpu['glHandle']:raise ValueError('Material texture target binding differs from supplied GPU resource')
                    bound_textures.append({'stage':stage,'name':name,'glslName':ref['glslName'],'unit':unit,
                        'nativeTexture':source['nativeTexture'],'glTexture':gpu['glHandle'],'sampler':sampler,
                        'dimension':texture['dimension'],'textureTarget':binding[1],'queriedGlTexture':queried.value})
                    unit+=1
        if gl.glGetError():raise ValueError('Native material GLES binding creation failed')
        record={'glProgram':program['glHandle'],'uniformBuffers':blocks,'textures':bound_textures,
            'requiredSceneBlocks':scene_blocks,'requiredSceneTextures':scene_textures,
            'requiredMaterialTextures':material_textures,
            'requiredSceneDataBuffers':scene_data_buffers,
            'sceneInputsBound':False,'created':True,
            'drawReady':not scene_blocks and not scene_textures and not material_textures and not scene_data_buffers}
        self.records.append(record);return record

    def close(self):
        for handle in self.samplers:self.gl.glDeleteSamplers(1,C.byref(handle))
        for handle in self.buffers:self.gl.glDeleteBuffers(1,C.byref(handle))
        self.samplers.clear();self.buffers.clear()

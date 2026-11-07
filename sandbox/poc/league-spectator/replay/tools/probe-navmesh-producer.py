"""Original navmask manager over owned navgrid and explicit graphics/clock inputs.

Research-only: map selection and runtime configuration are not replay-derived.
Unsupported device APIs fail rather than manufacture a ready mask.
"""
import argparse
import ctypes as C
import inspect
import io
import importlib.metadata
import json
import struct
import sys
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from navgrid_world_native import NativeNavgridStream, initialize_navgrid_world, CALLBACK_START
from native_vfx_fixture import NativeVfxFixture
from vfx_pipeline_native import NativeVfxPipelineContext
from vfx_graphics_native import DEVICE, CALLBACKS, SERVICE, SERVICE_VTABLE
from vfx_pipeline_native import PIPELINE_DEVICE_VTABLE
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_texture_device import GraphicsTextureDevice
from vfx_spawn_native import ADDRESSES as A, sha
from vfx_asset_native import REGISTRY
from game_mode_data_native import NativeGameModeData
from character_postload_native import NativeCharacterPostload
from vfx_mesh_native import NativeVfxMeshContext, BUFFER_CREATE, BUFFER_RETURN, LAYOUT_CREATE, LAYOUT_STOP
from graphics_mesh_device import GraphicsMeshDevice
from material_uniform_update_native import material_uniform_layouts, update_material_uniforms
from shared_constant_inputs_native import initialize_shared_constant_types
from navmesh_resource_coordinates import POLICY as RESOURCE_COORDINATE_POLICY, adapt_navmesh_resource_vertex
R8_UPDATE=0x10328000
FB_CREATE=0x10328010
FB_RETURN=0x10328020
PASS_BEGIN=0x10328030
PASS_END=0x10328040
VIEWPORT=0x10328050
UNIFORM_UPDATE=0x10328060
TEXTURE_UPDATE=0x10328070
PIPELINE_APPLY=0x10328080
MATERIAL_APPLY=0x10328090
DRAW_ARRAYS=0x103280a0


class MaskDevice(GraphicsTextureDevice):
    def compile(self, source, stage):
        if stage=='vertex':source=adapt_navmesh_resource_vertex(source)
        return super().compile(source,stage)

    def create(self, request):
        fmt=request['nativeFormat']
        if fmt != 0x10 and not (fmt==2 and request['levels']==[[None]]):
            return super().create(request)
        if (request['kind'] != '2d' or request['layers'] != 1 or len(request['levels']) != 1 or
                len(request['levels'][0]) != 1):
            raise ValueError('R8 producer only supports exact single-level 2D resources')
        w, h = request['width'], request['height']
        data = request['levels'][0][0]
        if not 1 <= w <= 4096 or not 1 <= h <= 4096 or (data is not None and len(data) != w * h):
            raise ValueError('Owned exact R8 source bytes required')
        handle = C.c_uint()
        gl = self.gl
        gl.glGenTextures(1, C.byref(handle)); self.textures.append(handle)
        gl.glBindTexture(0xde1, handle)
        gl.glTexParameteri(0xde1, 0x2801, 0x2600); gl.glTexParameteri(0xde1, 0x2800, 0x2600)
        gl.glTexParameteri(0xde1, 0x2802, 0x812f); gl.glTexParameteri(0xde1, 0x2803, 0x812f)
        gl.glPixelStorei(0xcf5, 1)
        gl.glTexImage2D(0xde1, 0, 0x8229 if fmt==0x10 else 0x8058, w, h, 0, 0x1903 if fmt==0x10 else 0x1908, 0x1401, C.create_string_buffer(data) if data is not None else None)
        gl.glBindFramebuffer(0x8d40, self.framebuffer)
        gl.glFramebufferTexture2D(0x8d40, 0x8ce0, 0xde1, handle, 0)
        if gl.glCheckFramebufferStatus(0x8d40) != 0x8cd5:
            raise ValueError('R8 producer framebuffer incomplete')
        if data is not None:
            out = C.create_string_buffer(w*h*4)
            gl.glReadPixels(0, 0, w, h, 0x1908, 0x1401, out)
            if gl.glGetError() or out.raw[0::4] != data:
                raise ValueError('R8 GPU upload/readback differs')
        return {'kind':'2d','nativeFormat':fmt,'width':w,'height':h,'layers':1,'mips':1,
                'glHandle':handle.value,'gpuBytesVerified':data is not None,
                'allocatedWithoutInitialData':data is None,'nativeSourceSha256':sha(data) if data is not None else None,
                'readbacks':[{'mip':0,'layer':0,'bytes':len(data),'sha256':sha(data)}] if data is not None else []}


class Control(NativeVfxPipelineContext):
    open_navgrid_stream = NativeNavgridStream.open_navgrid_stream
    read_typed_fields = NativeGameModeData.read_typed_fields
    build_constant_index = NativeGameModeData.build_constant_index
    buffer_create = NativeVfxMeshContext.buffer_create
    buffer_return = NativeVfxMeshContext.buffer_return
    layout_create = NativeVfxMeshContext.layout_create
    layout_return = NativeVfxMeshContext.layout_return
    observe_layout_binding = NativeVfxMeshContext.observe_layout_binding

    def __init__(self, *args, **kwargs):
        self.navgrid_stream = None
        self.initializing_nav_mode=False
        super().__init__(*args, **kwargs)
        self.r8_updates=[];self.r8_vtable=None
        self.character_format_calls=[]
        self.character_sprintf=C.CDLL('msvcrt.dll').sprintf
        self.character_sprintf.restype=C.c_int
        self.character_sprintf.argtypes=[C.c_void_p,C.c_char_p]
        self.mesh_backend=GraphicsMeshDevice(self.device)
        self.pending_mesh_buffer=self.pending_mesh_layout=None
        self.pending_layout_bindings=[];self.native_mesh_buffers={};self.native_mesh_layouts={}
        self.render_targets={};self.pending_target=None;self.target_framebuffers=[]
        self.framebuffer_groups={};self.pending_framebuffer=None
        self.framebuffer_requests=[]
        self.active_pass=None;self.render_passes=[]
        self.material_updates=[]
        self.current_pipeline=None;self.current_material=None
        for at,callback in [(BUFFER_CREATE,self.buffer_create),(BUFFER_RETURN,self.buffer_return),(LAYOUT_CREATE,self.layout_create)]:
            self.u.mem_write(at,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=at,end=at)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.layout_return,begin=self.base+LAYOUT_STOP,end=self.base+LAYOUT_STOP)
        for at in [0x192def0,0x192dfa4]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_layout_binding,begin=self.base+at,end=self.base+at)
        for at in [0x1925950,0x19259a0]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.render_target,begin=self.base+at,end=self.base+at)
        self.u.mem_write(R8_UPDATE,b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.update_r8,begin=R8_UPDATE,end=R8_UPDATE)
        for at in [FB_CREATE,FB_RETURN]:
            self.u.mem_write(at,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,self.framebuffer,begin=at,end=at)
        for at in [PASS_BEGIN,PASS_END]:
            self.u.mem_write(at,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,self.render_pass,begin=at,end=at)
        self.u.mem_write(VIEWPORT,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,self.viewport,begin=VIEWPORT,end=VIEWPORT)
        for at in [UNIFORM_UPDATE,TEXTURE_UPDATE]:
            self.u.mem_write(at,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,self.material_update,begin=at,end=at)
        for at in [PIPELINE_APPLY,MATERIAL_APPLY,DRAW_ARRAYS]:
            self.u.mem_write(at,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,self.draw_api,begin=at,end=at)

    def render_target(self,uc,address,size,user):
        if address==self.base+0x1925950:
            texture=uc.reg_read(r.UC_X86_REG_RSI)
            if uc.reg_read(r.UC_X86_REG_RDI)!=DEVICE or texture not in self.native_textures or self.pending_target is not None:
                raise ValueError('Render target requires an owned GPU texture')
            self.pending_target=texture;return
        target=uc.reg_read(r.UC_X86_REG_R14);texture=self.pending_target
        if (texture is None or self.allocations.get(target)!=0x28 or self.q(target+0x20)!=texture or
                self.u32(target+0x10)!=self.native_textures[texture]['width'] or
                self.u32(target+0x14)!=self.native_textures[texture]['height']):
            raise ValueError('Original render-target descriptor differs')
        gl=self.device.gl;framebuffer=C.c_uint();gl.glGenFramebuffers(1,C.byref(framebuffer))
        self.target_framebuffers.append(framebuffer)
        gl.glBindFramebuffer(0x8d40,framebuffer)
        gl.glFramebufferTexture2D(0x8d40,0x8ce0,0xde1,self.native_textures[texture]['glHandle'],0)
        if gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5 or gl.glGetError():raise ValueError('Owned GPU render target is incomplete')
        self.render_targets[target]={'texture':texture,'glFramebuffer':framebuffer.value,
                                     'originalDescriptorHex':bytes(uc.mem_read(target,0x28)).hex()}
        self.pending_target=None

    def draw_api(self,uc,address,size,user):
        if uc.reg_read(r.UC_X86_REG_RDI)!=DEVICE:raise ValueError('Foreign draw API device')
        pointer=uc.reg_read(r.UC_X86_REG_RSI);gl=self.device.gl
        if address==PIPELINE_APPLY:
            if pointer not in self.native_pipelines:raise ValueError('Owned compiled GPU pipeline required')
            pipeline=self.native_pipelines[pointer]
            # Only these original postprocess passes are admitted, so unused
            # blend-constant/depth/stencil/culling inputs are never invented.
            if any(pipeline['state'][key] for key in ['blendEnabled','depthEnabled','stencilEnabled','cullEnabled','polygonOffsetEnabled']):
                raise ValueError('Only original unblended/unculled fullscreen pipelines supported')
            self.pipeline_backend.apply(pipeline,stencil_reference=uc.reg_read(r.UC_X86_REG_EDX),blend_color=[0,0,0,0])
            self.current_pipeline=pointer
        elif address==MATERIAL_APPLY:
            if pointer not in self.native_bindings:raise ValueError('Owned material binding required')
            binding=self.native_bindings[pointer]
            if not binding['drawReady']:raise ValueError('Postprocess material has unresolved inputs')
            if self.current_pipeline is None or binding['glProgram']!=self.native_pipelines[self.current_pipeline]['glProgram']:
                raise ValueError('Material and active GPU program differ')
            for block in binding['uniformBuffers']:gl.glBindBufferBase(0x8a11,block['binding'],block['glHandle'])
            for texture in binding['textures']:
                gl.glActiveTexture(0x84c0+texture['unit']);gl.glBindTexture(texture['textureTarget'],texture['glTexture'])
                gl.glBindSampler(texture['unit'],texture['sampler']['glHandle'])
            self.current_material=pointer
        else:
            primitive=uc.reg_read(r.UC_X86_REG_EDX);first=uc.reg_read(r.UC_X86_REG_ECX);count=uc.reg_read(r.UC_X86_REG_R8D)
            if (self.active_pass is None or 'viewportHex' not in self.active_pass or
                    self.current_material is None or pointer not in self.native_mesh_layouts or (primitive,first,count)!=(4,0,3)):
                raise ValueError('Owned full-target native fullscreen triangle required')
            layout=self.native_mesh_layouts[pointer]
            if layout['descriptorHex']!='0000020001000000' or len(layout['bindings'])!=1:
                raise ValueError('Original fullscreen float2 position layout required')
            vb=layout['bindings'][0];buffer=self.native_mesh_buffers[vb['nativeBuffer']]
            if vb['offset'] or vb['stride']!=8 or buffer['bytes']!=24:raise ValueError('Original fullscreen vertex buffer range differs')
            program=self.native_pipelines[self.current_pipeline]['glProgram']
            location=gl.glGetAttribLocation(program,b'a_POSITION')
            if location<0:raise ValueError('Original fullscreen POSITION shader input missing')
            gl.glBindVertexArray(layout['glHandle']);gl.glBindBuffer(0x8892,buffer['glHandle'])
            gl.glEnableVertexAttribArray(location);gl.glVertexAttribPointer(location,2,0x1406,False,8,None)
            gl.glDrawArrays(0x0004,0,3)
            group=self.framebuffer_groups[self.active_pass['framebufferGroup']];gpu=self.native_textures[group['texture']]
            pixels=C.create_string_buffer(gpu['width']*gpu['height']*4)
            gl.glReadPixels(0,0,gpu['width'],gpu['height'],0x1908,0x1401,pixels)
            self.active_pass['draws'].append({'layout':pointer,'pipeline':self.current_pipeline,'material':self.current_material,
                'primitive':primitive,'first':first,'count':count,'width':gpu['width'],'height':gpu['height'],
                'targetTexture':group['texture'],
                'uniformBuffers':[{k:b[k] for k in ['stage','name','binding','bytesHex']} for b in self.native_bindings[self.current_material]['uniformBuffers']],
                'textures':[{'name':t['name'],'nativeTexture':t['nativeTexture'],'unit':t['unit'],
                             'sampler':{k:v for k,v in t['sampler'].items() if k!='glHandle'}} for t in self.native_bindings[self.current_material]['textures']],
                'rgbaSha256':sha(pixels.raw),'redHex':pixels.raw[0::4].hex(),
                'coordinatePolicy':RESOURCE_COORDINATE_POLICY,'nativeGpuParityEstablished':False})
        if gl.glGetError():raise ValueError('Native postprocess GPU draw API failed')
        self.ret()

    def material_update(self,uc,address,size,user):
        pointer=uc.reg_read(r.UC_X86_REG_RSI);payload=uc.reg_read(r.UC_X86_REG_RDX)
        caller=self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
        if uc.reg_read(r.UC_X86_REG_RDI)!=DEVICE or pointer not in self.native_bindings or not self.library_pointer(payload,40):
            raise ValueError('Owned material update binding and payload required')
        requests=[row for row in self.material_binding_requests if row.get('bindingPointer')==pointer]
        if len(requests)!=1:raise ValueError('Unique original material binding request required')
        pipeline=self.native_pipelines[requests[0]['nativePipeline']]
        program=self.native_programs[pipeline['nativeProgram']];binding=self.native_bindings[pointer]
        name=self.cstring(self.q(payload)).decode('ascii')
        self.pending_material_update={'name':name,'callerRva':caller,'payloadHex':bytes(uc.mem_read(payload,40)).hex()}
        if address==UNIFORM_UPDATE:
            if caller not in [0x17c1323,0x17ba481]:raise ValueError(f'Unobserved original material uniform caller {caller:x}')
            count=self.u32(payload+16);_,required=material_uniform_layouts(self.material_backend,binding,program,name,count)
            source=self.q(payload+8)
            if required and not self.library_pointer(source,required):raise ValueError('Owned complete material update source required')
            result=update_material_uniforms(self.material_backend,binding,program,name,count,bytes(uc.mem_read(source,required)) if required else b'')
        else:
            if caller!=0x17c1e13:raise ValueError('Unobserved original material texture caller')
            texture=self.q(payload+8)
            # Update19217e0 consumes exactly12 bytes at+18..+23. Unlike
            # binding creation, its stack payload has no initialized trailing
            # four-byte padding. Canonicalize only that unconsumed padding.
            sampler_payload=bytes(uc.mem_read(payload+0x18,12))
            canonical=bytearray(sampler_payload)
            #1921878..19218a2 loads x/y/z, color32 and four filter bytes;
            # byte+1b is also padding, never an argument to191ff70.
            canonical[3]=0
            descriptor=bytes(canonical)+bytes(4)
            if texture not in self.native_textures:raise ValueError('Updated material texture must own a GPU resource')
            gpu=self.native_textures[texture]
            if gpu['kind']!='2d':raise ValueError('Only exact2D navmask material texture updates supported')
            matches=[row for row in binding['textures'] if row['name']==name or row['name']==name+'__TX']
            for row in matches:
                sampler=self.material_backend.sampler(descriptor)
                row.update(nativeTexture=texture,glTexture=gpu['glHandle'],sampler=sampler)
            result={'parameterName':name,'nativeTexture':texture,'samplerPayloadHex':sampler_payload.hex(),
                    'descriptorHex':descriptor.hex(),'matchedSlots':len(matches)}
        self.material_updates.append({'nativeBinding':pointer,'callerRva':caller,**result});self.pending_material_update=None;self.ret()

    def viewport(self,uc,address,size,user):
        descriptor=uc.reg_read(r.UC_X86_REG_RSI)
        if uc.reg_read(r.UC_X86_REG_RDI)!=DEVICE or self.active_pass is None or not self.library_pointer(descriptor,24):
            raise ValueError('Owned active render pass viewport required')
        raw=bytes(uc.mem_read(descriptor,24));left,top,right,bottom,near,far=struct.unpack('<4I2f',raw)
        group=self.framebuffer_groups[self.active_pass['framebufferGroup']];gpu=self.native_textures[group['texture']]
        if (left,top,right,bottom,near,far)!=(0,0,gpu['width'],gpu['height'],0,1):
            raise ValueError('Only exact full-color-target viewport supported')
        self.device.gl.glViewport(0,0,right,bottom)
        if self.device.gl.glGetError():raise ValueError('GLES viewport setup failed')
        self.active_pass['viewportHex']=raw.hex();self.ret()

    def render_pass(self,uc,address,size,user):
        if uc.reg_read(r.UC_X86_REG_RDI)!=DEVICE:raise ValueError('Foreign render-pass device')
        gl=self.device.gl
        if address==PASS_BEGIN:
            target=uc.reg_read(r.UC_X86_REG_RSI);descriptor=uc.reg_read(r.UC_X86_REG_RDX)
            if target not in self.framebuffer_groups or self.active_pass is not None or not self.library_pointer(descriptor,0x80):
                raise ValueError('Owned non-reentrant framebuffer group required')
            # Original19267a7..1926827 maps color load2 to MetalDontCare and
            # color store0 to MetalStore. Admit that observed mode only.
            if self.u32(descriptor)!=2 or self.u32(descriptor+0xc)!=0:
                raise ValueError('Only original navmask discard-load/store-color render passes supported')
            group=self.framebuffer_groups[target]
            gl.glBindFramebuffer(0x8d40,group['glFramebuffer'])
            self.device.fn(gl,'glInvalidateFramebuffer',None,C.c_uint,C.c_int,C.POINTER(C.c_uint))
            attachments=(C.c_uint*1)(0x8ce0);gl.glInvalidateFramebuffer(0x8d40,1,attachments)
            if gl.glGetError():raise ValueError('GLES discard-load render-pass bind failed')
            self.active_pass={'framebufferGroup':target,'descriptorHex':bytes(uc.mem_read(descriptor,0x80)).hex(),
                              'nativeLoadAction':0,'nativeStoreAction':1,'draws':[]}
        else:
            if self.active_pass is None:raise ValueError('Render pass ended without an owned begin')
            self.render_passes.append(self.active_pass);self.active_pass=None
            gl.glBindFramebuffer(0x8d40,0)
        self.ret()

    def framebuffer(self,uc,address,size,user):
        if address==FB_CREATE:
            count=uc.reg_read(r.UC_X86_REG_ESI);array=uc.reg_read(r.UC_X86_REG_RDX);depth=uc.reg_read(r.UC_X86_REG_RCX)
            self.framebuffer_requests.append({'apiAddress':address,'instruction':uc.reg_read(r.UC_X86_REG_RIP),
                'device':uc.reg_read(r.UC_X86_REG_RDI),'count':count,'array':array,'depth':depth,
                'target':self.q(array) if self.library_pointer(array,8) else None,
                'pending':self.pending_framebuffer,'knownTargets':list(self.render_targets)})
            if (uc.reg_read(r.UC_X86_REG_RDI)!=DEVICE or self.pending_framebuffer is not None or
                    count!=1 or depth or not self.library_pointer(array,8) or self.q(array) not in self.render_targets):
                raise ValueError('Only owned single-color no-depth framebuffer groups supported')
            target=self.q(array);header=self.allocate(0x30,0xa5);stack=uc.reg_read(r.UC_X86_REG_RSP)
            self.pending_framebuffer={'header':header,'stack':stack,'target':target}
            frame=stack-0x10;self.put(frame,'Q',FB_RETURN)
            for reg,value in [(r.UC_X86_REG_RDI,header),(r.UC_X86_REG_RSP,frame),(r.UC_X86_REG_RIP,self.base+0x1916390)]:uc.reg_write(reg,value)
            return
        p=self.pending_framebuffer
        if p is None:raise ValueError('Unexpected framebuffer constructor return')
        header,target=p['header'],p['target'];texture=self.render_targets[target]['texture'];gpu=self.native_textures[texture]
        if (self.u32(header+0x10)!=1 or self.q(self.q(header+8))!=target or self.q(header+0x18) or
                (self.u32(header+0x20),self.u32(header+0x24))!=(gpu['width'],gpu['height'])):
            raise ValueError('Original framebuffer group descriptor differs')
        self.framebuffer_groups[header]={'target':target,**self.render_targets[target],
                                        'originalHeaderHex':bytes(uc.mem_read(header,0x30)).hex()}
        self.pending_framebuffer=None;uc.reg_write(r.UC_X86_REG_RSP,p['stack']);uc.reg_write(r.UC_X86_REG_RAX,header);self.ret()

    def imported(self, uc, address, size, user):
        if self.source.imports[address-self.base]=='_memcmp':
            first,second,count=[uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
            if count>0x100000 or not self.library_pointer(first,count) or not self.library_pointer(second,count):
                raise ValueError('memcmp requires bounded owned inputs')
            a,b=bytes(uc.mem_read(first,count)),bytes(uc.mem_read(second,count))
            result=next((x-y for x,y in zip(a,b) if x!=y),0)
            uc.reg_write(r.UC_X86_REG_RAX,result&0xffffffffffffffff);self.ret();return
        if self.source.imports[address-self.base]=='_vsnprintf':
            return NativeCharacterPostload.imported(self,uc,address,size,user)
        if self.initializing_nav_mode and self.source.imports[address-self.base]=='___bzero':
            destination,count=uc.reg_read(r.UC_X86_REG_RDI),uc.reg_read(r.UC_X86_REG_RSI)
            caller=self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
            if not 0x4248b0<=caller<0x42a450 or not 0<count<=0x100000 or not self.base+0x1fef000<=destination<=self.base+len(self.image)-count:
                raise ValueError('Original mode metadata zero escaped pinned caller/data bounds')
            uc.mem_write(destination,bytes(count));self.ret();return
        return super().imported(uc,address,size,user)

    def initialize_nav_mode(self, fixture):
        evidence=fixture.read(fixture.cache/'research/game-mode-data-native.json')
        if evidence['decoderImageSha256']!=sha(self.image):raise ValueError('Mode input image differs')
        installed=fixture.read(fixture.cache/'public/latest-map-effect-inputs/package.json')
        raw=fixture.raw(fixture.cache/'public/latest-map-effect-inputs/map.bin')
        if sha(raw)!=installed['source']['sha256']:raise ValueError('Mode source BIN differs')
        before=dict(self.types)
        self.initializing_nav_mode=True
        try:self.call(0x4248b0,{})
        finally:self.initializing_nav_mode=False
        count,array=self.u32(self.base+REGISTRY+8),self.q(self.base+REGISTRY)
        if not len(before)<=count<=4096:raise ValueError('Mode metadata registry bound')
        for i in range(count):
            at=self.q(array+i*8);self.types[self.u32(at+8)]=at
        if any(self.types.get(k)!=v for k,v in before.items()) or self.q(self.types[0x89ce9636]+0x40)!=0x1e0:
            raise ValueError('Original mode metadata replaced a class or layout differs')
        selected=[c for c in evidence['cases'] if c['selectedRecordedMode']]
        if len(selected)!=1:raise ValueError('One recorded mode input required')
        old=selected[0]
        def load(case):
            fields=[]
            for ref in case['fields']:
                value=raw[ref['offset']:ref['offset']+ref['bytes']]
                if len(value)!=ref['bytes'] or sha(value)!=ref['sha256']:raise ValueError('Mode raw field span differs')
                fields.append(value)
            return self.read_typed_fields(case['typeHash'],fields)
        selected_loaded=load(old)
        links=[p for p in old['loaded']['pendingReferences'] if p['destination']==old['loaded']['object']+0x178]
        if len(links)!=1:raise ValueError('One original constants input required')
        constants=[c for c in evidence['cases'] if c['identity']==links[0]['identity']]
        if len(constants)!=1:raise ValueError('Constants input missing')
        constant_loaded=load(constants[0])
        result=self.build_constant_index(selected_loaded,{**constants[0],'loaded':constant_loaded},evidence['selectedMode']['modeHash'])
        # Only the navmask's actual mode-info dependency is needed here. Load
        # its unchanged installed root and execute the same original index
        # insertion as409a90; unrelated mode dependencies remain unresolved.
        self.fragment(0x76a384,0x76a42b,{r.UC_X86_REG_RSP:A['stack']-0x80})
        descriptor=self.base+0x24d0528
        if self.u32(descriptor+8)!=0x8b04b4cb:raise ValueError('Original nav mode-info descriptor differs')
        self.types[0x8b04b4cb]=descriptor
        import cdtb.binfile as binfile
        if json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))['vcs_info']['commit_id']!=installed['parser']['cdtbRevision']:
            raise ValueError('Pinned map BIN parser required')
        for name in ['binfields','bintypes','binentries','binhashes','binhashes_xxh3','binpaths']:
            getattr(binfile,'hashfile_'+name).hashes={}
        class Reader(binfile.BinReader):
            def __init__(self,*args):super().__init__(*args);self.spans={}
            def read_field(self,htype):
                start=self.f.tell();field=super().read_field(htype);self.spans[id(field)]=(start,self.f.tell());return field
        stream=io.BytesIO(raw)
        if stream.read(4)!=b'PROP':raise ValueError('Original map BIN required')
        parser=Reader(stream);_,_,types=parser.read_binfile_header()
        entries=[parser.read_binfile_entry(t) for t in types]
        candidates=[entry for entry in entries if entry.type.h==0x8b04b4cb and
                    any(link['identity']==entry.path.h for link in selected_loaded['pendingReferences'])]
        if len(candidates)!=1:raise ValueError('One actual referenced nav mode-info root required')
        entry=candidates[0];spans=[parser.spans[id(field)] for field in entry.fields]
        info=self.read_typed_fields(entry.type.h,[raw[a:b] for a,b in spans])
        if info['pendingReferences']:raise ValueError('Nav mode-info has unresolved references')
        pointer=info['object'];self.call(self.q(self.q(pointer)+0x28)-self.base,{r.UC_X86_REG_RDI:pointer})
        value=self.allocate(8);self.put(value,'Q',pointer)
        self.call(0x421340,{r.UC_X86_REG_RDI:selected_loaded['object']+0x30,
                           r.UC_X86_REG_RSI:0,r.UC_X86_REG_RDX:descriptor+8,r.UC_X86_REG_RCX:value})
        table=self.q(selected_loaded['object']+0x30)
        if self.u32(selected_loaded['object']+0x38)!=1 or self.u32(table)!=entry.type.h or self.q(table+8)!=pointer:
            raise ValueError('Original selected nav mode-info index insertion differs')
        result['navModeInfo']={'identity':entry.path.h,'typeHash':entry.type.h,'loaded':info,
                               'originalIndexInsertionRva':0x421340,'partialConfigIndexOnly':True,
                               'fields':[{'offset':a,'bytes':b-a,'sha256':sha(raw[a:b])} for a,b in spans]}
        return {**result,'identity':old['identity'],'modeHash':evidence['selectedMode']['modeHash'],
                'originalTypedFieldReads':True,'fullGlobalPostloadExecuted':False,'readyGlobalProviderEstablished':False}

    def initialize_screen_matrix_definition(self,fixture):
        types=initialize_shared_constant_types(self)
        index=fixture.read(fixture.cache/'research/global-asset-inputs/index.json')
        matches=[source for source in index['jobs'] if source['path']=='assets/shaders/shareddata.bin']
        if len(matches)!=1:raise ValueError('One installed shared-data source required')
        source=matches[0];data=fixture.raw(Path(source['source']))
        if sha(data)!=source['sha256']:raise ValueError('Installed shared-data BIN differs')
        import cdtb.binfile as binfile
        for name in ['binfields','bintypes','binentries','binhashes','binhashes_xxh3','binpaths']:
            getattr(binfile,'hashfile_'+name).hashes={}
        class Reader(binfile.BinReader):
            def __init__(self,*args):super().__init__(*args);self.spans={}
            def read_field(self,htype):
                start=self.f.tell();field=super().read_field(htype);self.spans[id(field)]=(start,self.f.tell());return field
        stream=io.BytesIO(data)
        if stream.read(4)!=b'PROP':raise ValueError('Original shared-data BIN required')
        parser=Reader(stream);_,_,kinds=parser.read_binfile_header()
        roots=[parser.read_binfile_entry(kind) for kind in kinds]
        selected=[root for root in roots if root.path.h==0x2fa9e31a]
        if len(selected)!=1:raise ValueError('Original PerFrameVertexCB definition required')
        root=selected[0];spans=[parser.spans[id(field)] for field in root.fields]
        loaded=self.read_typed_fields(root.type.h,[data[a:b] for a,b in spans])
        if loaded['pendingReferences']:raise ValueError('Self-contained shared constant definition required')
        self.put(PIPELINE_DEVICE_VTABLE+0x2b8,'Q',self.base+0x19139e0)
        self.put(PIPELINE_DEVICE_VTABLE+0x2d8,'Q',self.base+0x1928420)
        self.put(SERVICE_VTABLE+0x38,'Q',self.base+0x19299a0)
        self.call(0x1928620,{r.UC_X86_REG_RDI:DEVICE,r.UC_X86_REG_RSI:loaded['object']},0x1928872)
        name=self.allocate(14);self.u.mem_write(name,b'SCREEN_MATRIX\0')
        self.call(0x1913b10,{r.UC_X86_REG_RDI:DEVICE,r.UC_X86_REG_RSI:name})
        parameter=self.u.reg_read(r.UC_X86_REG_RAX)
        if not parameter or not self.library_pointer(parameter,0x38):raise ValueError('Original SCREEN_MATRIX registration missing')
        return {'typeInitialization':types,'identity':root.path.h,'loaded':loaded,'parameter':parameter,
                'originalCpuLayoutPrefix':[0x1928620,0x1928872],'backendConstantBufferPublished':False,
                'fields':[{'offset':a,'bytes':b-a,'sha256':sha(data[a:b])} for a,b in spans]}

    def check_block(self, uc, address, size, user):
        if CALLBACK_START <= address < CALLBACK_START+0x30 or address in [R8_UPDATE,FB_CREATE,FB_RETURN,PASS_BEGIN,PASS_END,VIEWPORT,UNIFORM_UPDATE,TEXTURE_UPDATE,PIPELINE_APPLY,MATERIAL_APPLY,DRAW_ARRAYS,BUFFER_CREATE,BUFFER_RETURN,LAYOUT_CREATE]:
            return
        return super().check_block(uc, address, size, user)

    def update_r8(self, uc, address, size, user):
        pointer=uc.reg_read(r.UC_X86_REG_RDI);gpu=self.native_textures.get(pointer)
        x,y,w,h,mip=[uc.reg_read(reg) for reg in [r.UC_X86_REG_ESI,r.UC_X86_REG_EDX,r.UC_X86_REG_ECX,r.UC_X86_REG_R8D,r.UC_X86_REG_R9D]]
        source=self.q(uc.reg_read(r.UC_X86_REG_RSP)+8)
        if not gpu or gpu['nativeFormat']!=0x10 or x or y or mip or (w,h)!=(gpu['width'],gpu['height']) or not self.library_pointer(source,w*h):
            raise ValueError('Unowned or unsupported native R8 update rectangle')
        pixels=bytes(uc.mem_read(source,w*h));gl=self.device.gl
        self.device.fn(gl,'glTexSubImage2D',None,C.c_uint,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p)
        gl.glBindTexture(0xde1,gpu['glHandle']);gl.glPixelStorei(0xcf5,1)
        gl.glTexSubImage2D(0xde1,0,0,0,w,h,0x1903,0x1401,C.create_string_buffer(pixels))
        gl.glBindFramebuffer(0x8d40,self.device.framebuffer)
        gl.glFramebufferTexture2D(0x8d40,0x8ce0,0xde1,gpu['glHandle'],0)
        out=C.create_string_buffer(w*h*4);gl.glReadPixels(0,0,w,h,0x1908,0x1401,out)
        if gl.glGetError() or out.raw[0::4]!=pixels:raise ValueError('Native R8 update GPU readback differs')
        gpu['gpuBytesVerified']=True;gpu['lastUpdateSha256']=sha(pixels)
        self.r8_updates.append({'pointer':pointer,'x':x,'y':y,'width':w,'height':h,'mip':mip,'pixelsHex':pixels.hex(),'sha256':sha(pixels),
                                'callerRva':self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base})
        self.ret()

    def writable_file_memory(self, address, size):
        return type(address) is int and type(size) is int and size >= 0 and 0x10000000 <= address <= 0x12000000-size

    def allocate(self, size, fill=0):
        if size < 0x100000:
            return super().allocate(size, fill)
        # The complete original navgrid owns multi-megabyte cell tables. Keep
        # the same finite 32MiB arena and no-reuse allocator, with an explicit
        # maximum allocation matching the established navgrid/WAD platform API.
        if not 0x100000 <= size <= 0x800000 or self.next_heap+size > 0x12000000:
            raise ValueError('Navgrid producer allocation exceeds owned arena')
        address=self.next_heap;self.next_heap=(address+size+15)&~15
        self.allocations[address]=size;self.u.mem_write(address,bytes([fill])*size)
        return address
    def graphics_call(self, uc, address, size, kind):
        if kind == 'header-return' and self.pending_graphics and self.pending_graphics.get('navTarget'):
            p=self.pending_graphics;request=p['input'];pointer=p['pointer']
            header=bytes(self.u.mem_read(pointer,0x11))
            if (int.from_bytes(header[8:10],'little')!=request['width'] or
                int.from_bytes(header[10:12],'little')!=request['height'] or header[12:]!=bytes([1,1,0,p['flags'],request['nativeFormat']])):
                raise ValueError('Original R8 header constructor differs')
            self.native_textures[pointer]=p['gpu']
            # Backend resource lifetime belongs to this GLES API port, like
            # the existing vertex-buffer port's counter. It is not game state.
            self.put(pointer+0x14,'I',1)
            if request['nativeFormat']==0x10 and self.r8_vtable is None:
                self.r8_vtable=self.allocate(0x38,0xa5)
                self.u.mem_write(self.r8_vtable,bytes(self.u.mem_read(self.q(pointer),0x38)))
                self.put(self.r8_vtable,'Q',R8_UPDATE)
            if request['nativeFormat']==0x10:self.put(pointer,'Q',self.r8_vtable)
            self.gpu_records.append({'pointer':pointer,'headerHex':header.hex(),'sourceDataSupplied':request['levels'][0][0] is not None,**p['gpu']})
            uc.reg_write(r.UC_X86_REG_RSP,p['stack']);uc.reg_write(r.UC_X86_REG_RAX,pointer)
            self.pending_graphics=None;self.ret();return
        fmt=uc.reg_read(r.UC_X86_REG_ESI)
        if kind != '2d' or fmt not in [2,0x10]:
            return super().graphics_call(uc, address, size, kind)
        if self.pending_graphics is not None or uc.reg_read(r.UC_X86_REG_RDI) != DEVICE:
            raise ValueError('Reentrant or foreign R8 request')
        w, h = uc.reg_read(r.UC_X86_REG_EDX), uc.reg_read(r.UC_X86_REG_ECX)
        mips, flags = uc.reg_read(r.UC_X86_REG_R8D), uc.reg_read(r.UC_X86_REG_R9D)
        sp = uc.reg_read(r.UC_X86_REG_RSP)
        rows = self.vector(self.q(sp+8), 8)
        if fmt==2 and (rows or flags!=2):return super().graphics_call(uc,address,size,kind)
        if mips != 1 or len(rows) not in [0,1] or flags != (1 if fmt==0x10 else 2):
            raise ValueError(f'Unsupported native R8 request mips={mips} flags={flags} rows={rows}')
        source = self.q(rows[0]) if rows else 0
        if source and not self.library_pointer(source, w*h):
            raise ValueError('R8 upload bytes are not owned')
        request = {'kind':'2d','nativeFormat':fmt,'width':w,'height':h,'layers':1,
                   'levels':[[bytes(self.u.mem_read(source,w*h)) if source else None]]}
        gpu = self.device.create(request)
        pointer = self.allocate(0x28,0xa5)
        self.pending_graphics={'pointer':pointer,'input':request,'gpu':gpu,'stack':sp,
                               'depth':1,'nativeType':0,'flags':flags,'navTarget':True}
        frame=sp-0x20
        self.put(frame,'Q',CALLBACKS['header-return']);self.put(frame+8,'Q',1);self.put(frame+16,'Q',1)
        for reg,value in [(r.UC_X86_REG_RDI,pointer),(r.UC_X86_REG_RSI,0),(r.UC_X86_REG_RDX,flags),
                          (r.UC_X86_REG_RCX,fmt),(r.UC_X86_REG_R8,w),(r.UC_X86_REG_R9,h),
                          (r.UC_X86_REG_RSP,frame),(r.UC_X86_REG_RIP,self.base+0x19175e0)]:
            uc.reg_write(reg,value)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:parser.add_argument(name,type=Path)
    parser.add_argument('--resolution',choices=['low','high'],default='high')
    args=parser.parse_args();cache=args.cache.resolve()
    folder=cache/'research/navmesh-producer-v29';folder.mkdir(parents=True,exist_ok=True)
    paths={Path(__file__).resolve(),Path(inspect.getfile(NativeVfxFixture)),Path(inspect.getfile(initialize_navgrid_world)),
           Path(inspect.getfile(GraphicsShaderCatalog)),Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(NativeGameModeData)),
           Path(inspect.getfile(NativeCharacterPostload)),args.client.resolve()}
    paths.update([Path(inspect.getfile(NativeVfxMeshContext)),Path(inspect.getfile(GraphicsMeshDevice))])
    paths.add(Path(inspect.getfile(update_material_uniforms)))
    tools=Path(__file__).resolve().parent
    paths.update(Path(module.__file__).resolve() for module in tuple(sys.modules.values())
                 if getattr(module,'__file__',None) and Path(module.__file__).suffix=='.py' and
                 Path(module.__file__).resolve().is_relative_to(tools))
    paths.update(Path(inspect.getfile(c)) for c in Control.__mro__ if c not in [Control,object])
    sources={str(p.resolve()):sha(p.read_bytes()) for p in paths}
    fixture=NativeVfxFixture(cache);device=MaskDevice(args.angle);n=shader=None;boundary=None;result={}
    try:
        shader=GraphicsShaderCatalog(cache/'public/latest-shared-shaders-navmask-v29',device)
        n=Control(fixture.assets/'decoder-16.21-macos',args.client,device=device,shader_catalog=shader)
        fixture.native=n
        # Load a pinned original CPU graph only to establish the shared fixture's
        # owned heaps. No effect is activated or counted by this observer.
        system_id='champions/karthus/10/8ad0cea5'
        ref=fixture.systems['systems'][system_id];graph=fixture.read(fixture.assets/'latest-vfx-system-assets'/ref['file'])
        n.load_prepared_system(graph)
        # The fixture's baseline restore may restore scratch pages touched by
        # independent original initialization. Install the owned API trap
        # instructions after that restore, before invoking their callers.
        for at in [R8_UPDATE,FB_CREATE,FB_RETURN,PASS_BEGIN,PASS_END,VIEWPORT,UNIFORM_UPDATE,TEXTURE_UPDATE,PIPELINE_APPLY,MATERIAL_APPLY,DRAW_ARRAYS,BUFFER_CREATE,BUFFER_RETURN,LAYOUT_CREATE]:
            n.u.mem_write(at,b'\xc3')
        for g in fixture.context['initializedGlobals']:n.u.mem_write(n.base+g['rva'],bytes.fromhex(g['bytesHex']))
        result['graphics']=n.initialize_graphics_context(0,False)
        n.put(PIPELINE_DEVICE_VTABLE+0xc8,'Q',BUFFER_CREATE)
        n.put(PIPELINE_DEVICE_VTABLE+0xe8,'Q',LAYOUT_CREATE)
        n.put(PIPELINE_DEVICE_VTABLE+0x190,'Q',n.base+0x1925950)
        n.put(PIPELINE_DEVICE_VTABLE+0x1a8,'Q',FB_CREATE)
        n.put(PIPELINE_DEVICE_VTABLE+0x1d8,'Q',PASS_BEGIN)
        n.put(PIPELINE_DEVICE_VTABLE+0x1e0,'Q',PASS_END)
        n.put(PIPELINE_DEVICE_VTABLE+0x218,'Q',VIEWPORT)
        n.put(PIPELINE_DEVICE_VTABLE+0xa0,'Q',UNIFORM_UPDATE)
        n.put(PIPELINE_DEVICE_VTABLE+0xa8,'Q',TEXTURE_UPDATE)
        n.put(PIPELINE_DEVICE_VTABLE+0x60,'Q',PIPELINE_APPLY)
        n.put(PIPELINE_DEVICE_VTABLE+0xb8,'Q',MATERIAL_APPLY)
        n.put(PIPELINE_DEVICE_VTABLE+0x228,'Q',DRAW_ARRAYS)
        # Explicit platform surface inputs for the otherwise unused default
        # render target. Execute the original width/height/format accessors;
        # these values are not replay settings or native scene readiness.
        n.put(SERVICE+0x50,'B',2)
        n.put(SERVICE+0x68,'II',128,128)
        for offset,entry in [(0x50,0x192f200),(0x58,0x192f210),(0x60,0x192f220)]:
            n.put(SERVICE_VTABLE+offset,'Q',n.base+entry)
        result['platformSurface']={'width':128,'height':128,'nativeFormat':2,'callerSupplied':True}
        n.put(PIPELINE_DEVICE_VTABLE+0x278,'Q',n.base+0x1914dc0)
        config=n.allocate(0x60);n.call(0x6143e0,{r.UC_X86_REG_RDI:config})
        # Explicit configuration input, not a readiness or source-byte write.
        if args.resolution=='low':n.put(config+0x24,'B',0)
        result['originalConfig']={'bytesHex':bytes(n.u.mem_read(config,0x60)).hex(),'highResolution':n.u.mem_read(config+0x24,1)[0]}
        result['modeInputs']=n.initialize_nav_mode(fixture)
        result['screenMatrixDefinition']=n.initialize_screen_matrix_definition(fixture)
        n.call(0x14aa563,{},0x14aa5f9)
        result['navgrid']=initialize_navgrid_world(fixture)
        runtime=result['navgrid']['runtime'];width=n.u32(runtime+0x6d8);height=n.u32(runtime+0x6dc)
        rgba=bytes(n.u.mem_read(n.q(runtime+0x5b0),width*height*4))
        result['source']={'width':width,'height':height,'rgbaHex':rgba.hex(),'sha256':sha(rgba),
                          'dirty':n.u.mem_read(runtime+0x5b8,1)[0]}
        result['clock']=n.supply_clock_inputs([1000000000]*3,0,[1,1])
        # Navmask construction only appends itself through the original base
        # registry method18106c0. Keep that independent constructor/publication
        # prefix; camera construction, scene readiness and scene dispatch are
        # neither needed nor claimed by this graphics-input control.
        scene=n.allocate(0x48,0xa5);n.call(0x1810380,{r.UC_X86_REG_RDI:scene})
        n.fragment(0x2877b2,0x2877b9,{r.UC_X86_REG_RBX:scene})
        result['scene']={'object':scene,'registered':n.q(n.base+0x246d550)==scene,
                         'originalBaseRegistryCtorAndPublicationOnly':True,'fullRenderSceneCtor':False}
        n.call(0x180ce50,{})
        renderer=n.q(n.base+0x256dec0)
        if n.allocations.get(renderer)!=0x180:raise ValueError('Original renderer resource registry constructor/publication differs')
        result['renderResourceRegistry']={'object':renderer,'constructorRva':0x180ce50,
                                          'fullRendererInitialization':False}
        viewport=n.allocate(0xa8,0xa5)
        n.fragment(0x1692244,0x1692294,{r.UC_X86_REG_RDI:viewport,r.UC_X86_REG_RBX:viewport})
        if n.q(n.base+0x246db78)!=viewport:raise ValueError('Original viewport-matrix owner prefix publication differs')
        result['viewportMatrixOwner']={'object':viewport,'prefix':[0x1692244,0x1692294],
                                       'unrelatedShaderConfigLoadsExecuted':False}
        pool=n.allocate(0x30,0xa5);n.call(0x17db040,{r.UC_X86_REG_RDI:pool})
        if n.q(n.base+0x24722b0)!=pool:raise ValueError('Original render-target pool publication differs')
        result['renderTargetPool']={'object':pool,'constructorRva':0x17db040,'originalPublication':True}
        fullscreen=n.allocate(0x20,0xa5)
        n.fragment(0x185f662,0x185f70a,{r.UC_X86_REG_RDI:fullscreen,r.UC_X86_REG_RBX:fullscreen,
                   r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0xb0})
        if n.q(n.base+0x246d240)!=fullscreen or n.q(fullscreen+0x10) not in n.native_mesh_layouts:
            raise ValueError('Original fullscreen geometry prefix differs')
        result['fullscreen']={'object':fullscreen,'originalGeometryPrefix':[0x185f662,0x185f70a],
                              'unrelatedBlitMaterialConstructorExecuted':False}
        # The fullscreen draw resolves the original named "normal" pass.
        # Execute its independent startup hash/publication, rather than
        # inventing a hash or modifying the material's native pass table.
        n.fragment(0x1807580,0x1807597,{r.UC_X86_REG_RSP:A['stack']-0x80})
        result['normalPass']={'hash':n.u32(n.base+0x256ddd4),
                              'originalInitializationPrefix':[0x1807580,0x1807597]}
        if not result['normalPass']['hash']:raise ValueError('Original normal pass initialization missing')
        n.fragment(0x744460,0x7444ee,{r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0x80})
        manager=n.q(n.base+0x2470d80)
        if n.allocations.get(manager)!=0x68:
            raise ValueError('Original navmask inline constructor/publication differs')
        n.call(0x7400c0,{r.UC_X86_REG_RDI:manager})
        result['manager']={'object':manager,'bytesHex':bytes(n.u.mem_read(manager,0x68)).hex()}
        result['updates']=[]
        for tick in [1000000000,1250000000,1500000000]:
            clock=n.supply_clock_inputs([tick]*3,0,[1,1])
            before=bytes(n.u.mem_read(manager,0x68)).hex()
            pass_start=len(n.render_passes);upload_start=len(n.r8_updates)
            n.call(0x7408f0,{r.UC_X86_REG_RDI:manager})
            after=bytes(n.u.mem_read(manager,0x68)).hex()
            passes=n.render_passes[pass_start:]
            if n.active_pass is not None or len(passes)!=5 or any(len(p['draws'])!=1 for p in passes):
                raise ValueError('Original producer must execute one Fade and four blur GPU draws')
            result['updates'].append({'clock':clock,'managerBeforeHex':before,'managerAfterHex':after,
                                      'firstPass':pass_start,'passCount':5,'r8UploadCount':len(n.r8_updates)-upload_start})
        result['updatedManagerHex']=bytes(n.u.mem_read(manager,0x68)).hex()
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),
                  'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base if n else None,
                  'registers':{k:n.u.reg_read(getattr(r,'UC_X86_REG_'+k.upper())) for k in ['rax','rbx','rdi','rsi','rdx','rcx','r8','r9','rbp','rsp']} if n else {}}
    finally:
        if n:
            result['debugOwnedApiState']={'r8Vtable':n.r8_vtable,
                'r8VtableHex':bytes(n.u.mem_read(n.r8_vtable,0x38)).hex() if n.r8_vtable else None,
                'r8CallbackHex':bytes(n.u.mem_read(R8_UPDATE,0x30)).hex(),
                'nativeTextureHeaders':{str(p):bytes(n.u.mem_read(p,0x28)).hex() for p in n.native_textures}}
            result['nativeTextures']={str(k):v for k,v in getattr(n,'native_textures',{}).items()}
            result['shaders']={str(k):v for k,v in getattr(n,'native_shaders',{}).items()}
            result['pipelines']={str(k):v for k,v in getattr(n,'native_pipelines',{}).items()}
            result['requests']=getattr(n,'material_binding_requests',[])
            result['r8Updates']=getattr(n,'r8_updates',[])
            result['platformFormattingCalls']=getattr(n,'character_format_calls',[])
            result['vertexBuffers']=getattr(n,'native_mesh_buffers',{})
            result['vertexLayouts']=getattr(n,'native_mesh_layouts',{})
            result['renderTargets']=getattr(n,'render_targets',{})
            result['framebufferGroups']=getattr(n,'framebuffer_groups',{})
            result['framebufferRequests']=getattr(n,'framebuffer_requests',[])
            result['renderPasses']=getattr(n,'render_passes',[])
            result['activeRenderPass']=getattr(n,'active_pass',None)
            result['materialUpdates']=getattr(n,'material_updates',[])
            result['pendingMaterialUpdate']=getattr(n,'pending_material_update',None)
        if shader:
            for path,h in shader.inputs.items():
                if sha(fixture.raw(Path(path)))!=h:raise ValueError('Shader source drift')
        for path,h in {**sources,**fixture.inputs}.items():
            if sha(Path(path).read_bytes())!=h:raise ValueError('Producer input drift')
        source_blocks=[{'rva':a,'size':b-a,'sha256':sha(n.image[a:b])} for a,b in
                       [(0x19217e0,0x19218b8),(0x19267a7,0x192682a),(0x1929acd,0x1929ae4),
                        (0x192c830,0x192c909),(0x20ee060,0x20ee148)]] if n else []
        report={'schema':1,'kind':'original-navmesh-producer-research-prefix','inputs':fixture.inputs,'sources':sources,
                'sourceBlocks':source_blocks,
                'result':result,'boundary':boundary,'originalBlocks':list(n.blocks.values()) if n else [],
                'scope':{'effectActivation':False,'decodedMapSelection':False,'runtimeConfigurationRecovered':False,
                         'runtimeAdmissionChanged':False,'originalProducerCompleted':boundary is None}}
        output=folder/f'native-{args.resolution}.json';output.write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(output),'boundary':boundary,'stages':list(result)}))
        if n and n.material_backend:n.material_backend.close()
        if n:n.mesh_backend.close()
        if n:
            for framebuffer in n.target_framebuffers:device.gl.glDeleteFramebuffers(1,C.byref(framebuffer))
        if shader:shader.close()
        device.close()
    if boundary:raise SystemExit(1)


if __name__=='__main__':main()

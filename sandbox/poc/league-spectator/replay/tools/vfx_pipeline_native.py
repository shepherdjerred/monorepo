"""Original effect activation with a GLES render-pipeline state provider."""
from unicorn import x86_const as r
import unicorn
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings
from vfx_graphics_native import NativeVfxGraphicsContext,DEVICE,DEVICE_VTABLE
from vfx_spawn_native import ADDRESSES as A

PIPELINE_RETURN=0x100f2100
MATERIAL_BINDINGS=0x100f2110
BINDINGS_RETURN=0x100f2120
PIPELINE_DEVICE_VTABLE=0x100f3000


class NativeVfxPipelineContext(NativeVfxGraphicsContext):
    def __init__(self,*args,**kwargs):
        self.thread_destructors=[];self.thread_destructor_calls=[];self.owned_thread_finished=False
        self.random_seed=None
        super().__init__(*args,**kwargs)
        self.pipeline_backend=GraphicsPipelineDevice(self.device,self.image)
        self.u.mem_write(PIPELINE_RETURN,b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.pipeline_return,begin=PIPELINE_RETURN,end=PIPELINE_RETURN)
        self.u.mem_write(MATERIAL_BINDINGS,b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.material_binding_request,begin=MATERIAL_BINDINGS,end=MATERIAL_BINDINGS)
        self.u.mem_write(BINDINGS_RETURN,b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.bindings_return,begin=BINDINGS_RETURN,end=BINDINGS_RETURN)
        self.material_backend=None
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.require_seed,
            begin=self.base+0x1490eb0,end=self.base+0x1490eb0)
        for at in [0x1913b10,0x1913c16]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_shared_parameter,
                begin=self.base+at,end=self.base+at)

    def observe_shared_parameter(self,uc,address,size,user):
        if address==self.base+0x1913b10:
            if self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE:raise ValueError('Unowned shared-parameter lookup')
            self.pending_shared_parameters.append(self.cstring(self.u.reg_read(r.UC_X86_REG_RSI)).decode('ascii'))
        else:
            self.shared_parameter_queries.append({'name':self.pending_shared_parameters.pop(),
                'nativeResult':self.u.reg_read(r.UC_X86_REG_RAX),'sceneProviderPopulated':False})

    def require_seed(self,uc,address,size,user):
        if self.random_seed is None or self.owned_thread_finished:
            raise ValueError('Native parent admission requires an explicit owned random seed')

    def set_random_seed(self,seed):
        if type(seed) is not int or not 0<=seed<2**64 or self.owned_thread_finished:
            raise ValueError('Explicit unsigned 64-bit random seed and live owned thread required')
        self.call(0x14910e0,{r.UC_X86_REG_RDI:seed})
        self.random_seed=seed
        return {'input':seed,'nativeSeed':self.q(self.base+self.birth_meta['random']['seedStorageRva']),
            'originalSeedFunction':0x14910e0,'matchSeedRecovered':False}

    def imported(self,uc,address,size,user):
        if self.source.imports[address-self.base]=='__tlv_atexit':
            callback=self.u.reg_read(r.UC_X86_REG_RDI);value=self.u.reg_read(r.UC_X86_REG_RSI)
            dso=self.u.reg_read(r.UC_X86_REG_RDX);sp=self.u.reg_read(r.UC_X86_REG_RSP)
            if (self.owned_thread_finished or callback!=self.base+0x2e2dd0 or value!=A['stream'] or dso!=self.base or
                    self.q(sp)-self.base not in [0x1490fae,0x149103d,0x1491099]):
                raise ValueError('Unowned native thread-local destructor registration')
            self.thread_destructors.append({'callbackRva':callback-self.base,'object':value,'dso':dso,
                'returnRva':self.q(sp)-self.base})
            self.ret();return
        return super().imported(uc,address,size,user)

    def finish_owned_thread(self):
        if self.owned_thread_finished:raise ValueError('Owned native thread already finished')
        for registration in reversed(self.thread_destructors):
            self.call(registration['callbackRva'],{r.UC_X86_REG_RDI:registration['object']})
            self.thread_destructor_calls.append(dict(registration))
        self.owned_thread_finished=True
        return list(self.thread_destructor_calls)

    def initialize_graphics_context(self,quality,graphics34b):
        state=super().initialize_graphics_context(quality,graphics34b)
        # The original CPU graphics base owns the shared-parameter maps. It is
        # larger than the minimal texture interface, so retain the port vtable
        # in a separate owned region before executing its complete constructor.
        self.u.mem_write(PIPELINE_DEVICE_VTABLE,bytes(self.u.mem_read(DEVICE_VTABLE,0x2b0)))
        self.call(0x1922690,{r.UC_X86_REG_RDI:DEVICE})
        self.put(DEVICE,'Q',PIPELINE_DEVICE_VTABLE)
        self.put(PIPELINE_DEVICE_VTABLE+0x88,'Q',MATERIAL_BINDINGS)
        self.put(PIPELINE_DEVICE_VTABLE+0x268,'Q',self.base+0x1913b10)
        return state

    def load_prepared_system(self,graph):
        if self.material_backend is not None:self.material_backend.close()
        super().load_prepared_system(graph)
        self.pending_pipeline=None;self.native_pipelines={};self.pipeline_backend.records=[]
        self.material_binding_requests=[]
        self.pending_binding=None;self.native_bindings={}
        self.random_seed=None
        self.pending_shared_parameters=[];self.shared_parameter_queries=[]
        self.material_backend=GraphicsMaterialBindings(self.device,self.shader_catalog) if self.shader_catalog else None

    def material_binding_request(self,uc,address,size,user):
        pipeline=self.u.reg_read(r.UC_X86_REG_RSI);values=self.u.reg_read(r.UC_X86_REG_RDX)
        if self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE or pipeline not in self.native_pipelines:
            raise ValueError('Unowned native material-binding request')
        if (self.pending_binding is not None or self.material_backend is None or
                not self.library_pointer(values,64) or self.u32(values+40) or self.u32(values+56)):
            raise ValueError('Unsupported/reentrant native material-binding vectors')
        uniforms=[];textures=[]
        for row in self.vector(values,24,4096):
            count=self.u32(row+16);pointer=self.q(row+8)
            if not 0<count<=4096 or not self.library_pointer(pointer,count*16):
                raise ValueError('Native material uniform exceeds owned bounds')
            uniforms.append({'name':self.cstring(self.q(row)).decode('ascii'),'count':count,
                'bytesHex':bytes(self.u.mem_read(pointer,count*16)).hex()})
        for row in self.vector(values+16,40,4096):
            texture=self.q(row+8)
            if texture not in self.native_textures:raise ValueError('Native material texture lacks a GPU resource')
            textures.append({'name':self.cstring(self.q(row)).decode('ascii'),'nativeTexture':texture,
                'glTexture':self.native_textures[texture]['glHandle'],
                'descriptorHex':bytes(self.u.mem_read(row+0x18,16)).hex()})
        request={'nativePipeline':pipeline,'uniforms':uniforms,'textures':textures,
            'headerHex':bytes(self.u.mem_read(values,64)).hex(),
            'returnRva':self.q(self.u.reg_read(r.UC_X86_REG_RSP))-self.base}
        self.material_binding_requests.append(request)
        state=self.native_pipelines[pipeline];program=self.native_programs[state['nativeProgram']]
        gpu=self.material_backend.create(request,state,program,self.native_textures)
        sp=self.u.reg_read(r.UC_X86_REG_RSP);pointer=self.allocate(0x28,0xa5)
        self.pending_binding={'gpu':gpu,'stack':sp,'pointer':pointer,'request':request}
        frame=sp-0x10;self.put(frame,'Q',BINDINGS_RETURN)
        for reg,value in [(r.UC_X86_REG_RDI,pointer),(r.UC_X86_REG_RSP,frame),
                (r.UC_X86_REG_RIP,self.base+0x1911010)]:self.u.reg_write(reg,value)

    def bindings_return(self,uc,address,size,user):
        pending=self.pending_binding
        if pending is None:raise ValueError('Unexpected native material-binding continuation')
        pointer=pending['pointer'];header=bytes(self.u.mem_read(pointer,0x22))
        if any(header[8:]):raise ValueError('Original material-binding base initialization differs')
        gpu=pending['gpu'];gpu.update(nativePointer=pointer,nativeHeaderHex=header.hex())
        self.native_bindings[pointer]=gpu;pending['request']['bindingPointer']=pointer
        self.u.reg_write(r.UC_X86_REG_RSP,pending['stack']);self.u.reg_write(r.UC_X86_REG_RAX,pointer)
        self.pending_binding=None;self.ret()

    def graphics_call(self,uc,address,size,kind):
        if kind!='pipeline':return super().graphics_call(uc,address,size,kind)
        descriptor=self.u.reg_read(r.UC_X86_REG_RSI);program=self.u.reg_read(r.UC_X86_REG_RDX)
        if (self.pending_pipeline is not None or self.pending_shader is not None or
                self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE or
                not self.library_pointer(descriptor,32) or program not in self.native_programs):
            raise ValueError('Unowned/reentrant native render-pipeline request')
        raw=bytes(self.u.mem_read(descriptor,32));sp=self.u.reg_read(r.UC_X86_REG_RSP)
        request={'descriptorHex':raw.hex(),'nativeProgram':program,
            'glProgram':self.native_programs[program]['glHandle'],'returnRva':self.q(sp)-self.base}
        self.pipeline_requests.append(request)
        gpu=self.pipeline_backend.create(raw,self.native_programs[program])
        pointer=self.allocate(0x30,0xa5)
        self.pending_pipeline={'gpu':gpu,'stack':sp,'pointer':pointer,'program':program,'request':request}
        frame=sp-0x10;self.put(frame,'Q',PIPELINE_RETURN)
        for reg,value in [(r.UC_X86_REG_RDI,pointer),(r.UC_X86_REG_RSP,frame),
                (r.UC_X86_REG_RIP,self.base+0x1916a80)]:self.u.reg_write(reg,value)

    def pipeline_return(self,uc,address,size,user):
        pending=self.pending_pipeline
        if pending is None:raise ValueError('Unexpected native pipeline continuation')
        pointer=pending['pointer'];gpu=pending['gpu'];header=bytes(self.u.mem_read(pointer,0x30))
        if header[8:40].hex()!=gpu['descriptorHex'] or self.q(pointer+0x28)!=pending['program']:
            raise ValueError('Original pipeline base constructor differs')
        gpu.update(nativePointer=pointer,nativeHeaderHex=header.hex(),nativeProgram=pending['program'])
        self.native_pipelines[pointer]=gpu;pending['request']['pipelinePointer']=pointer
        self.u.reg_write(r.UC_X86_REG_RSP,pending['stack']);self.u.reg_write(r.UC_X86_REG_RAX,pointer)
        self.pending_pipeline=None;self.ret()

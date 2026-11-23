"""Original Shared texture row registration against the owned real GLES device.

Only the explicit recorded source row is registered. This is a cold source
control; no complete renderer bootstrap or live color-remap state is supplied.
"""
from unicorn import x86_const as r
from vfx_graphics_native import DEVICE,DEVICE_VTABLE,SERVICE_VTABLE
from vfx_spawn_native import ADDRESSES as A
from character_graphics_native import NativeCharacterGraphics
from graphics_float4_texture_device import GraphicsFloat4TextureDevice
from native_float4_texture_upload import upload_float4_texture
from native_pipeline_description import NativePipelineDescription
from graphics_material_bindings import GraphicsMaterialBindings
from original_sampler_gpu import capture_sampler_arguments,compare_sampler_projection
import unicorn


class NativeShaderGlobalGraphics(NativeCharacterGraphics):
    object=NativePipelineDescription.object
    def message(self,uc,address,size,user):
        receiver=uc.reg_read(r.UC_X86_REG_RDI)
        selector=self.cstring(uc.reg_read(r.UC_X86_REG_RSI)).decode('ascii')
        if receiver==getattr(self,'sampler_device_token',None):
            if selector!='newSamplerStateWithDescriptor:':raise ValueError('Unsupported owned sampler device message')
            descriptor=uc.reg_read(r.UC_X86_REG_RDX);obj=self.descriptor_objects.get(descriptor)
            if obj is None or obj['kind']!='sampler':raise ValueError('Unowned original sampler resource descriptor')
            raw=bytes.fromhex(self.shared_sampler_arguments['descriptorHex'])
            gpu=self.sampler_backend.sampler(raw);compared=compare_sampler_projection(raw,obj['fields'],gpu)
            pointer=self.allocate(8);self.shared_sampler_resources[pointer]={'nativeArguments':dict(self.shared_sampler_arguments),'nativeFields':dict(obj['fields']),'gpu':gpu,'comparedGpuParameters':compared,'ownedReferenceCount':1}
            self.shared_sampler_description={'fields':dict(obj['fields']),'messages':list(self.descriptor_messages),'originalSamplerPrefix':[0x191ff70,0x19202ec],'originalBackendCpuPrefix':[0x1922512,0x192264a],'metalResourceCreated':False,'glesSamplerCreated':True}
            uc.reg_write(r.UC_X86_REG_RAX,pointer);self.ret();return
        return NativePipelineDescription.message(self,uc,address,size,user)

    def __init__(self,*args):
        self.descriptor_active=False
        super().__init__(*args)

    def imported(self,uc,address,size,user):
        if self.descriptor_active and self.source.imports[address-self.base]=='_objc_opt_new':
            token=uc.reg_read(r.UC_X86_REG_RDI)
            if token not in self.descriptor_classes:raise ValueError('Unowned original sampler descriptor class')
            pointer=self.object(self.descriptor_classes[token]);self.sampler_pointer=pointer
            uc.reg_write(r.UC_X86_REG_RAX,pointer);self.ret();return
        return super().imported(uc,address,size,user)

    def graphics_call(self,uc,address,size,kind):
        if kind=='device' and getattr(self,'shared_backend',None):
            if uc.reg_read(r.UC_X86_REG_RDI)!=0x100f1000:raise ValueError('Unowned source graphics service')
            uc.reg_write(r.UC_X86_REG_RAX,self.shared_backend);self.ret();return
        if kind in ['2d','array','cube'] and uc.reg_read(r.UC_X86_REG_ESI)==24:
            return upload_float4_texture(self,uc,kind)
        return super().graphics_call(uc,address,size,kind)

    def close_graphics(self):
        if getattr(self,'sampler_backend',None):self.sampler_backend.close()
        return super().close_graphics()


def observe_shared_remap_registration(n,records,angle):
    n.shared_registration_stages=[]
    def stage(name):n.shared_registration_stages.append({'stage':name,'graphicsService':n.q(n.base+0x256e1b8)})
    graphics=n.initialize_character_graphics(angle)
    stage('original-default-textures-created')
    n.float4_texture_backend=GraphicsFloat4TextureDevice(n.device,n.image)
    # The old upload-only ABI placed its table inside the otherwise unused
    # device tail. The full CPU constructor owns that tail, so preserve the
    # admitted hardware callbacks in a separately owned, non-overlapping table.
    vtable=n.allocate(0x300,0xa5)
    n.u.mem_write(vtable,bytes(n.u.mem_read(DEVICE_VTABLE,0x2b0)))
    # Independent original CPU base constructor initializes each map/container,
    # including its original max-load factors. No guessed map layout/default.
    backend=n.allocate(0xec0,0xa5)
    n.call(0x1922690,{r.UC_X86_REG_RDI:backend})
    # The original backend CPU constructor prefix initializes the exact sampler
    # cache before its unrelated platform dispatch-semaphore allocation.
    n.sampler_device_token=n.allocate(8);n.sampler_backend=GraphicsMaterialBindings(n.device,None);n.shared_sampler_resources={}
    n.call(0x1922512,{r.UC_X86_REG_RBX:backend,r.UC_X86_REG_R14:n.sampler_device_token},end=0x192264a)
    n.put(backend,'Q',vtable);n.shared_backend=backend
    stage('original-cpu-base-constructor')
    # Original independent allocation/default stores for the Shared default
    # texture cache, before the unrelated full-device bootstrap tail call.
    if n.q(n.base+0x247da80):raise ValueError('Original Shared default texture cache must be cold')
    n.call(0x19125aa,{},end=0x19125d8)
    stage('original-default-cache-constructor')
    default_cache=n.q(n.base+0x247da80)
    if n.allocations.get(default_cache)!=0x30:raise ValueError('Original Shared default texture cache constructor did not publish its owned object')
    methods={}
    for offset in [0x278,0x280,0x2c8,0x2e8]:
        original=n.q(n.base+0x2408570+offset)
        if not n.base<=original<n.base+0x1fef000:raise ValueError('Original Shared texture virtual method is not original executable code')
        n.put(vtable+offset,'Q',original);methods[hex(offset)]=original-n.base
    # The original platform service constructor installs this exact virtual.
    # It returns its native backend identity, rather than a supplied success.
    n.put(SERVICE_VTABLE+0x38,'Q',n.base+0x19299a0)
    if n.q(n.base+0x2408908+0x38)!=n.base+0x19299a0:raise ValueError('Original platform service backend identity virtual differs')
    if n.source.data_imports.get(0x22e0408)!='_objc_msgSend':raise ValueError('Original sampler descriptor message import differs')
    n.descriptor_objects={};n.descriptor_messages=[];n.sampler_pointer=None
    token=n.allocate(8);n.descriptor_classes={token:'sampler'}
    n.put(n.base+0x246b7b0,'Q',token)
    message=n.allocate(16);n.u.mem_write(message,b'\xc3');n.put(n.base+0x22e0408,'Q',message)
    n.u.hook_add(unicorn.UC_HOOK_CODE,n.message,begin=message,end=message)
    n.descriptor_active=True
    def capture_sampler(uc,address,size,user):n.shared_sampler_arguments=capture_sampler_arguments(n)
    n.u.hook_add(unicorn.UC_HOOK_CODE,capture_sampler,begin=n.base+0x191ff70,end=n.base+0x191ff70)
    if n.source.data_imports.get(0x22e0410)!='_objc_release':raise ValueError('Original sampler release import differs')
    release=n.allocate(16);n.u.mem_write(release,b'\xc3');n.put(n.base+0x22e0410,'Q',release)
    def release_descriptor(uc,address,size,user):
        pointer=uc.reg_read(r.UC_X86_REG_RDI)
        if pointer in n.descriptor_objects:del n.descriptor_objects[pointer]
        elif pointer in n.shared_sampler_resources and n.shared_sampler_resources[pointer]['ownedReferenceCount']>0:n.shared_sampler_resources[pointer]['ownedReferenceCount']-=1
        else:raise ValueError('Unowned original sampler descriptor/resource release')
        n.ret()
    n.u.hook_add(unicorn.UC_HOOK_CODE,release_descriptor,begin=release,end=release)
    if n.source.data_imports.get(0x22e0418)!='_objc_retain':raise ValueError('Original sampler retain import differs')
    retain=n.allocate(16);n.u.mem_write(retain,b'\xc3');n.put(n.base+0x22e0418,'Q',retain)
    def retain_resource(uc,address,size,user):
        pointer=uc.reg_read(r.UC_X86_REG_RDI)
        if pointer not in n.shared_sampler_resources or n.shared_sampler_resources[pointer]['ownedReferenceCount']<=0:raise ValueError('Unowned original sampler resource retain')
        n.shared_sampler_resources[pointer]['ownedReferenceCount']+=1;uc.reg_write(r.UC_X86_REG_RAX,pointer);n.ret()
    n.u.hook_add(unicorn.UC_HOOK_CODE,retain_resource,begin=retain,end=retain)
    roots=[row for row in records if row['ownerPathHash']=='85390927' and row['classHash']=='344a9a75']
    if len(roots)!=1 or roots[0]['status']!='original-typed-root-fields-read':raise ValueError('Complete original Shared shader root required')
    root=roots[0]['observation']['object'];pointer,count=n.q(root+0x18),n.u32(root+0x20)
    if not 0<count<=1024 or not n.library_pointer(pointer,count*0x40):raise ValueError('Original Shared texture declarations escaped bounds')
    selected=[]
    for index in range(count):
        row=pointer+index*0x40;name_pointer,length=n.q(row),n.u32(row+8)
        if not 0<length<=256 or not n.library_pointer(name_pointer,length):raise ValueError('Original Shared texture name escaped bounds')
        name=bytes(n.u.mem_read(name_pointer,length)).decode('ascii')
        if name=='PIXEL_COLOR_REMAP_RAMP':selected.append((index,row,name))
    if len(selected)!=1:raise ValueError('Unique original Shared remap declaration required')
    index,row,name=selected[0]
    # This complete original virtual consumer receives the actual typed row.
    # Registration is neither replaced by a successful callback nor hand-filled.
    n.call(methods['0x2c8'],{r.UC_X86_REG_RDI:backend,r.UC_X86_REG_RSI:row})
    string=n.q(row)
    n.call(methods['0x278'],{r.UC_X86_REG_RDI:backend,r.UC_X86_REG_RSI:string})
    view=n.u.reg_read(r.UC_X86_REG_RAX)
    if not view:raise ValueError('Original named Shared remap registration did not publish its view')
    owner=n.allocate(0xc0,0xa5);frame=A['stack']-8
    n.call(0x7456bd,{r.UC_X86_REG_R14:owner,r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x100},end=0x74571d)
    if n.q(owner+0xa8)!=view:raise ValueError('Original remap caller did not retain original registered view')
    header=n.q(view+8)
    resources=[resource for resource in n.gpu_records if resource['pointer']==header]
    if len(resources)!=1 or not resources[0]['gpuBytesVerified']:raise ValueError('Original remap view lacks an exact GPU-verified native texture')
    negatives=[]
    absent=n.allocate_text('SCOUT_UNREGISTERED_TEXTURE_NEGATIVE_CONTROL')
    n.call(methods['0x278'],{r.UC_X86_REG_RDI:backend,r.UC_X86_REG_RSI:absent})
    if n.u.reg_read(r.UC_X86_REG_RAX):raise ValueError('Unknown original Shared name unexpectedly resolved')
    negatives.append({'kind':'unregistered-original-name','result':0})
    original_resources=len(n.shared_sampler_resources)
    for label,mode,address in [('unsupported-border-address',1,3),('unsupported-comparison-mode',2,1)]:
        n.put(A['stack']+8,'4Q',1,0,mode,1)
        try:n.call(0x191ff70,{r.UC_X86_REG_RDI:backend,r.UC_X86_REG_RSI:address,r.UC_X86_REG_RDX:1,r.UC_X86_REG_RCX:1,r.UC_X86_REG_R8:1,r.UC_X86_REG_R9:0})
        except ValueError as error:
            if not any(text in str(error) for text in ['Unadmitted native material sampler addressing','Unsupported original sampler device argument']):raise
            negatives.append({'kind':label,'rejected':str(error)})
        else:raise ValueError('Unsupported original sampler capability was admitted')
        if len(n.shared_sampler_resources)!=original_resources:raise ValueError('Unsupported original sampler published a GPU resource')
    return {'graphics':graphics,'originalCpuBaseConstructorRva':0x1922690,'originalDefaultCachePrefix':[0x19125aa,0x19125d8],'defaultCache':default_cache,'methods':methods,'originalOwnerPathHash':'85390927','sourceTextureIndex':index,'nativeDefinition':row,'name':name,'nativeView':view,'header':header,'resource':resources[0],'originalRemapCaller':[0x7456bd,0x74571d],'negativeControls':negatives,'scope':{'oneOriginalSourceRowRegistered':True,'completeGlobalRegistryInitialized':False,'coldRemapInitializationExecuted':True,'dynamicRemapRecovered':False,'actualScenePredicates':False,'nativeRendererAdmitted':False}}

"""Connect cold character controls to the existing real GLES resource bridge."""
import unicorn
from unicorn import x86_const as r
from spell_preload_native import NativeSpellPreload
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from vfx_graphics_native import NativeVfxGraphicsContext,SERVICE,SERVICE_VTABLE,DEVICE,DEVICE_VTABLE,CALLBACKS,GRAPHICS_STACK_PROBES,DEFAULT_TAGS
from vfx_mesh_native import NativeVfxMeshContext,BUFFER_CREATE,BUFFER_RETURN
from vfx_spawn_native import ADDRESSES
from libcpp_string_native import ASSIGN_C_STRING,assign_c_string


class NativeCharacterGraphics(NativeSpellPreload):
    graphics_call = NativeVfxGraphicsContext.graphics_call
    shader_call = NativeVfxGraphicsContext.shader_call
    vector = NativeVfxGraphicsContext.vector
    pixels = NativeVfxGraphicsContext.pixels
    observe_file_open = NativeVfxGraphicsContext.observe_file_open
    buffer_create = NativeVfxMeshContext.buffer_create
    buffer_return = NativeVfxMeshContext.buffer_return

    def __init__(self,*args):
        self.device,self.mesh_backend = None,None
        self.shader_catalog = None
        self.gpu_records,self.native_textures = [],{}
        self.pending_graphics,self.pending_shader = None,None
        self.native_shaders,self.native_programs = {},{}
        self.pipeline_requests = []
        self.pending_mesh_buffer = None
        self.native_mesh_buffers = {}
        self.file_requests = []
        self.direct_file_frames = {}
        self.libcpp_string_calls = []
        super().__init__(*args)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_file_open,
                        begin=self.base+0x1479d20,end=self.base+0x1479d20)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_direct_file,
                        begin=self.base+0x1479f10,end=self.base+0x1479f10)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.finish_direct_file,
                        begin=self.base+0x1479f55,end=self.base+0x1479f55)

    def observe_direct_file(self,uc,address,size,user):
        stack = uc.reg_read(r.UC_X86_REG_RSP)
        record = {'path':self.cstring(uc.reg_read(r.UC_X86_REG_RDI)).decode('utf-8'),
                  'returnRva':self.q(stack)-self.base,'kind':'original-raw-file-read','success':None}
        self.file_requests.append(record)
        self.direct_file_frames[stack] = record

    def finish_direct_file(self,uc,address,size,user):
        record = self.direct_file_frames.pop(uc.reg_read(r.UC_X86_REG_RBP)+8,None)
        result = uc.reg_read(r.UC_X86_REG_RAX)&255
        if record is None or result not in [0,1]:
            raise ValueError('Original raw file-read return escaped its observed call')
        record['success'] = bool(result)

    def imported(self,uc,address,size,user):
        if self.source.imports[address-self.base] == ASSIGN_C_STRING:
            destination,source = uc.reg_read(r.UC_X86_REG_RDI),uc.reg_read(r.UC_X86_REG_RSI)
            self.libcpp_string_calls.append(assign_c_string(self,destination,source))
            uc.reg_write(r.UC_X86_REG_RAX,destination)
            self.ret()
            return
        if self.source.imports[address-self.base] == '____chkstk_darwin':
            count,stack = uc.reg_read(r.UC_X86_REG_RAX),uc.reg_read(r.UC_X86_REG_RSP)
            caller = self.q(stack)-self.base
            if caller in GRAPHICS_STACK_PROBES:
                if count != GRAPHICS_STACK_PROBES[caller] or not 0x10008000 <= stack-count <= stack <= 0x10010008:
                    raise ValueError('Character graphics stack probe escaped owned pages')
                for at in range(stack-count,stack+1,4096):uc.mem_read(at,1)
                self.ret()
                return
        return super().imported(uc,address,size,user)

    def initialize_character_graphics(self,angle):
        if self.device is not None or self.q(self.base+0x256e1b8):
            raise ValueError('Character graphics provider already exists')
        self.device = GraphicsTextureDevice(angle)
        self.mesh_backend = GraphicsMeshDevice(self.device)
        for name,address in CALLBACKS.items():
            self.u.mem_write(address,b'\xc3')
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.graphics_call,begin=address,end=address,user_data=name)
        for address,callback in [(BUFFER_CREATE,self.buffer_create),(BUFFER_RETURN,self.buffer_return)]:
            self.u.mem_write(address,b'\xc3')
            self.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=address,end=address)
        # Unsupported methods retain poison addresses. The only admitted
        # resources here are verified textures and static vertex buffers.
        self.u.mem_write(SERVICE_VTABLE,bytes([0xa5])*0x40)
        self.u.mem_write(DEVICE_VTABLE,bytes([0xa5])*0x2b0)
        self.put(SERVICE,'Q',SERVICE_VTABLE)
        self.put(SERVICE_VTABLE+0x30,'Q',CALLBACKS['device'])
        self.put(DEVICE,'Q',DEVICE_VTABLE)
        for offset,name in [(0x108,'2d'),(0x110,'array'),(0x120,'cube')]:
            self.put(DEVICE_VTABLE+offset,'Q',CALLBACKS[name])
        self.put(DEVICE_VTABLE+0xc8,'Q',BUFFER_CREATE)
        if self.q(self.base+0x2408570+0x2a8) != self.base+0x1915000:
            raise ValueError('Original empty capability query changed')
        self.put(DEVICE_VTABLE+0x2a8,'Q',self.base+0x1915000)
        self.put(self.base+0x256e1b8,'Q',SERVICE)
        if not self.q(self.base+0x24712c8):self.initialize_resource_groups()
        frame = ADDRESSES['stack']-8
        for start,end in [(0x14e40fd,0x14e4137),DEFAULT_TAGS]:
            self.call(start,{r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x80},end)
        texture = self.q(self.base+0x246fdf0)
        resumed = bool(texture)
        if texture:
            if (self.allocations.get(texture) != 0x108 or
                    any(self.q(texture+offset) for offset in range(0xa0,0x100,8))):
                raise ValueError('Expected untouched original texture-manager data prefix')
            # Resume its original constructor remainder. The prefix was
            # already executed before the selected graph snapshot was taken.
            frame = ADDRESSES['stack']-8
            self.call(0x17e240c,{r.UC_X86_REG_RBX:texture,r.UC_X86_REG_RBP:frame,
                                r.UC_X86_REG_RSP:frame-0x68},0x17e2470)
        else:
            texture = self.allocate(0x108)
            self.call(0x17e25a0,{r.UC_X86_REG_RDI:texture})
        if len(self.gpu_records) != 10 or self.pending_graphics is not None or not self.q(texture+0xd8):
            raise ValueError('Original default texture creation did not finish with verified GPU resources')
        model = self.allocate(0x128)
        self.u.mem_write(model+0x28,bytes([0xa5])*0x100)
        self.call(0x184e710,{r.UC_X86_REG_RDI:model})
        buffer = self.q(model+0x20)
        if (self.q(self.base+0x2471398) != model or buffer not in self.native_mesh_buffers or
                bytes(self.u.mem_read(model+0x28,0x100)) != bytes([0xa5])*0x100):
            raise ValueError('Original model-resource manager lacks its owned GPU buffer/guard')
        return {'textureManager':texture,'modelResourceManager':model,'defaultTextures':len(self.gpu_records),
                'verifiedGpuBuffers':len(self.native_mesh_buffers),'modelDefaultBuffer':buffer,
                'originalModelResourceConstructorCompleted':True,'texturePrefixResumed':resumed,
                'originalTextureConstructorRemainderExecuted':True,'gpuBytesVerified':True,
                'originalMetalDeviceExecuted':False,'allGraphicsMethodsImplemented':False,
                'fullAssetReadinessVerified':False,'mainViewerExpanded':False}

    def close_graphics(self):
        if self.mesh_backend is not None:self.mesh_backend.close()
        if self.device is not None:self.device.close()

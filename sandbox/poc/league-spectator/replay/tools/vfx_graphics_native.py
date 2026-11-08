"""Port the native texture-device interface to real offscreen GLES resources.

Original registry/default/resource functions and the texture-header constructor
execute unchanged. The supplied device implements uploads; Metal/Objective-C is
not emulated. Unsupported device methods remain unmapped poison.
"""
from unicorn import x86_const as r
import unicorn
from vfx_resource_native import NativeVfxResourceContext,RESOURCE_MANAGER_INPUT_BLOCKS
from vfx_object_native import MANAGER
from vfx_spawn_native import ADDRESSES as A
from native_texture_dependencies import discover_native_texture_paths

SERVICE, SERVICE_VTABLE = 0x100f1000,0x100f1100
DEVICE, DEVICE_VTABLE = 0x100f1400,0x100f1500
CALLBACKS={name:0x100f2000+i*16 for i,name in enumerate(['device','2d','array','cube','header-return',
    'vertex','pixel','program','shader-return','program-return','pipeline'])}
DEFAULT_TAGS=(0x18081e1,0x1808439)
MATERIAL_PASS_STARTUP=(0x16e2a89,0x16e2e89)
GRAPHICS_STACK_PROBES={0x1912040:0x1028,0x17dc355:0x1010}


class NativeVfxGraphicsContext(NativeVfxResourceContext):
    def __init__(self,*args,device,shader_catalog=None):
        self.device=device
        self.shader_catalog=shader_catalog
        super().__init__(*args)
        for name,address in CALLBACKS.items():
            self.u.mem_write(address,b'\xc3')
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.graphics_call,begin=address,end=address,user_data=name)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_file_open,
            begin=self.base+0x1479d20,end=self.base+0x1479d20)

    def observe_file_open(self,uc,address,size,user):
        # Observation only: the original resource loader and filesystem calls
        # still execute. Keep the requested path when the absent file provider
        # later fails, rather than guessing the missing resource from the spell.
        wrapper=self.u.reg_read(r.UC_X86_REG_RSI)
        if not self.library_pointer(wrapper,8):raise ValueError('Unowned native file-open path wrapper')
        self.file_requests.append({'path':self.cstring(self.q(wrapper)).decode('utf-8'),
            'returnRva':self.q(self.u.reg_read(r.UC_X86_REG_RSP))-self.base})

    def imported(self,uc,address,size,user):
        # The original material cache serializes its define set using this
        # bounded stack buffer. Model the platform page probe, not its caller.
        if self.source.imports[address-self.base]=='____chkstk_darwin':
            count=self.u.reg_read(r.UC_X86_REG_RAX);sp=self.u.reg_read(r.UC_X86_REG_RSP)
            return_rva=self.q(sp)-self.base
            if return_rva in GRAPHICS_STACK_PROBES:
                if count!=GRAPHICS_STACK_PROBES[return_rva] or not 0x10008000<=sp-count<=sp<=0x10010008:
                    raise ValueError('Material define stack probe exceeds owned stack')
                for at in range(sp-count,sp+1,4096):self.u.mem_read(at,1)
                self.library_calls.append({'name':'____chkstk_darwin','result':count,
                    'returnRva':return_rva})
                self.ret();return
        return super().imported(uc,address,size,user)

    def load_prepared_system(self,graph):
        super().load_prepared_system(graph)
        self.gpu_records=[];self.pending_graphics=None;self.native_textures={}
        self.texture_names={};self.preloaded_textures=[]
        self.pending_shader=None;self.native_shaders={};self.native_programs={}
        self.pipeline_requests=[]
        self.file_requests=[]

    def initialize_graphics_context(self,quality,graphics34b):
        self.initialize_owned_manager(quality,graphics34b)
        for start,end in RESOURCE_MANAGER_INPUT_BLOCKS:
            self.fragment(start,end,{r.UC_X86_REG_RDI:MANAGER,r.UC_X86_REG_RSI:0,
                r.UC_X86_REG_RBX:MANAGER,r.UC_X86_REG_XMM0:0,
                r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0xe8})
        self.fragment(0x14e40fd,0x14e4137,{r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0x80})
        self.fragment(*DEFAULT_TAGS,{r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0x80})
        # This independent startup block owns the seven shared pass names and
        # their define vectors. Full material creation consumes this table;
        # leaving its BSS zeroed incorrectly supplies a null pass name.
        self.fragment(*MATERIAL_PASS_STARTUP,{r.UC_X86_REG_RBP:A['stack']-8,
            r.UC_X86_REG_RSP:A['stack']-0x80})
        self.u.mem_write(SERVICE_VTABLE,bytes([0xa5])*0x40)
        self.u.mem_write(DEVICE_VTABLE,bytes([0xa5])*0x2b0)
        self.put(SERVICE,'Q',SERVICE_VTABLE);self.put(SERVICE_VTABLE+0x30,'Q',CALLBACKS['device'])
        self.put(DEVICE,'Q',DEVICE_VTABLE)
        for offset,name in [(0x108,'2d'),(0x110,'array'),(0x120,'cube')]:
            self.put(DEVICE_VTABLE+offset,'Q',CALLBACKS[name])
        if self.shader_catalog is not None:
            for offset,name in [(0x138,'vertex'),(0x148,'pixel'),(0x168,'program')]:
                self.put(DEVICE_VTABLE+offset,'Q',CALLBACKS[name])
            self.put(DEVICE_VTABLE+0x50,'Q',CALLBACKS['pipeline'])
        # The actual backend's capability virtual is the original no-op method.
        if self.q(self.base+0x2408570+0x2a8)!=self.base+0x1915000:
            raise ValueError('Native graphics capability method differs')
        self.put(DEVICE_VTABLE+0x2a8,'Q',self.base+0x1915000)
        self.put(self.base+0x256e1b8,'Q',SERVICE)
        self.call(0x1474a30,{r.UC_X86_REG_RDI:0xd0})
        self.shader_cache=self.u.reg_read(r.UC_X86_REG_RAX)
        self.call(0x17dcb90,{r.UC_X86_REG_RDI:self.shader_cache})
        self.call(0x1474a30,{r.UC_X86_REG_RDI:0x58})
        self.material_layout_cache=self.u.reg_read(r.UC_X86_REG_RAX)
        self.call(0x17d0130,{r.UC_X86_REG_RDI:self.material_layout_cache})
        self.call(0x1474a30,{r.UC_X86_REG_RDI:0x108})
        self.texture_manager=self.u.reg_read(r.UC_X86_REG_RAX)
        self.call(0x17e25a0,{r.UC_X86_REG_RDI:self.texture_manager})
        self.call(0x1474a30,{r.UC_X86_REG_RDI:0x90})
        self.material_cache=self.u.reg_read(r.UC_X86_REG_RAX)
        self.call(0x17c3fd0,{r.UC_X86_REG_RDI:self.material_cache})
        self.call(0x1474a30,{r.UC_X86_REG_RDI:0xb8})
        self.material_asset_cache=self.u.reg_read(r.UC_X86_REG_RAX)
        self.call(0x17cdf40,{r.UC_X86_REG_RDI:self.material_asset_cache})
        if len(self.gpu_records)!=10 or self.pending_graphics is not None:
            raise ValueError('Original default texture creation did not complete')
        return self.resource_context_state()

    def register_rgba_texture(self,path,pixels,width,height):
        """Register a supplied decoded base level through the original cache.

        This does not claim the original TEX loader or mip-chain reconstruction.
        """
        if len(pixels)!=width*height*4:
            raise ValueError('Exact decoded texture pixels and path required')
        return self.register_rgba_levels(path,[[pixels]],width,height,'2d')

    def register_rgba_cube_texture(self,path,levels,width):
        """Register all six authored faces/mips through the original cube cache."""
        return self.register_rgba_levels(path,levels,width,width,'cube')

    def register_rgba_levels(self,path,levels,width,height,kind):
        if not isinstance(path,str) or not path or kind not in ['2d','cube']:
            raise ValueError('Exact decoded texture path and supported dimension required')
        text=path.encode();string=self.allocate(len(text)+1);self.u.mem_write(string,text+b'\0')
        name=self.allocate(16,0xa5);self.put(name,'QII',string,len(text),len(text)+1)
        self.call(0x1499af0,{r.UC_X86_REG_RDI:name});key=self.u.reg_read(r.UC_X86_REG_RAX)
        if not key or key in self.texture_names:raise ValueError('Duplicate or null native texture resource key')
        self.texture_names[key]=path
        # The native format table maps engine format 2 to BGRA8_UNORM. The
        # prepared bitmap is RGBA, so preserve its exact channels at this ABI.
        native_levels=[]
        for level in levels:
            converted=[]
            for pixels in level:
                bgra=bytearray(pixels);bgra[0::4],bgra[2::4]=pixels[2::4],pixels[0::4]
                converted.append(bytes(bgra))
            native_levels.append(converted)
        request={'kind':kind,'nativeFormat':2,'width':width,'height':height,'layers':6 if kind=='cube' else 1,'levels':native_levels}
        gpu=self.device.create(request);pointer=self.allocate(0x28,0xa5)
        self.put(A['stack']+8,'Q',1);self.put(A['stack']+16,'Q',len(levels))
        self.call(0x19175e0,{r.UC_X86_REG_RDI:pointer,r.UC_X86_REG_RSI:2 if kind=='cube' else 0,r.UC_X86_REG_RDX:0,
            r.UC_X86_REG_RCX:2,r.UC_X86_REG_R8:width,r.UC_X86_REG_R9:height})
        self.native_textures[pointer]=gpu
        key_box=self.allocate(8);output=self.allocate(8);self.put(key_box,'Q',key)
        self.call(0x17deec0 if kind=='cube' else 0x17deba0,{r.UC_X86_REG_RDI:output,r.UC_X86_REG_RSI:self.texture_manager,
            r.UC_X86_REG_RDX:key_box,r.UC_X86_REG_RCX:0,r.UC_X86_REG_R8:pointer,r.UC_X86_REG_R9:0})
        wrapper=self.q(output)
        if not wrapper or self.q(wrapper+0x28)!=pointer or self.u.mem_read(wrapper+0x18,1)[0]!=(2 if kind=='cube' else 0):
            raise ValueError('Original texture registry did not retain the supplied GPU resource')
        record={'path':path,'key':key,'pointer':pointer,'wrapper':wrapper,
            'headerHex':bytes(self.u.mem_read(pointer,0x11)).hex(),**gpu}
        self.preloaded_textures.append(record)
        return record

    def discover_texture_paths(self,graph):
        """Read string fields from the complete native reflection/postload graph.

        Constructor defaults are included. Every discovery retains its native
        type, instance and field offset; no per-spell texture list is authored.
        """
        return discover_native_texture_paths(self,graph)

    def vector(self,address,stride,maximum=16):
        if not self.library_pointer(address,16):raise ValueError('Graphics vector outside owned bounds')
        pointer=self.q(address);count=self.u32(address+8);capacity=self.u32(address+12)&0x7fffffff
        if count>maximum or count>capacity or (count and not self.library_pointer(pointer,count*stride)):
            raise ValueError('Graphics vector exceeds owned bounds')
        return [pointer+i*stride for i in range(count)]

    def pixels(self,pointer,byte_count):
        if not self.library_pointer(pointer,byte_count):raise ValueError('Graphics pixels outside owned bounds')
        return bytes(self.u.mem_read(pointer,byte_count))

    def graphics_call(self,uc,address,size,kind):
        if kind=='pipeline':
            descriptor=self.u.reg_read(r.UC_X86_REG_RSI);program=self.u.reg_read(r.UC_X86_REG_RDX)
            if (self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE or
                    not self.library_pointer(descriptor,32) or program not in self.native_programs):
                raise ValueError('Unowned native render-pipeline request')
            self.pipeline_requests.append({'descriptorHex':bytes(self.u.mem_read(descriptor,32)).hex(),
                'nativeProgram':program,'glProgram':self.native_programs[program]['glHandle'],
                'returnRva':self.q(self.u.reg_read(r.UC_X86_REG_RSP))-self.base})
            raise ValueError('Native render-pipeline state provider is not implemented')
        if kind in ['vertex','pixel','program','shader-return','program-return']:
            return self.shader_call(kind)
        if kind=='device':
            if self.u.reg_read(r.UC_X86_REG_RDI)!=SERVICE:raise ValueError('Unowned graphics service')
            self.u.reg_write(r.UC_X86_REG_RAX,DEVICE);self.ret();return
        if kind=='header-return':
            pending=self.pending_graphics
            if pending is None:raise ValueError('Unexpected graphics metadata continuation')
            header=bytes(self.u.mem_read(pending['pointer'],0x11))
            expected=pending['input']
            if (int.from_bytes(header[8:10],'little')!=expected['width'] or
                    int.from_bytes(header[10:12],'little')!=expected['height'] or
                    header[12]!=pending['depth'] or header[13]!=len(expected['levels']) or
                    header[14]!=pending['nativeType'] or header[15]!=pending['flags'] or
                    header[16]!=expected['nativeFormat']):
                raise ValueError('Original texture header constructor output differs')
            self.native_textures[pending['pointer']]=pending['gpu']
            self.gpu_records.append({'pointer':pending['pointer'],'headerHex':header.hex(),
                'flags':pending['flags'],'nativeType':pending['nativeType'],
                'levelsHex':[[p.hex() for p in level] for level in expected['levels']],**pending['gpu']})
            self.u.reg_write(r.UC_X86_REG_RSP,pending['stack'])
            self.u.reg_write(r.UC_X86_REG_RAX,pending['pointer'])
            self.pending_graphics=None;self.ret();return
        if self.pending_graphics is not None or self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE:
            raise ValueError('Reentrant/unowned graphics upload')
        fmt=self.u.reg_read(r.UC_X86_REG_ESI);width=self.u.reg_read(r.UC_X86_REG_EDX)
        height=self.u.reg_read(r.UC_X86_REG_ECX);sp=self.u.reg_read(r.UC_X86_REG_RSP)
        if fmt not in [2,0x15] or not 0<width<=4096:raise ValueError('Unsupported native texture upload format/width')
        if kind=='2d':
            mips=self.u.reg_read(r.UC_X86_REG_R8D);flags=self.u.reg_read(r.UC_X86_REG_R9D)
            rows=self.vector(self.q(sp+8),8)
            if len(rows)!=mips:raise ValueError('2D mip vector differs from native metadata')
            levels=[[self.pixels(self.q(row),max(1,width>>i)*max(1,height>>i)*4)] for i,row in enumerate(rows)]
            layers,depth,native_type=1,1,0
        elif kind=='array':
            layers=self.u.reg_read(r.UC_X86_REG_R8D);mips=self.u.reg_read(r.UC_X86_REG_R9D)
            flags=self.u32(sp+8);rows=self.vector(self.q(sp+16),16)
            if len(rows)!=layers:raise ValueError('Array layer vector differs from native metadata')
            per_layer=[self.vector(row,8) for row in rows]
            if any(len(row)!=mips for row in per_layer):raise ValueError('Array mip vector differs')
            levels=[[self.pixels(self.q(row[i]),max(1,width>>i)*max(1,height>>i)*4) for row in per_layer] for i in range(mips)]
            depth,native_type=layers,3
        elif kind=='cube':
            mips=height;height=width;flags=self.u.reg_read(r.UC_X86_REG_R8D)
            rows=self.vector(self.u.reg_read(r.UC_X86_REG_R9),48)
            if len(rows)!=mips:raise ValueError('Cube mip vector differs from native metadata')
            levels=[[self.pixels(self.q(row+face*8),max(1,width>>i)**2*4) for face in range(6)] for i,row in enumerate(rows)]
            layers,depth,native_type=6,1,2
        else:raise ValueError('Unsupported graphics interface')
        if not 0<height<=4096 or not 0<mips<=13 or flags!=0 or depth>255:
            raise ValueError('Unadmitted native texture upload dimensions/flags')
        request={'kind':kind,'nativeFormat':fmt,'width':width,'height':height,'layers':layers,'levels':levels}
        gpu=self.device.create(request)
        if not gpu['gpuBytesVerified']:raise ValueError('Graphics upload was not backed by verified GPU bytes')
        pointer=self.allocate(0x28,0xa5)
        self.pending_graphics={'pointer':pointer,'input':request,'gpu':gpu,'stack':sp,
            'depth':depth,'nativeType':native_type,'flags':flags}
        # Tail-call the original CPU texture constructor, then resume the
        # original caller after the host continuation. No nested emulation.
        frame=sp-0x20
        self.put(frame,'Q',CALLBACKS['header-return']);self.put(frame+8,'Q',depth);self.put(frame+16,'Q',mips)
        for reg,value in [(r.UC_X86_REG_RDI,pointer),(r.UC_X86_REG_RSI,native_type),
                (r.UC_X86_REG_RDX,flags),(r.UC_X86_REG_RCX,fmt),(r.UC_X86_REG_R8,width),
                (r.UC_X86_REG_R9,height),(r.UC_X86_REG_RSP,frame),(r.UC_X86_REG_RIP,self.base+0x19175e0)]:
            self.u.reg_write(reg,value)

    def shader_call(self,kind):
        if self.shader_catalog is None:raise ValueError('Native shader provider is absent')
        if kind in ['shader-return','program-return']:
            pending=self.pending_shader
            if pending is None or pending['returnKind']!=kind:
                raise ValueError('Unexpected native graphics shader continuation')
            if kind=='shader-return':
                pointer=pending['pointer']
                if self.q(pointer+8)!=0 or self.u32(pointer+0x10)!=0:
                    raise ValueError('Original shader base initialization differs')
                self.native_shaders[pointer]=pending['gpu']
            else:
                pointer=self.u.reg_read(r.UC_X86_REG_RAX)
                if (self.allocations.get(pointer)!=0x18 or
                        self.q(pointer+8)!=pending['vertex'] or self.q(pointer+0x10)!=pending['pixel']):
                    raise ValueError('Original shader program wrapper differs')
                self.native_programs[pointer]=pending['gpu']
            self.u.reg_write(r.UC_X86_REG_RSP,pending['stack'])
            self.u.reg_write(r.UC_X86_REG_RAX,pointer)
            self.pending_shader=None;self.ret();return
        if (self.pending_shader is not None or self.pending_graphics is not None or
                self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE):
            raise ValueError('Reentrant/unowned native shader request')
        sp=self.u.reg_read(r.UC_X86_REG_RSP)
        if kind=='program':
            vertex=self.u.reg_read(r.UC_X86_REG_RSI);pixel=self.u.reg_read(r.UC_X86_REG_RDX)
            if vertex not in self.native_shaders or pixel not in self.native_shaders:
                raise ValueError('Native program references unowned stages')
            gpu=self.shader_catalog.create_program(self.native_shaders[vertex]['glHandle'],
                self.native_shaders[pixel]['glHandle'])
            self.pending_shader={'gpu':gpu,'stack':sp,'vertex':vertex,'pixel':pixel,'returnKind':'program-return'}
            entry=0x1925770;registers={}
        else:
            descriptor=self.u.reg_read(r.UC_X86_REG_RDX);defines_at=self.u.reg_read(r.UC_X86_REG_RCX)
            if self.u.reg_read(r.UC_X86_REG_RSI)!=0 or not self.library_pointer(descriptor,0x28):
                raise ValueError('Unsupported native shader request ABI')
            path_at=descriptor+0x18;length=self.u32(path_at+8)
            if not 0<length<4096 or not self.library_pointer(self.q(path_at),length):
                raise ValueError('Native shader path exceeds owned bounds')
            path=bytes(self.u.mem_read(self.q(path_at),length)).decode('ascii')
            defines=[{'name':self.cstring(self.q(row)).decode('ascii'),
                'value':self.cstring(self.q(row+8)).decode('ascii')}
                for row in self.vector(defines_at,24,32)]
            gpu=self.shader_catalog.create_shader(path,kind,defines)
            pointer=self.allocate(0x18,0xa5)
            self.pending_shader={'gpu':gpu,'stack':sp,'pointer':pointer,'returnKind':'shader-return'}
            entry=0x1916b50;registers={r.UC_X86_REG_RDI:pointer}
        frame=sp-0x10;self.put(frame,'Q',CALLBACKS[self.pending_shader['returnKind']])
        for reg,value in {**registers,r.UC_X86_REG_RSP:frame,r.UC_X86_REG_RIP:self.base+entry}.items():
            self.u.reg_write(reg,value)

    def resource_context_state(self):
        state=super().resource_context_state()
        state['scope']={**state['scope'],'fullTextureManagerConstructor':True,'graphicsProvider':True,
            'defaultTexturesCreated':True,'portedGlesDevice':True,'originalMetalDeviceExecuted':False}
        return state

"""Original SCB resource setup with GPU-backed buffer/layout interfaces."""
import unicorn
from unicorn import x86_const as r
from graphics_mesh_device import GraphicsMeshDevice
from vfx_file_native import NativeVfxFileContext
from vfx_pipeline_native import PIPELINE_DEVICE_VTABLE
from vfx_graphics_native import DEVICE
from vfx_spawn_native import ADDRESSES as A

BUFFER_CREATE,BUFFER_RETURN,LAYOUT_CREATE=0x100f5200,0x100f5210,0x100f5220
LAYOUT_STOP=0x192d935


class NativeVfxMeshContext(NativeVfxFileContext):
    def __init__(self,*args,**kwargs):
        self.mesh_backend=None
        super().__init__(*args,**kwargs)
        self.mesh_backend=GraphicsMeshDevice(self.device)
        for address,callback in [(BUFFER_CREATE,self.buffer_create),(BUFFER_RETURN,self.buffer_return),
                (LAYOUT_CREATE,self.layout_create)]:
            self.u.mem_write(address,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=address,end=address)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.layout_return,begin=self.base+LAYOUT_STOP,end=self.base+LAYOUT_STOP)
        for at in [0x192def0,0x192dfa4]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_layout_binding,begin=self.base+at,end=self.base+at)
        for at in [0x1809260,0x1809658]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_static_mesh,begin=self.base+at,end=self.base+at)

    def load_prepared_system(self,graph):
        if self.mesh_backend is not None:self.mesh_backend.close()
        super().load_prepared_system(graph)
        self.pending_mesh_buffer=None;self.pending_mesh_layout=None;self.pending_layout_bindings=[]
        self.native_mesh_buffers={};self.native_mesh_layouts={}
        self.static_mesh_setups=[];self.pending_static_mesh=[]
        if self.mesh_backend is not None:self.mesh_backend.buffer_records=[];self.mesh_backend.layout_records=[]

    def initialize_graphics_context(self,quality,graphics34b):
        state=super().initialize_graphics_context(quality,graphics34b)
        self.put(PIPELINE_DEVICE_VTABLE+0xc8,'Q',BUFFER_CREATE)
        self.put(PIPELINE_DEVICE_VTABLE+0xe8,'Q',LAYOUT_CREATE)
        return state

    def buffer_create(self,uc,address,size,user):
        count=self.u.reg_read(r.UC_X86_REG_RSI);flags=self.u.reg_read(r.UC_X86_REG_RDX)
        pointer=self.u.reg_read(r.UC_X86_REG_RCX)
        if (self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE or self.pending_mesh_buffer is not None or
                not 0<count<0x100000 or not self.library_pointer(pointer,count)):
            raise ValueError('Unowned native vertex-buffer creation')
        gpu=self.mesh_backend.create_buffer(bytes(self.u.mem_read(pointer,count)),flags)
        header=self.allocate(0x48,0xa5);sp=self.u.reg_read(r.UC_X86_REG_RSP)
        self.pending_mesh_buffer={'gpu':gpu,'header':header,'stack':sp,
            'returnRva':self.q(sp)-self.base,'sourcePointer':pointer}
        frame=sp-0x10;self.put(frame,'Q',BUFFER_RETURN)
        for reg,value in [(r.UC_X86_REG_RDI,header),(r.UC_X86_REG_RSI,count),(r.UC_X86_REG_RDX,flags),
                (r.UC_X86_REG_RSP,frame),(r.UC_X86_REG_RIP,self.base+0x1917a40)]:self.u.reg_write(reg,value)

    def buffer_return(self,uc,address,size,user):
        pending=self.pending_mesh_buffer
        if pending is None:raise ValueError('Unexpected native vertex-buffer constructor continuation')
        header=pending['header'];gpu=pending['gpu']
        if self.u32(header+8) or self.u32(header+12)!=gpu['bytes'] or self.u.mem_read(header+16,1)!=bytes([gpu['flags']]):
            raise ValueError('Original native vertex-buffer base differs')
        # The original CPU layout setter uses this backend reference counter.
        # GPU allocation and its lifetime belong to the GLES port.
        self.put(header+0x44,'I',1)
        gpu.update(nativePointer=header,nativeHeaderHex=bytes(self.u.mem_read(header,0x48)).hex(),
            sourcePointer=pending['sourcePointer'],returnRva=pending['returnRva'])
        self.native_mesh_buffers[header]=gpu
        self.u.reg_write(r.UC_X86_REG_RSP,pending['stack']);self.u.reg_write(r.UC_X86_REG_RAX,header)
        self.pending_mesh_buffer=None;self.ret()

    def layout_create(self,uc,address,size,user):
        source=self.u.reg_read(r.UC_X86_REG_RSI);count=self.u.reg_read(r.UC_X86_REG_RDX)
        if (self.u.reg_read(r.UC_X86_REG_RDI)!=DEVICE or self.pending_mesh_layout is not None or
                not 0<count<=16 or not self.library_pointer(source,count*8)):
            raise ValueError('Unowned native vertex-layout creation')
        gpu=self.mesh_backend.create_layout(bytes(self.u.mem_read(source,count*8)),count)
        header=self.allocate(0x1c0,0xa5);sp=self.u.reg_read(r.UC_X86_REG_RSP)
        preserved=[r.UC_X86_REG_RBP,r.UC_X86_REG_RBX,r.UC_X86_REG_R12,
            r.UC_X86_REG_R13,r.UC_X86_REG_R14,r.UC_X86_REG_R15]
        self.pending_mesh_layout={'gpu':gpu,'header':header,'stack':sp,'returnRva':self.q(sp)-self.base,
            'preserved':{reg:self.u.reg_read(reg) for reg in preserved}}
        # Execute the complete independent CPU descriptor/binding initialization.
        # Stop before allocation of a Metal vertex descriptor; GLES owns a VAO.
        self.u.reg_write(r.UC_X86_REG_RDI,header);self.u.reg_write(r.UC_X86_REG_RIP,self.base+0x192d380)

    def layout_return(self,uc,address,size,user):
        pending=self.pending_mesh_layout
        if pending is None:raise ValueError('Unowned native vertex-layout initialization endpoint')
        header=pending['header'];gpu=pending['gpu'];count=gpu['attributeCount']
        if self.u32(header+0x18c)!=count:raise ValueError('Original native layout attribute count differs')
        gpu.update(nativePointer=header,nativeDescriptorHex=bytes(self.u.mem_read(header+8,count*8)).hex(),
            nativeHeaderHex=bytes(self.u.mem_read(header,0x1c0)).hex(),returnRva=pending['returnRva'])
        self.native_mesh_layouts[header]=gpu
        # The Metal factory and constructor epilogue do not execute in this
        # backend. Restore the caller's callee-saved registers at that boundary.
        for reg,value in pending['preserved'].items():self.u.reg_write(reg,value)
        self.u.reg_write(r.UC_X86_REG_RSP,pending['stack']);self.u.reg_write(r.UC_X86_REG_RAX,header)
        self.pending_mesh_layout=None;self.ret()

    def observe_layout_binding(self,uc,address,size,user):
        if address==self.base+0x192def0:
            layout=self.u.reg_read(r.UC_X86_REG_RDI);buffer=self.u.reg_read(r.UC_X86_REG_RDX)
            if layout not in self.native_mesh_layouts or buffer not in self.native_mesh_buffers:
                raise ValueError('Unowned native layout/vertex-buffer binding')
            self.pending_layout_bindings.append({'nativeLayout':layout,'nativeBuffer':buffer,
                'semantic':self.u.reg_read(r.UC_X86_REG_RSI),'offset':self.u.reg_read(r.UC_X86_REG_RCX),
                'stride':self.u.reg_read(r.UC_X86_REG_R8)})
        else:
            binding=self.pending_layout_bindings.pop();layout=self.native_mesh_layouts[binding['nativeLayout']]
            header=binding['nativeLayout'];count=layout['attributeCount'];semantic=binding['semantic']
            matches=[i for i in range(count) if self.u.mem_read(header+8+i*8,1)[0]==semantic]
            if len(matches)!=1:raise ValueError('Native layout binding did not find its unique semantic')
            index=matches[0]
            if (self.q(header+0x88+index*8)!=binding['nativeBuffer'] or
                    self.u32(header+0x108+index*4)!=binding['offset'] or
                    self.u32(header+0x148+index*4)!=binding['stride']):
                raise ValueError('Original native layout setter differs')
            layout['bindings'].append(binding)

    def observe_static_mesh(self,uc,address,size,user):
        if address==self.base+0x1809260:
            pointer=self.u.reg_read(r.UC_X86_REG_RDI)
            if not self.file_closes or not self.file_closes[-1]['path'].endswith('.scb'):
                raise ValueError('Static mesh setup lacks a closed original SCB stream')
            self.pending_static_mesh.append({'nativePointer':pointer,'path':self.file_closes[-1]['path'],
                'triangles':self.u32(pointer+0xa0),'headerBeforeHex':bytes(self.u.mem_read(pointer,0xe0)).hex()})
        else:
            record=self.pending_static_mesh.pop();pointer=record['nativePointer']
            buffer=self.q(pointer+0xd0);layout=self.q(pointer+0xd8)
            if (buffer not in self.native_mesh_buffers or layout not in self.native_mesh_layouts or
                    self.native_mesh_buffers[buffer]['bytes']!=record['triangles']*108 or
                    any(self.q(pointer+offset) for offset in [0xb0,0xb8,0xc0,0xc8])):
                raise ValueError('Original SCB GPU setup did not retain its exact buffer/layout or release raw arrays')
            record.update(nativeBuffer=buffer,nativeLayout=layout,
                headerAfterHex=bytes(self.u.mem_read(pointer,0xe0)).hex())
            self.static_mesh_setups.append(record)

"""Port immutable 16-bit native index buffers to byte-verified GLES storage."""
from unicorn import x86_const as r
from vfx_graphics_native import DEVICE


class NativeIndexBuffers:
    def initialize_character_graphics(self,angle):
        state=super().initialize_character_graphics(angle)
        if getattr(self,'index_callbacks',None):raise ValueError('Index-buffer provider already initialized')
        self.index_callbacks={name:self.allocate_native_callback('index-buffer-'+name,callback)
                              for name,callback in [('create',self.index_buffer_create),('return',self.index_buffer_return)]}
        self.pending_index_buffer=None;self.native_index_buffers={}
        if int.from_bytes(self.source.image[0x2408648:0x2408650],'little')!=self.base+0x19232d0:
            raise ValueError('Original exact-build index factory slot differs')
        self.put(self.q(DEVICE)+0xd8,'Q',self.index_callbacks['create'])
        state['indexBufferProvider']='owned-gles-static-uint16'
        return state

    def index_buffer_create(self,engine,address,size,user):
        count=engine.reg_read(r.UC_X86_REG_RSI)
        format_=engine.reg_read(r.UC_X86_REG_RDX)
        flags=engine.reg_read(r.UC_X86_REG_RCX)
        source=engine.reg_read(r.UC_X86_REG_R8)
        if (engine.reg_read(r.UC_X86_REG_RDI)!=DEVICE or self.pending_index_buffer is not None or
                not 0<count<1048576 or count%2 or format_!=0 or flags!=0 or
                not self.library_pointer(source,count)):
            raise ValueError('Unadmitted native immutable uint16 index-buffer request')
        gpu=self.mesh_backend.create_buffer(bytes(engine.mem_read(source,count)),0)
        gpu.update(kind='index',indexBytes=2,nativeIndexFormat=format_,sourcePointer=source,
                   fullMetalConstructorExecuted=False)
        header=self.allocate(0x48,0xa5);stack=engine.reg_read(r.UC_X86_REG_RSP)
        self.pending_index_buffer={'gpu':gpu,'header':header,'stack':stack}
        frame=stack-16;self.put(frame,'Q',self.index_callbacks['return'])
        for register,value in {r.UC_X86_REG_RSP:frame,r.UC_X86_REG_RDI:header,r.UC_X86_REG_RSI:count,
                               r.UC_X86_REG_RDX:format_,r.UC_X86_REG_RCX:flags,
                               r.UC_X86_REG_RIP:self.base+0x1916ae0}.items():engine.reg_write(register,value)

    def index_buffer_return(self,engine,address,size,user):
        pending=self.pending_index_buffer
        if pending is None:raise ValueError('Unexpected original index-header continuation')
        gpu=pending['gpu'];header=pending['header']
        if (self.u32(header+8) or self.u32(header+12)!=gpu['bytes'] or
                bytes(engine.mem_read(header+16,2))!=b'\x00\x00'):
            raise ValueError('Original index-buffer CPU header differs')
        gpu.update(nativePointer=header,nativeHeaderHex=bytes(engine.mem_read(header,0x48)).hex(),
                   originalHeaderConstructorRva=0x1916ae0)
        self.native_index_buffers[header]=gpu
        engine.reg_write(r.UC_X86_REG_RSP,pending['stack']);engine.reg_write(r.UC_X86_REG_RAX,header)
        self.pending_index_buffer=None;self.ret()

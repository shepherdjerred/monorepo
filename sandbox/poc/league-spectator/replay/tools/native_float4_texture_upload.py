"""Bounded format24 device ABI, retaining the original CPU header constructor."""
from unicorn import x86_const as r
from vfx_graphics_native import DEVICE,CALLBACKS


def upload_float4_texture(n,uc,kind):
    if n.pending_graphics is not None or uc.reg_read(r.UC_X86_REG_RDI)!=getattr(n,'shared_backend',DEVICE):raise ValueError('Unowned/reentrant original float4 upload')
    fmt,width,height=[uc.reg_read(reg) for reg in [r.UC_X86_REG_ESI,r.UC_X86_REG_EDX,r.UC_X86_REG_ECX]];sp=uc.reg_read(r.UC_X86_REG_RSP)
    if fmt!=24 or not 0<width<=4096:raise ValueError('Original float4 format/width required')
    def plane(pointer,mip):return n.pixels(pointer,max(1,width>>mip)*max(1,height>>mip)*16)
    if kind=='2d':
        mips,flags=uc.reg_read(r.UC_X86_REG_R8D),uc.reg_read(r.UC_X86_REG_R9D);rows=n.vector(n.q(sp+8),8)
        if len(rows)!=mips:raise ValueError('Original float4 2D mip vector differs')
        levels=[[plane(n.q(row),index)] for index,row in enumerate(rows)];layers,depth,native_type=1,1,0
    elif kind=='array':
        layers,mips=uc.reg_read(r.UC_X86_REG_R8D),uc.reg_read(r.UC_X86_REG_R9D);flags=n.u32(sp+8);rows=n.vector(n.q(sp+16),16)
        if len(rows)!=layers:raise ValueError('Original float4 array layer vector differs')
        planes=[n.vector(row,8) for row in rows]
        if any(len(row)!=mips for row in planes):raise ValueError('Original float4 array mip vector differs')
        levels=[[plane(n.q(row[index]),index) for row in planes] for index in range(mips)];depth,native_type=layers,3
    elif kind=='cube':
        mips=height;height=width;flags=uc.reg_read(r.UC_X86_REG_R8D);rows=n.vector(uc.reg_read(r.UC_X86_REG_R9),48)
        if len(rows)!=mips:raise ValueError('Original float4 cube mip vector differs')
        levels=[[plane(n.q(row+face*8),index) for face in range(6)] for index,row in enumerate(rows)];layers,depth,native_type=6,1,2
    else:raise ValueError('Original float4 texture dimension unadmitted')
    if not 0<height<=4096 or not 0<mips<=13 or flags!=0 or depth>255:raise ValueError('Original float4 dimensions/flags outside bounds')
    request={'kind':kind,'nativeFormat':24,'width':width,'height':height,'layers':layers,'levels':levels};gpu=n.float4_texture_backend.create(request)
    pointer=n.allocate(0x28,0xa5);n.pending_graphics={'pointer':pointer,'input':request,'gpu':gpu,'stack':sp,'depth':depth,'nativeType':native_type,'flags':flags}
    frame=sp-0x20;n.put(frame,'Q',CALLBACKS['header-return']);n.put(frame+8,'Q',depth);n.put(frame+16,'Q',mips)
    for register,value in {r.UC_X86_REG_RDI:pointer,r.UC_X86_REG_RSI:native_type,r.UC_X86_REG_RDX:flags,r.UC_X86_REG_RCX:24,r.UC_X86_REG_R8:width,r.UC_X86_REG_R9:height,r.UC_X86_REG_RSP:frame,r.UC_X86_REG_RIP:n.base+0x19175e0}.items():uc.reg_write(register,value)

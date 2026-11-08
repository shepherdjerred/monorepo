"""Port native BC texture upload arguments without changing game callbacks."""
from unicorn import x86_const as r
from graphics_block_texture_device import FORMATS
from vfx_graphics_native import DEVICE,CALLBACKS


def upload_block_texture(n,uc,kind):
    if n.pending_graphics is not None or uc.reg_read(r.UC_X86_REG_RDI)!=DEVICE:
        raise ValueError('Unowned/reentrant compressed texture request')
    fmt,width,height=[uc.reg_read(reg) for reg in [r.UC_X86_REG_ESI,r.UC_X86_REG_EDX,r.UC_X86_REG_ECX]]
    sp=uc.reg_read(r.UC_X86_REG_RSP)
    if fmt not in FORMATS or not 0<width<=4096:raise ValueError('Unadmitted compressed native texture format/width')
    block_bytes=FORMATS[fmt][1]
    def plane(pointer,mip):
        size=((max(1,width>>mip)+3)//4)*((max(1,height>>mip)+3)//4)*block_bytes
        return n.pixels(pointer,size)
    if kind=='2d':
        mips,flags=uc.reg_read(r.UC_X86_REG_R8D),uc.reg_read(r.UC_X86_REG_R9D)
        rows=n.vector(n.q(sp+8),8)
        if len(rows)!=mips:raise ValueError('Compressed 2D mip vector differs')
        levels=[[plane(n.q(row),i)] for i,row in enumerate(rows)];layers,depth,native_type=1,1,0
    elif kind=='array':
        layers,mips=uc.reg_read(r.UC_X86_REG_R8D),uc.reg_read(r.UC_X86_REG_R9D)
        flags=n.u32(sp+8);rows=n.vector(n.q(sp+16),16)
        if len(rows)!=layers:raise ValueError('Compressed array layer vector differs')
        per_layer=[n.vector(row,8) for row in rows]
        if any(len(row)!=mips for row in per_layer):raise ValueError('Compressed array mip vectors differ')
        levels=[[plane(n.q(row[i]),i) for row in per_layer] for i in range(mips)];depth,native_type=layers,3
    elif kind=='cube':
        mips=height;height=width;flags=uc.reg_read(r.UC_X86_REG_R8D)
        rows=n.vector(uc.reg_read(r.UC_X86_REG_R9),48)
        if len(rows)!=mips:raise ValueError('Compressed cube mip vector differs')
        levels=[[plane(n.q(row+face*8),i) for face in range(6)] for i,row in enumerate(rows)];layers,depth,native_type=6,1,2
    else:raise ValueError('Unadmitted compressed texture dimension')
    if not 0<height<=4096 or not 0<mips<=13 or flags!=0 or depth>255:
        raise ValueError('Compressed texture dimensions/flags exceed owned bounds')
    request={'kind':kind,'nativeFormat':fmt,'width':width,'height':height,'layers':layers,'levels':levels}
    gpu=n.block_texture_backend.create(request)
    pointer=n.allocate(0x28,0xa5)
    n.pending_graphics={'pointer':pointer,'input':request,'gpu':gpu,'stack':sp,'depth':depth,'nativeType':native_type,'flags':flags}
    frame=sp-0x20
    n.put(frame,'Q',CALLBACKS['header-return']);n.put(frame+8,'Q',depth);n.put(frame+16,'Q',mips)
    for reg,value in {r.UC_X86_REG_RDI:pointer,r.UC_X86_REG_RSI:native_type,r.UC_X86_REG_RDX:flags,
                      r.UC_X86_REG_RCX:fmt,r.UC_X86_REG_R8:width,r.UC_X86_REG_R9:height,
                      r.UC_X86_REG_RSP:frame,r.UC_X86_REG_RIP:n.base+0x19175e0}.items():uc.reg_write(reg,value)

"""Observe original pipeline descriptor setters without creating Metal resources.

Owned, data-only objects implement descriptor property messages. Original code
chooses fields, enum-table indices and branches. Execution stops before device
resource creation. This is a reference for the GLES port, not a Metal runtime.
"""
import struct
import unicorn
from unicorn import x86_const as r
from vfx_object_native import NativeVfxObjects
from vfx_spawn_native import ADDRESSES as A

MESSAGE=0x100f4000


class NativePipelineDescription(NativeVfxObjects):
    def __init__(self,*args):
        self.descriptor_active=False
        super().__init__(*args)
        if self.source.data_imports.get(0x22e0408)!='_objc_msgSend':
            raise ValueError('Original descriptor message import differs')
        self.put(self.base+0x22e0408,'Q',MESSAGE);self.u.mem_write(MESSAGE,b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.message,begin=MESSAGE,end=MESSAGE)

    def object(self,kind,fields=None):
        pointer=self.allocate(8)
        self.descriptor_objects[pointer]={'kind':kind,'fields':fields or {}}
        return pointer

    def imported(self,uc,address,size,user):
        if self.descriptor_active and self.source.imports[address-self.base]=='_objc_opt_new':
            token=self.u.reg_read(r.UC_X86_REG_RDI)
            if token not in self.descriptor_classes:raise ValueError('Unowned descriptor class token')
            kind=self.descriptor_classes[token];pointer=self.object(kind)
            if kind=='depth':self.depth_pointer=pointer
            if kind=='sampler':self.sampler_pointer=pointer
            self.u.reg_write(r.UC_X86_REG_RAX,pointer);self.ret();return
        return super().imported(uc,address,size,user)

    def message(self,uc,address,size,user):
        if not self.descriptor_active:raise ValueError('Descriptor API is not active')
        receiver=self.u.reg_read(r.UC_X86_REG_RDI);selector=self.cstring(self.u.reg_read(r.UC_X86_REG_RSI)).decode('ascii')
        value=self.u.reg_read(r.UC_X86_REG_RDX);obj=self.descriptor_objects.get(receiver)
        if obj is None:raise ValueError('Unowned pipeline descriptor receiver')
        self.descriptor_messages.append({'kind':obj['kind'],'selector':selector,'value':value})
        if selector=='objectAtIndexedSubscript:':
            if obj['kind']!='attachments' or value>=4:raise ValueError('Invalid color attachment index')
            result=obj['fields']['values'][value]
        elif selector in ['colorAttachments','pixelFormat']:
            if selector not in obj['fields']:raise ValueError('Undefined descriptor property read')
            result=obj['fields'][selector]
        elif selector in ['setPixelFormat:','setWriteMask:','setBlendingEnabled:',
                'setRgbBlendOperation:','setAlphaBlendOperation:','setDestinationRGBBlendFactor:',
                'setDestinationAlphaBlendFactor:','setSourceRGBBlendFactor:','setSourceAlphaBlendFactor:',
                'setDepthWriteEnabled:','setStencilFailureOperation:','setDepthFailureOperation:',
                'setDepthStencilPassOperation:','setStencilCompareFunction:','setReadMask:',
                'setFrontFaceStencil:','setBackFaceStencil:','setDepthCompareFunction:',
                'setSAddressMode:','setTAddressMode:','setRAddressMode:','setMinFilter:',
                'setMagFilter:','setMipFilter:','setMaxAnisotropy:','setCompareFunction:','setBorderColor:']:
            obj['fields'][selector]=value
            if selector=='setPixelFormat:':obj['fields']['pixelFormat']=value
            result=0
        else:raise ValueError(f'Unadmitted descriptor message: {selector}')
        self.u.reg_write(r.UC_X86_REG_RAX,result);self.ret()

    def observe(self,raw):
        if len(raw)!=32:raise ValueError('Exact native descriptor required')
        self.load_system([]);self.descriptor_objects={};self.descriptor_messages=[]
        self.descriptor_classes={};self.depth_pointer=None
        state=self.allocate(32);self.u.mem_write(state,raw)
        depth_class=self.allocate(1);stencil_class=self.allocate(1)
        self.descriptor_classes={depth_class:'depth',stencil_class:'stencil'}
        self.put(self.base+0x246b7b8,'Q',depth_class);self.put(self.base+0x246b7c0,'Q',stencil_class)
        backend=self.allocate(0xf00);self.call(0x1922690,{r.UC_X86_REG_RDI:backend})
        attachments=[self.object('color',{'pixelFormat':0}) for _ in range(4)]
        array=self.object('attachments',{'values':attachments})
        render=self.object('pipeline',{'colorAttachments':array})
        formats=self.allocate(48);self.put(formats,'6Q',80,0,0,0,260,260)
        frame=A['stack']-0x100
        self.put(frame-0x60,'Q',formats);self.put(frame-0x38,'Q',render)
        self.descriptor_active=True
        try:
            self.fragment(0x192abfa,0x192af34,{r.UC_X86_REG_R12:state,r.UC_X86_REG_RBX:render,
                r.UC_X86_REG_R15:MESSAGE,r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0xc8})
            self.fragment(0x1928060,0x19283c6,{r.UC_X86_REG_RDI:backend,r.UC_X86_REG_RSI:state})
            raster=self.allocate(0x178)
            self.fragment(0x192aadf,0x192ab39,{r.UC_X86_REG_R14:raster,r.UC_X86_REG_R15:state,r.UC_X86_REG_RAX:0})
        finally:self.descriptor_active=False
        if self.depth_pointer is None:raise ValueError('Original depth descriptor was not created')
        depth=dict(self.descriptor_objects[self.depth_pointer]['fields'])
        for key in ['setFrontFaceStencil:','setBackFaceStencil:']:
            if key in depth:depth[key]=dict(self.descriptor_objects[depth[key]]['fields'])
        return {'descriptorHex':raw.hex(),'color':dict(self.descriptor_objects[attachments[0]]['fields']),
            'depth':depth,'raster':{'cullMode':self.q(raster+0x40),'winding':self.q(raster+0x48),
                'fillMode':self.q(raster+0x50),'biasConstant':struct.unpack('<f',self.u.mem_read(raster+0x58,4))[0],
                'biasSlope':struct.unpack('<f',self.u.mem_read(raster+0x5c,4))[0]},
            'messages':list(self.descriptor_messages),'metalResourceCreated':False}

    def sampler_description(self,raw):
        if len(raw)!=16:raise ValueError('Exact native sampler descriptor required')
        self.load_system([]);self.descriptor_objects={};self.descriptor_messages=[]
        token=self.allocate(1);self.descriptor_classes={token:'sampler'};self.sampler_pointer=None
        self.put(self.base+0x246b7b0,'Q',token)
        backend=self.allocate(0xf00);self.call(0x1922690,{r.UC_X86_REG_RDI:backend})
        for offset,value in [(8,raw[10]),(16,struct.unpack_from('<I',raw,4)[0]),(24,1),(32,raw[11])]:
            self.put(A['stack']+offset,'Q',value)
        self.descriptor_active=True
        try:
            self.fragment(0x191ff70,0x19202ec,{r.UC_X86_REG_RDI:backend,r.UC_X86_REG_RSI:raw[0],
                r.UC_X86_REG_RDX:raw[1],r.UC_X86_REG_RCX:raw[2],r.UC_X86_REG_R8:raw[8],r.UC_X86_REG_R9:raw[9]})
        finally:self.descriptor_active=False
        if self.sampler_pointer is None:raise ValueError('Original sampler descriptor was not created')
        return {'descriptorHex':raw.hex(),'fields':dict(self.descriptor_objects[self.sampler_pointer]['fields']),
            'messages':list(self.descriptor_messages),'metalResourceCreated':False}

    def string(self,text):
        raw=text.encode('ascii');pointer=self.allocate(len(raw)+1);self.u.mem_write(pointer,raw+b'\0')
        return pointer

    def uniform_bytes(self,uniforms,block):
        """Original zero-fill/first-matching-vector copy over supplied reflection."""
        self.load_system([])
        rows=self.allocate(max(1,len(uniforms)*24));values=self.allocate(16)
        self.put(values,'QII',rows,len(uniforms),len(uniforms))
        for i,value in enumerate(uniforms):
            raw=bytes.fromhex(value['bytesHex'])
            if len(raw)!=value['count']*16:raise ValueError('Supplied native uniform bytes differ')
            pointer=self.allocate(len(raw));self.u.mem_write(pointer,raw)
            self.put(rows+i*24,'QQII',self.string(value['name']),pointer,value['count'],0)
        members=[m for m in block['members'] if m['used']]
        fields=self.allocate(max(1,len(members)*12));reflection=self.allocate(16)
        self.put(reflection,'QII',fields,len(members),len(members))
        for i,member in enumerate(members):
            text=member['name'];wrapper=self.allocate(16)
            self.put(wrapper,'QII',self.string(text),len(text),len(text)+1)
            self.call(0x1499ab0,{r.UC_X86_REG_RDI:wrapper})
            self.put(fields+i*12,'III',self.u.reg_read(r.UC_X86_REG_EAX),member['offset'],member['size'])
        result=self.allocate(block['size'],0xa5)
        self.call(0x1fee5fa,{r.UC_X86_REG_RDI:result,r.UC_X86_REG_RSI:block['size']})
        self.call(0x191f950,{r.UC_X86_REG_RDI:values,r.UC_X86_REG_RSI:reflection,r.UC_X86_REG_RDX:result})
        return bytes(self.u.mem_read(result,block['size']))

"""Bounded SysV integer/string sprintf ABI with explicit supported formats."""
import ctypes as C
import hashlib
import re
from unicorn import x86_const as r


class NativeLibcSprintf:
    def __init__(self,*args,**kwargs):
        self.libc_sprintf_calls=[]
        super().__init__(*args,**kwargs)
        self.libc_sprintf=C.CDLL('msvcrt.dll').sprintf
        self.libc_sprintf.restype=C.c_int;self.libc_sprintf.argtypes=[C.c_void_p,C.c_char_p]

    def imported(self,engine,address,size,user):
        if self.source.imports.get(address-self.base)!='_sprintf':
            return super().imported(engine,address,size,user)
        if engine.reg_read(r.UC_X86_REG_RAX)&255:
            raise ValueError('Integer/string sprintf control does not admit vector arguments')
        destination=engine.reg_read(r.UC_X86_REG_RDI)
        format_=self.cstring(engine.reg_read(r.UC_X86_REG_RSI))
        cursor=0;specs=[];bound=len(format_)+1
        # Select the complete format before reading any variadic argument.
        while cursor<len(format_):
            if format_[cursor]!=37:cursor+=1;continue
            if format_[cursor:cursor+2]==b'%%':cursor+=2;continue
            match=re.match(rb'%([-+ #0]*)([0-9]{1,4})?([sdiuxXc])',format_[cursor:])
            if match is None or len(specs)>=32:raise ValueError('Unadmitted sprintf conversion: '+repr(format_))
            flags,width,conversion=match.groups();width=int(width or b'0')
            allowed={b's':b'-',b'c':b'-',b'd':b'-+ 0',b'i':b'-+ 0',b'u':b'-0',b'x':b'-#0',b'X':b'-#0'}[conversion]
            if width>4096 or len(flags)>5 or any(flag not in allowed for flag in flags):
                raise ValueError('Unadmitted sprintf flags or field width')
            specs.append((conversion,width));cursor+=len(match.group())
        registers=[r.UC_X86_REG_RDX,r.UC_X86_REG_RCX,r.UC_X86_REG_R8,r.UC_X86_REG_R9]
        stack=engine.reg_read(r.UC_X86_REG_RSP)+8;arguments=[];observed=[]
        for i,(conversion,width) in enumerate(specs):
            if i<len(registers):value=engine.reg_read(registers[i])
            else:
                at=stack+(i-len(registers))*8
                if not self.library_pointer(at,8):raise ValueError('Sprintf stack argument escaped owned memory')
                value=self.q(at)
            if conversion==b's':
                text=self.cstring(value);arguments.append(C.c_char_p(text));maximum=len(text)
                observed.append({'conversion':'s','bytesHex':text.hex()})
            elif conversion in [b'd',b'i']:
                value=C.c_int32(value&0xffffffff).value;arguments.append(C.c_int32(value));maximum=12
                observed.append({'conversion':conversion.decode(),'value':value})
            elif conversion==b'c':
                value&=255;arguments.append(C.c_int(value));maximum=1
                observed.append({'conversion':'c','value':value})
            else:
                value&=0xffffffff;arguments.append(C.c_uint32(value));maximum=12
                observed.append({'conversion':conversion.decode(),'value':value})
            bound+=max(width,maximum)
        if bound>1048576:raise ValueError('Sprintf output exceeds explicit bound')
        output=C.create_string_buffer(bound)
        length=self.libc_sprintf(output,format_,*arguments)
        if not 0<=length<bound or output.raw[length]!=0:raise ValueError('Sprintf host result exceeds its proven bound')
        count=length+1
        allocated=any(at<=destination<=at+size-count for at,size in self.allocations.items())
        stack_owned=0x10008000<=destination<=0x10010008-count
        static_data=any(name=='__DATA' and at<=destination<=at+size-count
                        for name,at,size,_,_ in self.source.segments)
        if not (allocated or stack_owned or static_data):raise ValueError('Sprintf destination escaped owned writable storage')
        data=output.raw[:count];engine.mem_write(destination,data)
        self.libc_sprintf_calls.append({'formatHex':format_.hex(),'destination':destination,'arguments':observed,
            'writtenBytes':count,'returnedCount':length,'outputSha256':hashlib.sha256(data).hexdigest(),
            'outputHex':data.hex(),'stackArguments':max(0,len(specs)-len(registers))})
        engine.reg_write(r.UC_X86_REG_RAX,length);self.ret()

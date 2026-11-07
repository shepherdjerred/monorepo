"""Bounded SysV integer/string printf widths at the C-library boundary."""
import ctypes as C
import re
from unicorn import x86_const as r


class LibcWidthFormatting:
    def imported(self,uc,address,size,user):
        if self.source.imports[address-self.base]!='_vsnprintf':return super().imported(uc,address,size,user)
        format_=self.cstring(uc.reg_read(r.UC_X86_REG_RDX))
        tokens=[];cursor=0;modified=False
        while cursor<len(format_):
            if format_[cursor]!=37:cursor+=1;continue
            if format_[cursor:cursor+2]==b'%%':cursor+=2;continue
            match=re.match(rb'%([-+ 0]*)([0-9]{1,4})?([sdiu])',format_[cursor:])
            # Float/64-bit conversions retain their existing separate bridges.
            # Never consume arguments before selecting an entire format.
            if match is None:return super().imported(uc,address,size,user)
            flags,width,conversion=match.groups();width=int(width or 0)
            if (width>4096 or len(tokens)>=32 or
                    any(flag not in ({115:b'-',117:b'-0'}.get(conversion[0],b'-+ 0')) for flag in flags)):
                raise ValueError('printf width/flags exceed admitted C conversion bounds')
            tokens.append((conversion,width));modified=modified or bool(flags or width)
            cursor+=len(match.group())
        if not modified:return super().imported(uc,address,size,user)
        destination,capacity,args_at=[uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RCX]]
        if (capacity>1048576 or capacity and not self.writable_file_memory(destination,capacity) or
                not self.writable_file_memory(args_at,24)):
            raise ValueError('Width formatter escaped owned output/va_list bounds')
        gp,fp=self.u32(args_at),self.u32(args_at+4);overflow,saved=self.q(args_at+8),self.q(args_at+16)
        if gp>48 or gp%8 or not 48<=fp<=304 or fp%16:raise ValueError('Unadmitted SysV width-formatter va_list layout')
        arguments,observed=[],[];bound=len(format_)+1
        for conversion,width in tokens:
            if gp<48:at=saved+gp;gp+=8
            else:at=overflow;overflow+=8
            if not self.library_pointer(at,8):raise ValueError('Width formatter argument escaped owned memory')
            value=self.q(at)
            if conversion==b's':
                encoded=self.cstring(value);arguments.append(C.c_char_p(encoded));worst=len(encoded)
                observed.append({'conversion':'s','bytesHex':encoded.hex(),'width':width})
            elif conversion==b'u':
                value&=0xffffffff;arguments.append(C.c_uint32(value));worst=10
                observed.append({'conversion':'u','value':value,'width':width})
            else:
                value=C.c_int32(value&0xffffffff).value;arguments.append(C.c_int32(value));worst=11
                observed.append({'conversion':conversion.decode(),'value':value,'width':width})
            bound+=max(width,worst)
        if bound>1048576:raise ValueError('Width formatter output exceeds proved finite bound')
        output=C.create_string_buffer(bound);count=self.character_sprintf(output,format_,*arguments)
        if not 0<=count<bound:raise ValueError('Host width formatter exceeded proved output bound')
        stored=output.raw[:min(max(0,capacity-1),count)]+b'\0' if capacity else b''
        if capacity:uc.mem_write(destination,stored)
        self.put(args_at,'IIQQ',gp,fp,overflow,saved)
        self.character_format_calls.append({'formatHex':format_.hex(),'arguments':observed,'capacity':capacity,
            'count':count,'outputHex':stored.hex(),'widthsAdmitted':True})
        uc.reg_write(r.UC_X86_REG_RAX,count);self.ret()

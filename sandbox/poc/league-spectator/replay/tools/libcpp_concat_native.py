"""Bounded libc++ concatenation using the original native string constructor."""
from unicorn import x86_const as r

CONCAT='__ZNSt3__1plIcNS_11char_traitsIcEENS_9allocatorIcEEEENS_12basic_stringIT_T0_T1_EEPKS6_RKS9_'


def read_libcpp_string(n,object_):
    if not n.library_pointer(object_,24):raise ValueError('libc++ string object escaped owned memory')
    tag=n.u.mem_read(object_,1)[0]
    if tag&1:
        capacity,length,pointer=n.q(object_)&~1,n.q(object_+8),n.q(object_+16)
        if not 0<capacity<=65536 or length>=capacity or not n.library_pointer(pointer,capacity):
            raise ValueError('libc++ long string escaped owned storage/length bounds')
    else:
        length,pointer=tag>>1,object_+1
        if length>22:raise ValueError('libc++ short string exceeds inline storage')
    if n.u.mem_read(pointer+length,1)!=b'\0':raise ValueError('libc++ string is missing its length-delimited terminator')
    return bytes(n.u.mem_read(pointer,length))


class LibcppConcat:
    def __init__(self,*args):
        self.cpp_concat_return=None
        self.pending_cpp_concat=None
        self.cpp_concat_calls=[]
        super().__init__(*args)

    def imported(self,uc,address,size,user):
        if self.source.imports[address-self.base]!=CONCAT:return super().imported(uc,address,size,user)
        if self.pending_cpp_concat is not None:raise ValueError('Reentrant libc++ concatenation')
        destination,prefix,right=[uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
        if not self.writable_file_memory(destination,24):raise ValueError('libc++ concatenation result escaped owned writable storage')
        left=self.cstring(prefix);rhs=read_libcpp_string(self,right);value=left+rhs
        if len(value)>=65536:raise ValueError('libc++ concatenation exceeds explicit byte bound')
        source=self.allocate(len(value)+1);self.u.mem_write(source,value+b'\0')
        if self.cpp_concat_return is None:
            self.cpp_concat_return=self.allocate_native_callback('libcpp-concat-return', self.finish_cpp_concat)
        stack=uc.reg_read(r.UC_X86_REG_RSP)
        record={'destination':destination,'prefixHex':left.hex(),'rightHex':rhs.hex(),'expectedHex':value.hex(),
                'originalConstructorRva':0x11fe0,'completed':False,'returnRva':self.q(stack)-self.base}
        self.cpp_concat_calls.append(record)
        self.pending_cpp_concat={'stack':stack,'record':record}
        self.put(stack-16,'Q',self.cpp_concat_return)
        for reg,data in {r.UC_X86_REG_RDI:destination,r.UC_X86_REG_RSI:source,r.UC_X86_REG_RDX:len(value),
                         r.UC_X86_REG_RSP:stack-16,r.UC_X86_REG_RIP:self.base+0x11fe0}.items():uc.reg_write(reg,data)

    def finish_cpp_concat(self,uc,address,size,user):
        pending=self.pending_cpp_concat
        if pending is None or uc.reg_read(r.UC_X86_REG_RSP)!=pending['stack']-8:
            raise ValueError('libc++ constructor continuation lost its owned frame')
        record=pending['record']
        actual=read_libcpp_string(self,record['destination'])
        if actual.hex()!=record['expectedHex']:raise ValueError('Original libc++ constructor output differs from concatenated bytes')
        record.update(completed=True,actualHex=actual.hex(),originalConstructorExecuted=True)
        uc.reg_write(r.UC_X86_REG_RAX,record['destination']);uc.reg_write(r.UC_X86_REG_RSP,pending['stack'])
        self.pending_cpp_concat=None;self.ret()

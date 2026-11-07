"""The observed ASCII-only strcasecmp ABI over bounded native strings."""
from unicorn import x86_const as r


class NativeAsciiCaseCompare:
    def __init__(self,*args,**kwargs):
        self.ascii_case_compare_calls=[]
        super().__init__(*args,**kwargs)
        if self.source.imports.get(0x1feed9e)!='_strcasecmp':
            raise ValueError('Exact native strcasecmp import differs')

    def imported(self,engine,address,size,user):
        if address-self.base!=0x1feed9e:return super().imported(engine,address,size,user)
        def string(pointer):
            result=bytearray()
            for i in range(4097):
                if not self.library_pointer(pointer+i,1):raise ValueError('strcasecmp string exceeds owned storage')
                value=engine.mem_read(pointer+i,1)[0]
                if not value:return bytes(result)
                if i==4096:raise ValueError('strcasecmp string exceeds its explicit length bound')
                if value>=128:raise ValueError('Only observed ASCII strcasecmp inputs are admitted')
                result.append(value)
        left=string(engine.reg_read(r.UC_X86_REG_RDI));right=string(engine.reg_read(r.UC_X86_REG_RSI))
        a,b=left.lower()+b'\0',right.lower()+b'\0';result=0
        for x,y in zip(a,b):
            if x!=y:result=x-y;break
        self.ascii_case_compare_calls.append({'leftHex':left.hex(),'rightHex':right.hex(),'result':result,
                                               'asciiOnly':True,'localeSensitiveInputsAdmitted':False})
        engine.reg_write(r.UC_X86_REG_EAX,result&0xffffffff);self.ret()

"""Original source/bytecode provider manager for shared script loading."""
from unicorn import x86_const as r
import ctypes as C
from character_graphics_native import NativeCharacterGraphics


class NativeModuleProviders(NativeCharacterGraphics):
    def __init__(self,*args):
        self.module_platform_calls = []
        super().__init__(*args)
        self.module_crt = C.CDLL('msvcrt.dll',use_errno=True)
        self.module_strtoi64 = self.module_crt._strtoi64
        self.module_strtoi64.argtypes = [C.c_char_p,C.POINTER(C.c_void_p),C.c_int]
        self.module_strtoi64.restype = C.c_longlong

    def imported(self,uc,address,size,user):
        if self.source.imports[address-self.base] != '_strtol':
            return super().imported(uc,address,size,user)
        text_at,end_at,base = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
        base &= 0xffffffff
        if base != 0 and not 2 <= base <= 36 or end_at and not self.writable_file_memory(end_at,8):
            raise ValueError('Module numeric conversion escaped base/end-pointer bounds')
        data = self.cstring(text_at)
        if any(value > 127 for value in data):
            raise ValueError('Module numeric conversion requires admitted ASCII input')
        # Darwin long is 64-bit. Windows strtol is 32-bit, so use the CRT's
        # signed 64-bit conversion, translating its end pointer and ERANGE.
        buffer,end = C.create_string_buffer(data),C.c_void_p()
        C.set_errno(0)
        value = self.module_strtoi64(C.cast(buffer,C.c_char_p),C.byref(end),base)
        error = C.get_errno()
        consumed = end.value-C.addressof(buffer)
        if not 0 <= consumed <= len(data) or error not in [0,34]:
            raise ValueError('Host signed 64-bit conversion escaped its admitted contract')
        if end_at:self.put(end_at,'Q',text_at+consumed)
        if error:
            if self.file_errno is None:self.file_errno = self.allocate(4)
            self.put(self.file_errno,'I',34)
        self.module_platform_calls.append({'name':'_strtol','input':data.decode('ascii'),
                                           'base':base,'value':value,'consumed':consumed,'errno':error})
        uc.reg_write(r.UC_X86_REG_RAX,value&0xffffffffffffffff)
        self.ret()

    def initialize_module_providers(self):
        if self.q(self.base+0x24728d0):
            raise ValueError('Original module/file-provider manager already exists')
        previous = self.u32(self.base+0x255d0f0)
        # Independent original initialization of its default context identity.
        # The complete character module may already have executed this block.
        self.call(0x35dd5c,{},0x35dd6e)
        identity = self.u32(self.base+0x255d0f0)
        if not identity or previous and previous != identity:
            raise ValueError('Original default module context identity differs')
        # Startup 0x665d70 allocates precisely 0xc0, then calls 0x353380.
        manager = self.allocate(0x1c0)
        self.u.mem_write(manager+0xc0,bytes([0xa5])*0x100)
        self.call(0x353380,{r.UC_X86_REG_RDI:manager})
        if (self.q(self.base+0x24728d0) != manager or
                bytes(self.u.mem_read(manager+0xc0,0x100)) != bytes([0xa5])*0x100):
            raise ValueError('Original module provider ownership/guard differs')
        if ([self.q(manager+offset)-self.base for offset in [0,0x68,0x88]] !=
                [0x231a6d8,0x231a638,0x231a7e8]):
            raise ValueError('Original module provider interfaces differ')
        root = self.q(manager+0x58)
        if (self.q(manager+0x60) != 1 or not self.library_pointer(root,0x30) or
                self.u32(root+0x20) != identity or self.q(root+0x28) != manager+0x68):
            raise ValueError('Original default module context registration differs')
        return {'object':manager,'constructorRva':0x353380,'allocatedObjectBytes':0xc0,
                'defaultIdentity':identity,'sourceInterface':manager+0x68,'bytecodeInterface':manager+0x88,
                'originalConstructorCompleted':True,'guardIntact':True,
                'allContextLibrariesLoaded':False,'gameBindingsRegistered':False,'liveWorldBindingsVerified':False}
